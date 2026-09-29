-- 015: retention covers the connector tables (013).
--
-- Redefines purge_org_data (last set in 011) so Settings → Data and the daily
-- retention cron also clear coding_tool_usage (by vendor day) and merged_prs
-- (by merged_at). A full wipe also removes the org from price_sync_findings.orgs
-- (014). Same signature and return shape (two extra counters). Idempotent.

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
  IF p_before IS NULL THEN
    DELETE FROM otlp_metric_state WHERE org_id = p_org;   -- next export re-baselines cleanly
  END IF;
  RETURN jsonb_build_object(
    'usage_events', n_events, 'usage_agg', n_agg, 'prompt_captures', n_prompts,
    'spans', n_spans, 'traces', n_traces, 'ccr_store', n_ccr,
    'productivity_daily', n_prod, 'api_errors_daily', n_err, 'usage_daily', n_daily,
    'coding_tool_usage', n_tools, 'merged_prs', n_prs);
END $$;

REVOKE EXECUTE ON FUNCTION public.purge_org_data(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_org_data(UUID, TIMESTAMPTZ) TO service_role;
