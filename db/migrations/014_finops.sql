-- TokenFin additive migration 014 — FinOps exports & governance.
--   * allocation_rules        : tag/repo/email/project → team & cost center (+ shared-cost split)
--   * price_sync_findings     : nightly catalog-vs-public-source diffs and unpriced models seen
--   * finops_usage_dims()     : event-level usage grouped by the dimensions allocation needs
--                               (FOCUS export, allocation preview)
--   * price_sync_model_usage(): which orgs used which models recently (and how many unpriced)
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS allocation_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'assign',
  priority    INTEGER NOT NULL DEFAULT 100,
  match       JSONB NOT NULL DEFAULT '{}'::jsonb,
  assign      JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  ALTER TABLE allocation_rules ADD CONSTRAINT allocation_rules_kind_check CHECK (kind IN ('assign', 'shared_split'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS allocation_rules_org_priority ON allocation_rules (org_id, priority, created_at);
ALTER TABLE allocation_rules ENABLE ROW LEVEL SECURITY;          -- service role only
GRANT ALL ON allocation_rules TO service_role;

CREATE TABLE IF NOT EXISTS price_sync_findings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model       TEXT NOT NULL,
  kind        TEXT NOT NULL,                    -- price_mismatch | unpriced_seen
  ours        JSONB NOT NULL DEFAULT '{}'::jsonb,
  theirs      JSONB NOT NULL DEFAULT '{}'::jsonb,
  orgs        UUID[] NOT NULL DEFAULT '{}',     -- orgs that used the model recently (scopes visibility)
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);
DO $$ BEGIN
  ALTER TABLE price_sync_findings ADD CONSTRAINT price_sync_findings_kind_check CHECK (kind IN ('price_mismatch', 'unpriced_seen'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS price_sync_findings_model_kind ON price_sync_findings (model, kind);
CREATE INDEX IF NOT EXISTS price_sync_findings_orgs ON price_sync_findings USING GIN (orgs);
ALTER TABLE price_sync_findings ENABLE ROW LEVEL SECURITY;       -- service role only
GRANT ALL ON price_sync_findings TO service_role;

-- Usage grouped by every dimension allocation rules can match on. One row per
-- (day?, provider, model, project, source, cost_basis, user, email, repo, tag subset).
-- p_by_day = false collapses the day dimension (allocation preview).
CREATE OR REPLACE FUNCTION public.finops_usage_dims(
  p_org UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tz TEXT DEFAULT 'UTC',
  p_tag_keys TEXT[] DEFAULT '{}', p_by_day BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  day DATE, provider TEXT, model TEXT, project_id UUID, source TEXT, cost_basis TEXT,
  user_id UUID, user_email TEXT, repo TEXT, tag_values JSONB,
  events BIGINT, input_tokens BIGINT, output_tokens BIGINT, cache_read_tokens BIGINT,
  cache_write_tokens BIGINT, reasoning_tokens BIGINT, total_tokens BIGINT,
  cost_usd NUMERIC, vendor_cost_usd NUMERIC
)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT
    CASE WHEN p_by_day THEN (e.created_at AT TIME ZONE COALESCE(p_tz, 'UTC'))::date END AS day,
    e.provider, e.model, e.project_id, e.source, e.cost_basis,
    e.user_id, e.user_email, e.repo,
    COALESCE((SELECT jsonb_object_agg(k, e.tags->>k) FROM unnest(p_tag_keys) k WHERE e.tags ? k), '{}'::jsonb) AS tag_values,
    COUNT(*)::bigint,
    COALESCE(SUM(e.input_tokens), 0)::bigint, COALESCE(SUM(e.output_tokens), 0)::bigint,
    COALESCE(SUM(e.cache_read_tokens), 0)::bigint, COALESCE(SUM(e.cache_write_tokens), 0)::bigint,
    COALESCE(SUM(e.reasoning_tokens), 0)::bigint, COALESCE(SUM(e.total_tokens), 0)::bigint,
    COALESCE(SUM(e.cost_usd), 0), SUM(e.vendor_cost_usd)
  FROM usage_events e
  WHERE e.org_id = p_org AND e.created_at >= p_from AND e.created_at < p_to
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
  ORDER BY 1, 2, 3, 4, 5, 6, 7, 8, 9
$$;
REVOKE EXECUTE ON FUNCTION public.finops_usage_dims(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT[], BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.finops_usage_dims(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT[], BOOLEAN) TO service_role;

-- Models each org used since p_since, with how many events were priced with
-- the fallback rate (ingest tags them price_known = 'false').
CREATE OR REPLACE FUNCTION public.price_sync_model_usage(p_since TIMESTAMPTZ)
RETURNS TABLE (org_id UUID, model TEXT, events BIGINT, unpriced BIGINT)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT e.org_id, e.model, COUNT(*)::bigint,
         COUNT(*) FILTER (WHERE e.tags->>'price_known' = 'false')::bigint
  FROM usage_events e
  WHERE e.created_at >= p_since
  GROUP BY e.org_id, e.model
$$;
REVOKE EXECUTE ON FUNCTION public.price_sync_model_usage(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.price_sync_model_usage(TIMESTAMPTZ) TO service_role;

NOTIFY pgrst, 'reload schema';
