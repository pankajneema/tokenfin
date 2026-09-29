-- TokenFin additive migration 010
-- Audit log (who changed what) and a per-workspace time zone. Safe to re-run.

CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id UUID,
  actor_email   TEXT,
  action        TEXT NOT NULL,          -- e.g. key.create, limit.delete, data.delete
  target_type   TEXT,
  target_id     TEXT,
  details       JSONB NOT NULL DEFAULT '{}',
  ip            TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_log_org_created ON audit_log (org_id, created_at DESC);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;              -- service role only
GRANT ALL ON audit_log TO service_role;

-- IANA time zone used to bucket days on dashboards and in daily totals.
-- Existing workspaces keep India time (the previous hard-coded behaviour).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- Settings → Data deletion and daily retention also cover the telemetry tables
-- added in 007 (productivity and API-error daily counts). Replaces 006's version.
CREATE OR REPLACE FUNCTION public.purge_org_data(p_org UUID, p_before TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  n_events BIGINT; n_agg BIGINT; n_prompts BIGINT; n_spans BIGINT; n_traces BIGINT; n_ccr BIGINT;
  n_prod BIGINT := 0; n_err BIGINT := 0;
  cutoff TIMESTAMPTZ := COALESCE(p_before, 'infinity'::timestamptz);
BEGIN
  DELETE FROM usage_events    WHERE org_id = p_org AND created_at < cutoff;                GET DIAGNOSTICS n_events  = ROW_COUNT;
  DELETE FROM usage_agg       WHERE org_id = p_org AND bucket     < cutoff;                GET DIAGNOSTICS n_agg     = ROW_COUNT;
  DELETE FROM prompt_captures WHERE org_id = p_org AND created_at < cutoff;                GET DIAGNOSTICS n_prompts = ROW_COUNT;
  DELETE FROM spans           WHERE org_id = p_org AND COALESCE(start_time, created_at) < cutoff; GET DIAGNOSTICS n_spans = ROW_COUNT;
  DELETE FROM traces          WHERE org_id = p_org AND COALESCE(start_time, created_at) < cutoff; GET DIAGNOSTICS n_traces = ROW_COUNT;
  DELETE FROM ccr_store       WHERE org_id = p_org AND created_at < cutoff;                GET DIAGNOSTICS n_ccr     = ROW_COUNT;
  IF to_regclass('public.productivity_daily') IS NOT NULL THEN
    EXECUTE 'DELETE FROM productivity_daily WHERE org_id = $1 AND day < $2::date' USING p_org, cutoff;
    GET DIAGNOSTICS n_prod = ROW_COUNT;
  END IF;
  IF to_regclass('public.api_errors_daily') IS NOT NULL THEN
    EXECUTE 'DELETE FROM api_errors_daily WHERE org_id = $1 AND day < $2::date' USING p_org, cutoff;
    GET DIAGNOSTICS n_err = ROW_COUNT;
  END IF;
  IF p_before IS NULL THEN
    DELETE FROM otlp_metric_state WHERE org_id = p_org;   -- next export re-baselines cleanly
  END IF;
  RETURN jsonb_build_object(
    'usage_events', n_events, 'usage_agg', n_agg, 'prompt_captures', n_prompts,
    'spans', n_spans, 'traces', n_traces, 'ccr_store', n_ccr,
    'productivity_daily', n_prod, 'api_errors_daily', n_err);
END $$;
REVOKE EXECUTE ON FUNCTION public.purge_org_data(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_org_data(UUID, TIMESTAMPTZ) TO service_role;

NOTIFY pgrst, 'reload schema';
