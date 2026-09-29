-- TokenFin additive migration 006
-- Customer-controlled data retention and deletion (Settings → Data), plus a
-- server-side spend sum for the ingest hot path. Safe to re-run.

-- NULL = keep monitoring data forever; N = the daily purge deletes data older than N days.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS retention_days INT;
DO $$ BEGIN
  ALTER TABLE organizations ADD CONSTRAINT organizations_retention_days_chk
    CHECK (retention_days IS NULL OR retention_days BETWEEN 1 AND 3650);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Delete one org's monitoring data. p_before = NULL deletes everything.
-- Returns rows deleted per table. Service role only.
CREATE OR REPLACE FUNCTION public.purge_org_data(p_org UUID, p_before TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  n_events BIGINT; n_agg BIGINT; n_prompts BIGINT; n_spans BIGINT; n_traces BIGINT; n_ccr BIGINT;
  cutoff TIMESTAMPTZ := COALESCE(p_before, 'infinity'::timestamptz);
BEGIN
  DELETE FROM usage_events    WHERE org_id = p_org AND created_at < cutoff;                GET DIAGNOSTICS n_events  = ROW_COUNT;
  DELETE FROM usage_agg       WHERE org_id = p_org AND bucket     < cutoff;                GET DIAGNOSTICS n_agg     = ROW_COUNT;
  DELETE FROM prompt_captures WHERE org_id = p_org AND created_at < cutoff;                GET DIAGNOSTICS n_prompts = ROW_COUNT;
  DELETE FROM spans           WHERE org_id = p_org AND COALESCE(start_time, created_at) < cutoff; GET DIAGNOSTICS n_spans = ROW_COUNT;
  DELETE FROM traces          WHERE org_id = p_org AND COALESCE(start_time, created_at) < cutoff; GET DIAGNOSTICS n_traces = ROW_COUNT;
  DELETE FROM ccr_store       WHERE org_id = p_org AND created_at < cutoff;                GET DIAGNOSTICS n_ccr     = ROW_COUNT;
  IF p_before IS NULL THEN
    DELETE FROM otlp_metric_state WHERE org_id = p_org;   -- next export re-baselines cleanly
  END IF;
  RETURN jsonb_build_object(
    'usage_events', n_events, 'usage_agg', n_agg, 'prompt_captures', n_prompts,
    'spans', n_spans, 'traces', n_traces, 'ccr_store', n_ccr);
END $$;

-- Daily purge for every org with a retention setting (called by /api/v1/cron/retention).
CREATE OR REPLACE FUNCTION public.purge_expired_data()
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE r RECORD; out JSONB := '{}'::jsonb;
BEGIN
  FOR r IN SELECT id, retention_days FROM organizations WHERE retention_days IS NOT NULL LOOP
    out := out || jsonb_build_object(r.id::text, purge_org_data(r.id, now() - make_interval(days => r.retention_days)));
  END LOOP;
  -- Expired prompt text and compression cache, regardless of org setting.
  DELETE FROM prompt_captures WHERE expires_at < now();
  DELETE FROM ccr_store       WHERE expires_at < now();
  RETURN out;
END $$;

-- Month-to-date (or any window) spend in one query instead of paging raw rows
-- through the ingest route on every request.
CREATE OR REPLACE FUNCTION public.org_spend_since(p_org UUID, p_since TIMESTAMPTZ, p_metered_only BOOLEAN DEFAULT false)
RETURNS NUMERIC LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(SUM(cost_usd), 0) FROM usage_events
  WHERE org_id = p_org AND created_at >= p_since
    AND (NOT p_metered_only OR cost_basis IS DISTINCT FROM 'notional')
$$;

REVOKE EXECUTE ON FUNCTION public.purge_org_data(UUID, TIMESTAMPTZ)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_expired_data()                          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.org_spend_since(UUID, TIMESTAMPTZ, BOOLEAN)   FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_org_data(UUID, TIMESTAMPTZ)            TO service_role;
GRANT  EXECUTE ON FUNCTION public.purge_expired_data()                          TO service_role;
GRANT  EXECUTE ON FUNCTION public.org_spend_since(UUID, TIMESTAMPTZ, BOOLEAN)   TO service_role;

-- Covering index for the spend sum.
CREATE INDEX IF NOT EXISTS usage_events_org_created_cost
  ON usage_events (org_id, created_at DESC) INCLUDE (cost_usd, cost_basis);

NOTIFY pgrst, 'reload schema';
