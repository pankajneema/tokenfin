-- ============================================================
-- TokenFin — Full Database Schema (fresh install)
-- Run ONCE on a new Supabase project:
-- https://supabase.com/dashboard/project/YOUR_PROJECT/sql/new
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── updated_at helper ────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

-- ─────────────────────────────────────────────────────────────
-- TABLES
-- ─────────────────────────────────────────────────────────────

-- ── organizations ────────────────────────────────────────────
CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  plan        TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','team','enterprise')),
  kill_switch BOOLEAN NOT NULL DEFAULT false,
  owner_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── projects ─────────────────────────────────────────────────
CREATE TABLE projects (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, slug)
);

-- ── teams ────────────────────────────────────────────────────
CREATE TABLE teams (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── members ──────────────────────────────────────────────────
CREATE TABLE members (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id    UUID REFERENCES teams(id) ON DELETE SET NULL,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'developer' CHECK (role IN ('owner','admin','developer','viewer')),
  invited_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, user_id)
);

-- ── api_keys ─────────────────────────────────────────────────
CREATE TABLE api_keys (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id   UUID REFERENCES projects(id) ON DELETE CASCADE,
  created_by   UUID REFERENCES auth.users(id),
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  key_prefix   TEXT NOT NULL,
  env          TEXT NOT NULL DEFAULT 'production' CHECK (env IN ('production','staging','development')),
  scopes       TEXT[] NOT NULL DEFAULT '{read,write}',
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  expires_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── usage_events ─────────────────────────────────────────────
CREATE TABLE usage_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id),
  model         TEXT NOT NULL,
  input_tokens  BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  total_tokens  BIGINT NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(14,8) NOT NULL DEFAULT 0,
  tags          JSONB NOT NULL DEFAULT '{}',
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX usage_events_org_created     ON usage_events(org_id, created_at DESC);
CREATE INDEX usage_events_project_created ON usage_events(project_id, created_at DESC);
CREATE INDEX usage_events_model           ON usage_events(model);

-- ── usage_agg ────────────────────────────────────────────────
-- Pre-aggregated daily buckets — the central analytics table.
-- Written by the Go worker via upsert after each ingest batch.
CREATE TABLE usage_agg (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  model         TEXT NOT NULL,
  bucket        DATE NOT NULL,   -- daily: YYYY-MM-DD
  total_tokens  BIGINT NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(14,8) NOT NULL DEFAULT 0,
  request_count INT NOT NULL DEFAULT 0,
  UNIQUE(org_id, project_id, model, bucket)
);

CREATE INDEX usage_agg_org_bucket     ON usage_agg(org_id, bucket DESC);
CREATE INDEX usage_agg_project_bucket ON usage_agg(project_id, bucket DESC);

-- ── limits ───────────────────────────────────────────────────
CREATE TABLE limits (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
  team_id     UUID REFERENCES teams(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL DEFAULT 'org' CHECK (scope IN ('org','project','team','member')),
  metric      TEXT NOT NULL DEFAULT 'cost_usd',
  period      TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('daily','weekly','monthly')),
  value       NUMERIC(14,4),
  budget_usd  NUMERIC(12,2) NOT NULL DEFAULT 0,
  warn_at     INT NOT NULL DEFAULT 70,
  throttle_at INT NOT NULL DEFAULT 90,
  block_at    INT NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── alert_rules ──────────────────────────────────────────────
CREATE TABLE alert_rules (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id     UUID REFERENCES projects(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  trigger_type   TEXT NOT NULL DEFAULT 'threshold' CHECK (trigger_type IN ('threshold','anomaly','limit_breach','member')),
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

-- ── notifications ────────────────────────────────────────────
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES auth.users(id),
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX notifications_user_read ON notifications(user_id, is_read, created_at DESC);

-- ── org_integrations ─────────────────────────────────────────
CREATE TABLE org_integrations (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active',
  config         JSONB NOT NULL DEFAULT '{}',
  is_active      BOOLEAN NOT NULL DEFAULT true,
  connected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  sync_ok        BOOLEAN NOT NULL DEFAULT true,
  detail         TEXT,
  UNIQUE(org_id, provider)
);

CREATE INDEX org_integrations_org ON org_integrations(org_id);

-- ── user_preferences ─────────────────────────────────────────
CREATE TABLE user_preferences (
  user_id  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  key      TEXT NOT NULL DEFAULT 'settings',
  value    JSONB NOT NULL DEFAULT '{}',
  settings JSONB NOT NULL DEFAULT '{}'
);

-- ── invitations ──────────────────────────────────────────────
CREATE TABLE invitations (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member','viewer')),
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','expired')),
  token      TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, email)
);

-- ── model_prices ─────────────────────────────────────────────
CREATE TABLE model_prices (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  model          TEXT NOT NULL UNIQUE,
  provider       TEXT NOT NULL,
  input_per_1m   NUMERIC(12,6) NOT NULL,
  output_per_1m  NUMERIC(12,6) NOT NULL,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── model_prices seed ────────────────────────────────────────
INSERT INTO model_prices (model, provider, input_per_1m, output_per_1m) VALUES
  ('gpt-4o',            'openai',     5.000,  15.000),
  ('gpt-4o-mini',       'openai',     0.150,   0.600),
  ('gpt-4-turbo',       'openai',    10.000,  30.000),
  ('gpt-3.5-turbo',     'openai',     0.500,   1.500),
  ('claude-opus-4-8',   'anthropic', 15.000,  75.000),
  ('claude-sonnet-4-6', 'anthropic',  3.000,  15.000),
  ('claude-haiku-4-5',  'anthropic',  0.250,   1.250),
  ('gemini-1.5-pro',    'google',     3.500,  10.500),
  ('gemini-1.5-flash',  'google',     0.075,   0.300),
  ('gemini-2.0-flash',  'google',     0.100,   0.400),
  ('llama-3.1-70b',     'meta',       0.590,   0.790)
ON CONFLICT (model) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- RLS POLICIES
-- ─────────────────────────────────────────────────────────────

ALTER TABLE organizations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects       ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams          ENABLE ROW LEVEL SECURITY;
ALTER TABLE members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys       ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_agg      ENABLE ROW LEVEL SECURITY;
ALTER TABLE limits         ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules    ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations    ENABLE ROW LEVEL SECURITY;

-- organizations
CREATE POLICY "organizations_insert" ON organizations
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "organizations_select" ON organizations
  FOR SELECT USING (
    auth.uid() = owner_id OR
    EXISTS (SELECT 1 FROM members WHERE members.org_id = organizations.id AND members.user_id = auth.uid())
  );

CREATE POLICY "organizations_update" ON organizations
  FOR UPDATE USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- members — simple policy, no self-reference
CREATE POLICY "members_select" ON members
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "members_insert" ON members
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "members_update" ON members
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "members_delete" ON members
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM members AS m
      WHERE m.org_id = members.org_id AND m.user_id = auth.uid() AND m.role IN ('owner','admin')
    )
  );

-- projects
CREATE POLICY "projects_select" ON projects
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = projects.org_id AND members.user_id = auth.uid())
  );

CREATE POLICY "projects_insert" ON projects
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = projects.org_id AND members.user_id = auth.uid())
  );

CREATE POLICY "projects_update" ON projects
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = projects.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
  );

CREATE POLICY "projects_delete" ON projects
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = projects.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
  );

-- teams
CREATE POLICY "teams_select" ON teams
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = teams.org_id AND members.user_id = auth.uid())
  );

CREATE POLICY "teams_insert" ON teams
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = teams.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
  );

-- api_keys
CREATE POLICY "api_keys_select" ON api_keys
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = api_keys.org_id AND members.user_id = auth.uid())
  );

CREATE POLICY "api_keys_insert" ON api_keys
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = api_keys.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
  );

CREATE POLICY "api_keys_update" ON api_keys
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = api_keys.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
  );

CREATE POLICY "api_keys_delete" ON api_keys
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = api_keys.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
  );

-- usage_events (service role writes, members read)
CREATE POLICY "usage_events_select" ON usage_events
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = usage_events.org_id AND members.user_id = auth.uid())
  );

-- usage_agg
CREATE POLICY "usage_agg_select" ON usage_agg
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = usage_agg.org_id AND members.user_id = auth.uid())
  );

-- limits
CREATE POLICY "limits_select" ON limits
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = limits.org_id AND members.user_id = auth.uid())
  );

CREATE POLICY "limits_insert" ON limits
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = limits.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
  );

CREATE POLICY "limits_update" ON limits
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = limits.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
  );

CREATE POLICY "limits_delete" ON limits
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = limits.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
  );

-- alert_rules
CREATE POLICY "alert_rules_select" ON alert_rules
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = alert_rules.org_id AND members.user_id = auth.uid())
  );

CREATE POLICY "alert_rules_insert" ON alert_rules
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = alert_rules.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
  );

CREATE POLICY "alert_rules_update" ON alert_rules
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = alert_rules.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
  );

CREATE POLICY "alert_rules_delete" ON alert_rules
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = alert_rules.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
  );

-- notifications
CREATE POLICY "notifications_select" ON notifications
  FOR SELECT USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "notifications_update" ON notifications
  FOR UPDATE USING (user_id = auth.uid());

-- org_integrations
CREATE POLICY "org_integrations_select" ON org_integrations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = org_integrations.org_id AND members.user_id = auth.uid())
  );

CREATE POLICY "org_integrations_insert" ON org_integrations
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = org_integrations.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
  );

CREATE POLICY "org_integrations_delete" ON org_integrations
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = org_integrations.org_id AND members.user_id = auth.uid() AND members.role IN ('owner','admin'))
  );

-- user_preferences
CREATE POLICY "user_preferences_select" ON user_preferences
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "user_preferences_insert" ON user_preferences
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_preferences_update" ON user_preferences
  FOR UPDATE USING (user_id = auth.uid());

-- invitations
CREATE POLICY "invitations_select" ON invitations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM members WHERE members.org_id = invitations.org_id AND members.user_id = auth.uid())
  );

CREATE POLICY "invitations_insert" ON invitations
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM organizations
      WHERE organizations.id = invitations.org_id AND organizations.owner_id = auth.uid()
    )
  );
