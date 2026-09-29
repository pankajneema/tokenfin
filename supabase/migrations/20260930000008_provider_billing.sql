-- TokenFin additive migration 008
-- Provider bill reconciliation: org-connected read-only admin keys for the
-- Anthropic / OpenAI cost APIs, and the daily costs those providers report.
-- Compared on /dashboard/analytics/reconciliation against TokenFin's own
-- metered spend. Service role only. Safe to re-run; nothing is dropped.

CREATE TABLE IF NOT EXISTS provider_connections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL,
  key_enc        JSONB NOT NULL,                     -- sealKey(): {ciphertext, iv, authTag}
  key_hint       TEXT NOT NULL DEFAULT '',           -- masked, safe to display
  status         TEXT NOT NULL DEFAULT 'pending',    -- pending | ok | error
  last_synced_at TIMESTAMPTZ,
  last_error     TEXT,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, provider)
);
DO $$ BEGIN
  ALTER TABLE provider_connections ADD CONSTRAINT provider_connections_provider_chk
    CHECK (provider IN ('anthropic', 'openai'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE provider_connections ADD CONSTRAINT provider_connections_status_chk
    CHECK (status IN ('pending', 'ok', 'error'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS provider_costs (
  id                   BIGSERIAL PRIMARY KEY,
  org_id               UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider             TEXT NOT NULL,
  day                  DATE NOT NULL,                 -- UTC day as reported by the provider
  workspace_or_project TEXT NOT NULL DEFAULT '',
  line_item            TEXT NOT NULL DEFAULT '',
  model                TEXT NOT NULL DEFAULT '',
  cost_usd             NUMERIC(14,6) NOT NULL DEFAULT 0,
  input_tokens         BIGINT NOT NULL DEFAULT 0,
  output_tokens        BIGINT NOT NULL DEFAULT 0,
  cache_read_tokens    BIGINT NOT NULL DEFAULT 0,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, provider, day, workspace_or_project, line_item, model)
);
CREATE INDEX IF NOT EXISTS provider_costs_org_day ON provider_costs (org_id, day);

ALTER TABLE provider_connections ENABLE ROW LEVEL SECURITY;   -- service role only
ALTER TABLE provider_costs       ENABLE ROW LEVEL SECURITY;   -- service role only

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON provider_connections, provider_costs FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON provider_connections, provider_costs FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON provider_connections, provider_costs TO service_role';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE provider_costs_id_seq TO service_role';
  END IF;
END $$;

-- TokenFin's own METERED spend per UTC day and provider, for reconciliation.
-- Notional (subscription / CLI-agent) usage is never billed by the provider API
-- so it is excluded. Provider comes from usage_events.provider when it names
-- anthropic/openai; any other explicit provider (bedrock, vertex, azure, …) is
-- billed elsewhere and excluded; otherwise it is inferred from the model name.
CREATE OR REPLACE FUNCTION public.reconciliation_metered_daily(p_org UUID, p_since DATE)
RETURNS TABLE (day DATE, provider TEXT, cost_usd NUMERIC, events BIGINT)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH e AS (
    SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
           cost_usd,
           CASE
             WHEN lower(coalesce(provider, '')) IN ('anthropic', 'openai') THEN lower(provider)
             WHEN coalesce(provider, '') <> '' THEN NULL
             WHEN lower(regexp_replace(model, '^(anthropic|openai)/', '')) LIKE 'claude%' THEN 'anthropic'
             WHEN lower(regexp_replace(model, '^(anthropic|openai)/', '')) ~ '^(gpt|o1|o3|o4|chatgpt|text-embedding|codex)' THEN 'openai'
             ELSE NULL
           END AS provider
    FROM usage_events
    WHERE org_id = p_org
      AND created_at >= (p_since::timestamp AT TIME ZONE 'UTC')
      AND cost_basis IS DISTINCT FROM 'notional'
  )
  SELECT day, provider, SUM(cost_usd), COUNT(*)::bigint
  FROM e WHERE provider IS NOT NULL
  GROUP BY day, provider
$$;
REVOKE EXECUTE ON FUNCTION public.reconciliation_metered_daily(UUID, DATE) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.reconciliation_metered_daily(UUID, DATE) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.reconciliation_metered_daily(UUID, DATE) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.reconciliation_metered_daily(UUID, DATE) TO service_role';
  END IF;
END $$;
