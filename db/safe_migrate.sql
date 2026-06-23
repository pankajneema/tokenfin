-- ============================================================
-- TokenFin — Safe Migration (idempotent, run any number of times)
-- Supabase SQL Editor:
-- https://supabase.com/dashboard/project/jolfgtrjvfueoaoopous/sql/new
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- 1. TABLES — CREATE IF NOT EXISTS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organizations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  plan        TEXT NOT NULL DEFAULT 'free',
  kill_switch BOOLEAN NOT NULL DEFAULT false,
  owner_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, slug)
);

CREATE TABLE IF NOT EXISTS teams (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS members (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id    UUID REFERENCES teams(id) ON DELETE SET NULL,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'developer',
  invited_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, user_id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id   UUID REFERENCES projects(id) ON DELETE CASCADE,
  created_by   UUID REFERENCES auth.users(id),
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  key_prefix   TEXT NOT NULL,
  env          TEXT NOT NULL DEFAULT 'production',
  scopes       TEXT[] NOT NULL DEFAULT '{read,write}',
  expires_at   TIMESTAMPTZ,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usage_events (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  api_key_id        UUID REFERENCES api_keys(id),
  project_id        UUID NOT NULL REFERENCES projects(id),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  user_id           UUID REFERENCES auth.users(id),
  model             TEXT NOT NULL,
  input_tokens      BIGINT NOT NULL DEFAULT 0,
  output_tokens     BIGINT NOT NULL DEFAULT 0,
  total_tokens      BIGINT NOT NULL DEFAULT 0,
  cost_usd          NUMERIC(14,8) NOT NULL DEFAULT 0,
  tags              JSONB NOT NULL DEFAULT '{}',
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usage_agg (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bucket        DATE NOT NULL,
  project_id    UUID NOT NULL REFERENCES projects(id),
  org_id        UUID NOT NULL REFERENCES organizations(id),
  model         TEXT NOT NULL,
  total_tokens  BIGINT NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(14,8) NOT NULL DEFAULT 0,
  request_count INT NOT NULL DEFAULT 0,
  UNIQUE(bucket, project_id, model)
);

CREATE TABLE IF NOT EXISTS limits (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
  team_id     UUID REFERENCES teams(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL DEFAULT 'org',
  period      TEXT NOT NULL DEFAULT 'monthly',
  metric      TEXT NOT NULL DEFAULT 'cost_usd',
  value       NUMERIC(14,4),
  budget_usd  NUMERIC(12,2) NOT NULL DEFAULT 0,
  warn_at     INT NOT NULL DEFAULT 70,
  throttle_at INT NOT NULL DEFAULT 90,
  block_at    INT NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id     UUID REFERENCES projects(id),
  name           TEXT NOT NULL,
  trigger_type   TEXT NOT NULL DEFAULT 'threshold',
  condition      TEXT NOT NULL DEFAULT '',
  scope          TEXT NOT NULL DEFAULT 'All projects',
  threshold      NUMERIC(12,2),
  cooldown_hours INT NOT NULL DEFAULT 4,
  fired_count    INT NOT NULL DEFAULT 0,
  last_fired_at  TIMESTAMPTZ,
  channels       JSONB NOT NULL DEFAULT '{"email":true}',
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES auth.users(id),
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
  UNIQUE(org_id, provider)
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  key      TEXT NOT NULL DEFAULT 'settings',
  value    JSONB NOT NULL DEFAULT '{}',
  settings JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS invitations (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member',
  status     TEXT NOT NULL DEFAULT 'pending',
  token      TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, email)
);

CREATE TABLE IF NOT EXISTS model_prices (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  model          TEXT NOT NULL UNIQUE,
  provider       TEXT NOT NULL,
  input_per_1m   NUMERIC(12,6) NOT NULL,
  output_per_1m  NUMERIC(12,6) NOT NULL,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 2. ADD MISSING COLUMNS (safe — skips if already exists)
-- ─────────────────────────────────────────────────────────────

-- organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS kill_switch BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- api_keys
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS env TEXT NOT NULL DEFAULT 'production';
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT '{read,write}';
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

-- usage_events — normalize column names (app uses input_tokens/output_tokens)
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS input_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS output_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '{}';
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

-- usage_agg — bucket should be DATE not TIMESTAMPTZ
ALTER TABLE usage_agg ADD COLUMN IF NOT EXISTS request_count INT NOT NULL DEFAULT 0;

-- limits
ALTER TABLE limits ADD COLUMN IF NOT EXISTS metric TEXT NOT NULL DEFAULT 'cost_usd';
ALTER TABLE limits ADD COLUMN IF NOT EXISTS value NUMERIC(14,4);
ALTER TABLE limits ADD COLUMN IF NOT EXISTS budget_usd NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE limits ADD COLUMN IF NOT EXISTS throttle_at INT NOT NULL DEFAULT 90;

-- alert_rules
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'All projects';
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS condition TEXT NOT NULL DEFAULT '';
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS fired_count INT NOT NULL DEFAULT 0;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS last_fired_at TIMESTAMPTZ;

-- org_integrations
ALTER TABLE org_integrations ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE org_integrations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE org_integrations ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE org_integrations ADD COLUMN IF NOT EXISTS sync_ok BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE org_integrations ADD COLUMN IF NOT EXISTS detail TEXT;

-- user_preferences
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS key TEXT NOT NULL DEFAULT 'settings';
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS value JSONB NOT NULL DEFAULT '{}';
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';

-- members
ALTER TABLE members ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE members ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users(id);

-- ─────────────────────────────────────────────────────────────
-- 3. INDEXES
-- ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS usage_events_org_created     ON usage_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_project_created ON usage_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_agg_org_bucket         ON usage_agg(org_id, bucket DESC);
CREATE INDEX IF NOT EXISTS notifications_user_read      ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS org_integrations_org         ON org_integrations(org_id);

-- ─────────────────────────────────────────────────────────────
-- 4. updated_at TRIGGER
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS organizations_updated_at ON organizations;
CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 5. MODEL PRICES SEED
-- ─────────────────────────────────────────────────────────────

INSERT INTO model_prices (model, provider, input_per_1m, output_per_1m) VALUES
  ('gpt-4o',            'openai',     5.00,  15.00),
  ('gpt-4o-mini',       'openai',     0.15,   0.60),
  ('gpt-4-turbo',       'openai',    10.00,  30.00),
  ('gpt-3.5-turbo',     'openai',     0.50,   1.50),
  ('claude-opus-4-8',   'anthropic', 15.00,  75.00),
  ('claude-sonnet-4-6', 'anthropic',  3.00,  15.00),
  ('claude-haiku-4-5',  'anthropic',  0.25,   1.25),
  ('gemini-1.5-pro',    'google',     3.50,  10.50),
  ('gemini-1.5-flash',  'google',     0.075,  0.30),
  ('gemini-2.0-flash',  'google',     0.10,   0.40),
  ('llama-3.1-70b',     'meta',       0.59,   0.79)
ON CONFLICT (model) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 6. RLS POLICIES — drop first, then recreate (safe)
-- ─────────────────────────────────────────────────────────────

-- organizations
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "organizations_insert" ON organizations;
DROP POLICY IF EXISTS "organizations_select" ON organizations;
DROP POLICY IF EXISTS "organizations_update" ON organizations;
CREATE POLICY "organizations_insert" ON organizations FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "organizations_select" ON organizations FOR SELECT USING (
  auth.uid() = owner_id OR
  EXISTS (SELECT 1 FROM members WHERE members.org_id = organizations.id AND members.user_id = auth.uid())
);
CREATE POLICY "organizations_update" ON organizations FOR UPDATE
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- projects
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "projects_select" ON projects;
DROP POLICY IF EXISTS "projects_insert" ON projects;
DROP POLICY IF EXISTS "projects_update" ON projects;
DROP POLICY IF EXISTS "projects_delete" ON projects;
CREATE POLICY "projects_select" ON projects FOR SELECT USING (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = projects.org_id AND members.user_id = auth.uid())
);
CREATE POLICY "projects_insert" ON projects FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = projects.org_id AND members.user_id = auth.uid())
);
CREATE POLICY "projects_update" ON projects FOR UPDATE USING (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = projects.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
);
CREATE POLICY "projects_delete" ON projects FOR DELETE USING (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = projects.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
);

-- members
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members_select" ON members;
DROP POLICY IF EXISTS "members_insert" ON members;
DROP POLICY IF EXISTS "members_delete" ON members;
CREATE POLICY "members_select" ON members FOR SELECT USING (
  EXISTS (SELECT 1 FROM members AS m WHERE m.org_id = members.org_id AND m.user_id = auth.uid())
);
CREATE POLICY "members_insert" ON members FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "members_delete" ON members FOR DELETE USING (
  EXISTS (SELECT 1 FROM members AS m WHERE m.org_id = members.org_id AND m.user_id = auth.uid() AND m.role IN ('owner','admin'))
);

-- api_keys
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "api_keys_select" ON api_keys;
DROP POLICY IF EXISTS "api_keys_insert" ON api_keys;
DROP POLICY IF EXISTS "api_keys_update" ON api_keys;
DROP POLICY IF EXISTS "api_keys_delete" ON api_keys;
CREATE POLICY "api_keys_select" ON api_keys FOR SELECT USING (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = api_keys.org_id AND members.user_id = auth.uid())
);
CREATE POLICY "api_keys_insert" ON api_keys FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = api_keys.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
);
CREATE POLICY "api_keys_update" ON api_keys FOR UPDATE USING (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = api_keys.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
);
CREATE POLICY "api_keys_delete" ON api_keys FOR DELETE USING (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = api_keys.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
);

-- usage_events
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "usage_events_select" ON usage_events;
CREATE POLICY "usage_events_select" ON usage_events FOR SELECT USING (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = usage_events.org_id AND members.user_id = auth.uid())
);

-- usage_agg
ALTER TABLE usage_agg ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "usage_agg_select" ON usage_agg;
CREATE POLICY "usage_agg_select" ON usage_agg FOR SELECT USING (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = usage_agg.org_id AND members.user_id = auth.uid())
);

-- limits
ALTER TABLE limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "limits_select" ON limits;
DROP POLICY IF EXISTS "limits_insert" ON limits;
DROP POLICY IF EXISTS "limits_update" ON limits;
DROP POLICY IF EXISTS "limits_delete" ON limits;
CREATE POLICY "limits_select" ON limits FOR SELECT USING (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = limits.org_id AND members.user_id = auth.uid())
);
CREATE POLICY "limits_insert" ON limits FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = limits.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
);
CREATE POLICY "limits_update" ON limits FOR UPDATE USING (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = limits.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
);
CREATE POLICY "limits_delete" ON limits FOR DELETE USING (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = limits.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
);

-- alert_rules
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "alert_rules_select" ON alert_rules;
DROP POLICY IF EXISTS "alert_rules_insert" ON alert_rules;
DROP POLICY IF EXISTS "alert_rules_update" ON alert_rules;
DROP POLICY IF EXISTS "alert_rules_delete" ON alert_rules;
CREATE POLICY "alert_rules_select" ON alert_rules FOR SELECT USING (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = alert_rules.org_id AND members.user_id = auth.uid())
);
CREATE POLICY "alert_rules_insert" ON alert_rules FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = alert_rules.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
);
CREATE POLICY "alert_rules_update" ON alert_rules FOR UPDATE USING (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = alert_rules.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
);
CREATE POLICY "alert_rules_delete" ON alert_rules FOR DELETE USING (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = alert_rules.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
);

-- notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_select" ON notifications;
DROP POLICY IF EXISTS "notifications_update" ON notifications;
CREATE POLICY "notifications_select" ON notifications FOR SELECT USING (
  user_id = auth.uid() OR user_id IS NULL
);
CREATE POLICY "notifications_update" ON notifications FOR UPDATE USING (
  user_id = auth.uid()
);

-- org_integrations
ALTER TABLE org_integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_integrations_select" ON org_integrations;
DROP POLICY IF EXISTS "org_integrations_insert" ON org_integrations;
DROP POLICY IF EXISTS "org_integrations_delete" ON org_integrations;
CREATE POLICY "org_integrations_select" ON org_integrations FOR SELECT USING (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = org_integrations.org_id AND members.user_id = auth.uid())
);
CREATE POLICY "org_integrations_insert" ON org_integrations FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = org_integrations.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
);
CREATE POLICY "org_integrations_delete" ON org_integrations FOR DELETE USING (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = org_integrations.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
);

-- user_preferences
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_preferences_select" ON user_preferences;
DROP POLICY IF EXISTS "user_preferences_insert" ON user_preferences;
DROP POLICY IF EXISTS "user_preferences_update" ON user_preferences;
CREATE POLICY "user_preferences_select" ON user_preferences FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "user_preferences_insert" ON user_preferences FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "user_preferences_update" ON user_preferences FOR UPDATE USING (user_id = auth.uid());

-- invitations
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invitations_select" ON invitations;
DROP POLICY IF EXISTS "invitations_insert" ON invitations;
CREATE POLICY "invitations_select" ON invitations FOR SELECT USING (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = invitations.org_id AND members.user_id = auth.uid())
);
CREATE POLICY "invitations_insert" ON invitations FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM organizations WHERE organizations.id = invitations.org_id AND organizations.owner_id = auth.uid())
);

-- teams
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "teams_select" ON teams;
DROP POLICY IF EXISTS "teams_insert" ON teams;
CREATE POLICY "teams_select" ON teams FOR SELECT USING (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = teams.org_id AND members.user_id = auth.uid())
);
CREATE POLICY "teams_insert" ON teams FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM members WHERE members.org_id = teams.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
);

-- ─────────────────────────────────────────────────────────────
-- Done. All tables, columns, indexes, and policies are set.
-- ─────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────
-- SQL Functions (from functions.sql — safe to re-run)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION upsert_usage_agg(
  p_bucket     DATE,
  p_project_id UUID,
  p_org_id     UUID,
  p_model      TEXT,
  p_tokens     BIGINT,
  p_cost       NUMERIC,
  p_requests   INT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO usage_agg (bucket, project_id, org_id, model, total_tokens, cost_usd, request_count)
  VALUES (p_bucket, p_project_id, p_org_id, p_model, p_tokens, p_cost, p_requests)
  ON CONFLICT (bucket, project_id, model) DO UPDATE SET
    total_tokens  = usage_agg.total_tokens  + EXCLUDED.total_tokens,
    cost_usd      = usage_agg.cost_usd      + EXCLUDED.cost_usd,
    request_count = usage_agg.request_count + EXCLUDED.request_count;
END;
$$;

CREATE OR REPLACE FUNCTION upsert_usage_agg_batch(rows JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO usage_agg (bucket, project_id, org_id, model, total_tokens, cost_usd, request_count)
  SELECT
    (r->>'p_bucket')::DATE,
    (r->>'p_project_id')::UUID,
    (r->>'p_org_id')::UUID,
    (r->>'p_model')::TEXT,
    (r->>'p_tokens')::BIGINT,
    (r->>'p_cost')::NUMERIC,
    (r->>'p_requests')::INT
  FROM jsonb_array_elements(rows) AS r
  ON CONFLICT (bucket, project_id, model) DO UPDATE SET
    total_tokens  = usage_agg.total_tokens  + EXCLUDED.total_tokens,
    cost_usd      = usage_agg.cost_usd      + EXCLUDED.cost_usd,
    request_count = usage_agg.request_count + EXCLUDED.request_count;
END;
$$;
