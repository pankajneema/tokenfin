-- 021: session names.
--
-- A session gets a human title instead of a bare id:
--   origin 'explicit' — the agent's own title (OpenCode sends it); always wins.
--   origin 'prompt'   — the first line of the session's first captured prompt;
--                       written once, never overwrites an existing title.
-- tf_set_session_title() applies those rules atomically. A backfill names every
-- existing session from its earliest captured prompt. purge_org_data (last set
-- in 015) also clears titles. Idempotent.

CREATE TABLE IF NOT EXISTS public.session_titles (
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  title      TEXT NOT NULL,
  origin     TEXT NOT NULL DEFAULT 'prompt' CHECK (origin IN ('explicit', 'prompt')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, session_id)
);
ALTER TABLE public.session_titles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.session_titles FROM anon, authenticated;
GRANT  ALL ON public.session_titles TO service_role;

-- First non-empty line, whitespace collapsed, at most 120 characters.
CREATE OR REPLACE FUNCTION public.tf_title_from_text(p_text TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  WITH l AS (
    SELECT btrim(regexp_replace(line, '\s+', ' ', 'g')) AS line, n
    FROM regexp_split_to_table(coalesce(p_text, ''), E'\n') WITH ORDINALITY AS t(line, n)
  ), f AS (SELECT line FROM l WHERE line <> '' ORDER BY n LIMIT 1)
  SELECT CASE WHEN length(line) > 120 THEN left(line, 119) || '…' ELSE line END FROM f
$$;

CREATE OR REPLACE FUNCTION public.tf_set_session_title(p_org UUID, p_session TEXT, p_title TEXT, p_origin TEXT)
RETURNS VOID LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_title TEXT := public.tf_title_from_text(p_title);
BEGIN
  IF p_org IS NULL OR coalesce(p_session, '') = '' OR coalesce(v_title, '') = '' THEN RETURN; END IF;
  IF p_origin = 'explicit' THEN
    INSERT INTO session_titles AS t (org_id, session_id, title, origin)
    VALUES (p_org, p_session, v_title, 'explicit')
    ON CONFLICT (org_id, session_id) DO UPDATE
      SET title = EXCLUDED.title, origin = 'explicit', updated_at = now()
      WHERE t.title IS DISTINCT FROM EXCLUDED.title OR t.origin <> 'explicit';
  ELSE
    INSERT INTO session_titles (org_id, session_id, title, origin)
    VALUES (p_org, p_session, v_title, 'prompt')
    ON CONFLICT (org_id, session_id) DO NOTHING;
  END IF;
END $$;

-- Backfill: each session's earliest captured prompt.
INSERT INTO public.session_titles (org_id, session_id, title, origin)
SELECT DISTINCT ON (e.org_id, e.session_id) e.org_id, e.session_id, public.tf_title_from_text(pc.prompt_text), 'prompt'
FROM public.usage_events e
JOIN public.prompt_captures pc ON pc.org_id = e.org_id AND pc.prompt_hash = e.correlation_id
WHERE e.session_id IS NOT NULL AND coalesce(public.tf_title_from_text(pc.prompt_text), '') <> ''
ORDER BY e.org_id, e.session_id, e.created_at, e.id
ON CONFLICT (org_id, session_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.purge_org_data(p_org UUID, p_before TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  n_events BIGINT; n_agg BIGINT; n_prompts BIGINT; n_spans BIGINT; n_traces BIGINT; n_ccr BIGINT;
  n_prod BIGINT := 0; n_err BIGINT := 0; n_daily BIGINT := 0; n_tools BIGINT := 0; n_prs BIGINT := 0;
  cutoff TIMESTAMPTZ := COALESCE(p_before, 'infinity'::timestamptz);
BEGIN
  IF p_before IS NULL THEN
    PERFORM set_config('tokenfin.skip_rollups', 'on', true);
    DELETE FROM usage_events WHERE org_id = p_org;                                        GET DIAGNOSTICS n_events = ROW_COUNT;
    PERFORM set_config('tokenfin.skip_rollups', 'off', true);
    DELETE FROM usage_daily         WHERE org_id = p_org;                                 GET DIAGNOSTICS n_daily = ROW_COUNT;
    DELETE FROM usage_sessions      WHERE org_id = p_org;
    DELETE FROM usage_daily_prompts WHERE org_id = p_org;
  ELSE
    DELETE FROM usage_events WHERE org_id = p_org AND created_at < cutoff;                GET DIAGNOSTICS n_events = ROW_COUNT;
  END IF;
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
  IF to_regclass('public.coding_tool_usage') IS NOT NULL THEN
    EXECUTE 'DELETE FROM coding_tool_usage WHERE org_id = $1 AND day < $2::date' USING p_org, cutoff;
    GET DIAGNOSTICS n_tools = ROW_COUNT;
  END IF;
  IF to_regclass('public.merged_prs') IS NOT NULL THEN
    EXECUTE 'DELETE FROM merged_prs WHERE org_id = $1 AND merged_at < $2' USING p_org, cutoff;
    GET DIAGNOSTICS n_prs = ROW_COUNT;
  END IF;
  IF p_before IS NULL AND to_regclass('public.price_sync_findings') IS NOT NULL THEN
    EXECUTE 'UPDATE price_sync_findings SET orgs = array_remove(orgs, $1) WHERE $1 = ANY(orgs)' USING p_org;
  END IF;
  -- Session names: all of them on a full wipe, otherwise the ones whose
  -- session has no events left (the rollup triggers already removed those).
  IF to_regclass('public.session_titles') IS NOT NULL THEN
    EXECUTE 'DELETE FROM session_titles t WHERE t.org_id = $1 AND ($2::timestamptz IS NULL OR NOT EXISTS (
               SELECT 1 FROM usage_sessions s WHERE s.org_id = t.org_id AND s.session_id = t.session_id))'
      USING p_org, p_before;
  END IF;
  IF p_before IS NULL THEN
    DELETE FROM otlp_metric_state WHERE org_id = p_org;   -- next export re-baselines cleanly
  END IF;
  RETURN jsonb_build_object(
    'usage_events', n_events, 'usage_agg', n_agg, 'prompt_captures', n_prompts,
    'spans', n_spans, 'traces', n_traces, 'ccr_store', n_ccr,
    'productivity_daily', n_prod, 'api_errors_daily', n_err, 'usage_daily', n_daily,
    'coding_tool_usage', n_tools, 'merged_prs', n_prs);
END $$;

REVOKE EXECUTE ON FUNCTION public.tf_set_session_title(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tf_set_session_title(UUID, TEXT, TEXT, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.tf_title_from_text(TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tf_title_from_text(TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.purge_org_data(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_org_data(UUID, TIMESTAMPTZ) TO service_role;
