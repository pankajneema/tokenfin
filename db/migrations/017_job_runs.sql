-- 017: job_runs — one row per scheduled job run (cron routes / pg_cron).
--
-- Written by lib/jobs.ts withJobRun() through job_run_start / job_run_finish,
-- read by operators (docs/OPERATIONS.md). Service role only: RLS on, no
-- policies, and table privileges revoked from anon/authenticated.
--
-- job_run_start() also prunes rows older than 30 days, so the table never
-- grows without bound (no separate cleanup job needed).
--
-- tf_schema_probe() lets /api/health report the highest detectable migration
-- without exposing the catalog to clients. Idempotent; safe to re-run.

CREATE TABLE IF NOT EXISTS public.job_runs (
  id           BIGSERIAL PRIMARY KEY,
  job          TEXT        NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  ok           BOOLEAN,                      -- NULL while running (or if the run died)
  duration_ms  INTEGER,
  summary      JSONB,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS job_runs_job_started ON public.job_runs (job, started_at DESC);
CREATE INDEX IF NOT EXISTS job_runs_started     ON public.job_runs (started_at);

ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;          -- service role only
REVOKE ALL ON public.job_runs FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.job_runs TO service_role;
DO $$ BEGIN
  REVOKE ALL ON SEQUENCE public.job_runs_id_seq FROM PUBLIC, anon, authenticated;
  GRANT USAGE, SELECT ON SEQUENCE public.job_runs_id_seq TO service_role;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Start a run: insert the row and prune anything older than 30 days.
CREATE OR REPLACE FUNCTION public.job_run_start(p_job TEXT)
RETURNS BIGINT LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_id BIGINT;
BEGIN
  IF p_job IS NULL OR length(p_job) = 0 OR length(p_job) > 64 THEN
    RAISE EXCEPTION 'job name must be 1-64 chars';
  END IF;
  DELETE FROM job_runs WHERE started_at < NOW() - INTERVAL '30 days';
  INSERT INTO job_runs (job, started_at) VALUES (p_job, NOW()) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Finish a run. The error text is truncated; summaries over 16 KB are replaced
-- by a marker so one noisy run cannot bloat the table.
CREATE OR REPLACE FUNCTION public.job_run_finish(
  p_id BIGINT, p_ok BOOLEAN, p_summary JSONB DEFAULT NULL, p_error TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE job_runs SET
    finished_at = NOW(),
    ok          = p_ok,
    duration_ms = LEAST(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000, 2147483647)::INTEGER,
    summary     = CASE WHEN p_summary IS NULL THEN NULL
                       WHEN length(p_summary::text) > 16384 THEN jsonb_build_object('truncated', true)
                       ELSE p_summary END,
    error       = left(p_error, 2000)
  WHERE id = p_id;
END $$;

-- Which of the given objects exist? 'table' → to_regclass, 'table.column' →
-- information_schema.columns, 'fn()' → pg_proc. Public schema only.
CREATE OR REPLACE FUNCTION public.tf_schema_probe(p_names TEXT[])
RETURNS TEXT[] LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(array_agg(n), '{}') FROM unnest(p_names) AS n
  WHERE CASE
    WHEN n LIKE '%()' THEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
      WHERE s.nspname = 'public' AND p.proname = left(n, length(n) - 2))
    WHEN n LIKE '%.%' THEN EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = split_part(n, '.', 1)
        AND c.column_name = split_part(n, '.', 2))
    ELSE to_regclass('public.' || quote_ident(n)) IS NOT NULL
  END
$$;

REVOKE EXECUTE ON FUNCTION public.job_run_start(TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.job_run_start(TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.job_run_finish(BIGINT, BOOLEAN, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.job_run_finish(BIGINT, BOOLEAN, JSONB, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.tf_schema_probe(TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tf_schema_probe(TEXT[]) TO service_role;
