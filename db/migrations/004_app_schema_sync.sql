-- TokenFin additive migration 004
-- Brings a fresh database up to what the application code reads and writes.
-- Found by applying 001–003 to an empty Supabase project and running the app:
-- signup, key creation, alerts, limits, integrations, preferences, the model
-- registry and My Usage all failed on objects that no migration created.
-- Safe to re-run on an existing database; nothing is dropped or rewritten.

-- usage_events.user_id — written by ingest + OTLP, read by My Usage / limits / alerts.
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS user_id UUID;
CREATE INDEX IF NOT EXISTS usage_events_org_user_created
  ON usage_events (org_id, user_id, created_at DESC) WHERE user_id IS NOT NULL;

-- api_keys: environment, scopes, expiry (key creation, ingest auth, MCP auth).
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS env        TEXT   NOT NULL DEFAULT 'production';
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scopes     TEXT[] NOT NULL DEFAULT '{read,write}';
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- alert_rules: fields the alerts UI and cron engine use.
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS condition      TEXT NOT NULL DEFAULT '';
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS scope          TEXT NOT NULL DEFAULT 'All projects';
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS cooldown_hours INT  NOT NULL DEFAULT 4;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS fired_count    INT  NOT NULL DEFAULT 0;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS last_fired_at  TIMESTAMPTZ;

-- limits: metric/value (By Project budget column).
ALTER TABLE limits ADD COLUMN IF NOT EXISTS metric TEXT NOT NULL DEFAULT 'cost_usd';
ALTER TABLE limits ADD COLUMN IF NOT EXISTS value  NUMERIC(14,4);

-- Integrations (Slack / webhook channels).
CREATE TABLE IF NOT EXISTS org_integrations (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider       TEXT,
  integration    TEXT,
  config         JSONB NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'active',
  is_active      BOOLEAN NOT NULL DEFAULT true,
  connected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  sync_ok        BOOLEAN NOT NULL DEFAULT true,
  detail         TEXT,
  UNIQUE (org_id, provider)
);
ALTER TABLE org_integrations ENABLE ROW LEVEL SECURITY;   -- service role only

-- Per-user preferences (settings pages).
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  key      TEXT  NOT NULL DEFAULT 'settings',
  value    JSONB NOT NULL DEFAULT '{}',
  settings JSONB NOT NULL DEFAULT '{}'
);
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;   -- service role only

-- Org model registry (Models page).
CREATE TABLE IF NOT EXISTS org_models (
  id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  model    TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, model)
);
ALTER TABLE org_models ENABLE ROW LEVEL SECURITY;         -- service role only

-- Deleting an API key or a project must not fail because it has usage. Keep
-- the usage rows (spend totals stay correct) and detach them instead.
ALTER TABLE usage_events ALTER COLUMN api_key_id DROP NOT NULL;
ALTER TABLE usage_events ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE usage_events DROP CONSTRAINT IF EXISTS usage_events_api_key_id_fkey;
ALTER TABLE usage_events ADD  CONSTRAINT usage_events_api_key_id_fkey
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL;
ALTER TABLE usage_events DROP CONSTRAINT IF EXISTS usage_events_project_id_fkey;
ALTER TABLE usage_events ADD  CONSTRAINT usage_events_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
-- Daily totals keep counting toward org spend after their project is deleted.
ALTER TABLE usage_agg ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE usage_agg DROP CONSTRAINT IF EXISTS usage_agg_project_id_fkey;
ALTER TABLE usage_agg ADD  CONSTRAINT usage_agg_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
-- Project-scoped rules, blocks and budget requests go with their project.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['alert_rules', 'blocks', 'budget_requests'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_project_id_fkey');
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE', t, t || '_project_id_fkey');
    END IF;
  END LOOP;
END $$;

-- CLI-agent prompt rows have no model of their own (it comes from the joined
-- api_request events), so don't require one.
ALTER TABLE prompt_captures ALTER COLUMN model SET DEFAULT '';

-- Newer Supabase projects no longer grant table access to service_role by
-- default. Every server route uses the service-role client, so without this
-- the very first signup fails with "permission denied for table organizations".
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

NOTIFY pgrst, 'reload schema';
