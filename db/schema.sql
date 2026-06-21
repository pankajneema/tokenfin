-- ============================================================
-- TokenFin — Database Schema
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/jolfgtrjvfueoaoopous/sql/new
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── organizations ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  plan         TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','team','enterprise')),
  kill_switch  BOOLEAN NOT NULL DEFAULT false,
  owner_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- ── projects ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, slug)
);
-- ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- ── teams ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id   UUID REFERENCES projects(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

-- ── members ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS members (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id      UUID REFERENCES teams(id) ON DELETE SET NULL,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'developer' CHECK (role IN ('owner','admin','developer','viewer')),
  invited_by   UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, user_id)
);
-- ALTER TABLE members ENABLE ROW LEVEL SECURITY;

-- ── api_keys ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by   UUID REFERENCES auth.users(id),
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,   -- SHA-256 of raw key
  key_prefix   TEXT NOT NULL,          -- first 20 chars for lookup
  env          TEXT NOT NULL DEFAULT 'production' CHECK (env IN ('production','staging','development')),
  scopes       TEXT[] NOT NULL DEFAULT '{read,write}',
  expires_at   TIMESTAMPTZ,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- ── model_prices ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS model_prices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  model           TEXT NOT NULL UNIQUE,
  provider        TEXT NOT NULL,
  input_per_1m    NUMERIC(12,6) NOT NULL,   -- USD per 1M input tokens
  output_per_1m   NUMERIC(12,6) NOT NULL,   -- USD per 1M output tokens
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── usage_events ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usage_events (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  api_key_id        UUID NOT NULL REFERENCES api_keys(id),
  project_id        UUID NOT NULL REFERENCES projects(id),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  model             TEXT NOT NULL,
  prompt_tokens     BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  total_tokens      BIGINT NOT NULL DEFAULT 0,
  cost_usd          NUMERIC(14,8) NOT NULL DEFAULT 0,
  latency_ms        INT,
  tags              JSONB NOT NULL DEFAULT '{}',
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS usage_events_org_created    ON usage_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_project_created ON usage_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_model           ON usage_events(model);
-- ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

-- ── usage_agg (per-minute buckets) ───────────────────────────
CREATE TABLE IF NOT EXISTS usage_agg (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bucket        TIMESTAMPTZ NOT NULL,          -- truncated to minute
  project_id    UUID NOT NULL REFERENCES projects(id),
  org_id        UUID NOT NULL REFERENCES organizations(id),
  model         TEXT NOT NULL,
  total_tokens  BIGINT NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(14,8) NOT NULL DEFAULT 0,
  request_count INT NOT NULL DEFAULT 0,
  UNIQUE(bucket, project_id, model)
);
CREATE INDEX IF NOT EXISTS usage_agg_org_bucket ON usage_agg(org_id, bucket DESC);
-- ALTER TABLE usage_agg ENABLE ROW LEVEL SECURITY;

-- ── limits ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS limits (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id   UUID REFERENCES projects(id) ON DELETE CASCADE,
  team_id      UUID REFERENCES teams(id) ON DELETE CASCADE,
  scope        TEXT NOT NULL CHECK (scope IN ('org','project','team','member')),
  period       TEXT NOT NULL CHECK (period IN ('daily','weekly','monthly')),
  budget_usd   NUMERIC(12,2) NOT NULL,
  warn_at      INT NOT NULL DEFAULT 70,       -- % to warn
  throttle_at  INT NOT NULL DEFAULT 90,       -- % to throttle
  block_at     INT NOT NULL DEFAULT 100,      -- % to soft block
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- ALTER TABLE limits ENABLE ROW LEVEL SECURITY;

-- ── blocks ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blocks (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id   UUID REFERENCES projects(id),
  team_id      UUID REFERENCES teams(id),
  reason       TEXT NOT NULL,
  blocked_by   UUID REFERENCES auth.users(id),
  unblocked_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;

-- ── invitations ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invitations (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member','viewer')),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','expired')),
  token        TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, email)
);
-- ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- ── budget_requests ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budget_requests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id   UUID REFERENCES projects(id),
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  reviewed_by  UUID REFERENCES auth.users(id),
  amount_usd   NUMERIC(12,2) NOT NULL,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- ALTER TABLE budget_requests ENABLE ROW LEVEL SECURITY;

-- ── alert_rules ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_rules (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      UUID REFERENCES projects(id),
  name            TEXT NOT NULL,
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN ('threshold','anomaly','limit_breach','member')),
  condition       TEXT NOT NULL DEFAULT '',     -- human-readable condition description
  scope           TEXT NOT NULL DEFAULT 'All projects',  -- what the rule applies to
  threshold       NUMERIC(12,2),
  cooldown_hours  INT NOT NULL DEFAULT 4,
  fired_count     INT NOT NULL DEFAULT 0,
  last_fired_at   TIMESTAMPTZ,
  channels        JSONB NOT NULL DEFAULT '{"email":true}',  -- email,slack,telegram,webhook
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;

-- ── notifications ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES auth.users(id),
  type         TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT,
  is_read      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_user_read ON notifications(user_id, is_read, created_at DESC);
-- ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ── org_models ───────────────────────────────────────────────
-- Orgs explicitly add models they want to track; no models pre-loaded.
CREATE TABLE IF NOT EXISTS org_models (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  model     TEXT NOT NULL,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, model)
);
CREATE INDEX IF NOT EXISTS org_models_org ON org_models(org_id);
-- ALTER TABLE org_models ENABLE ROW LEVEL SECURITY;

-- ── org_integrations ─────────────────────────────────────────
-- Stores which external services each org has connected.
CREATE TABLE IF NOT EXISTS org_integrations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration     TEXT NOT NULL,           -- 'slack','datadog','grafana', etc.
  config          JSONB NOT NULL DEFAULT '{}',  -- encrypted creds placeholder
  is_active       BOOLEAN NOT NULL DEFAULT true,
  connected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at  TIMESTAMPTZ,
  sync_ok         BOOLEAN NOT NULL DEFAULT true,
  detail          TEXT,                    -- e.g. channel name, workspace URL
  UNIQUE(org_id, integration)
);
CREATE INDEX IF NOT EXISTS org_integrations_org ON org_integrations(org_id);
-- ALTER TABLE org_integrations ENABLE ROW LEVEL SECURITY;

-- ── user_preferences ─────────────────────────────────────────
-- Per-user notification & UI settings stored as JSONB.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  settings  JSONB NOT NULL DEFAULT '{}'
);
-- ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- ── model_prices seed ────────────────────────────────────────
INSERT INTO model_prices (model, provider, input_per_1m, output_per_1m) VALUES
  ('gpt-4o',              'openai',    5.00,   15.00),
  ('gpt-4o-mini',         'openai',    0.15,    0.60),
  ('gpt-4-turbo',         'openai',   10.00,   30.00),
  ('gpt-3.5-turbo',       'openai',    0.50,    1.50),
  ('claude-opus-4-8',     'anthropic', 15.00,   75.00),
  ('claude-sonnet-4-6',   'anthropic',  3.00,   15.00),
  ('claude-haiku-4-5',    'anthropic',  0.25,    1.25),
  ('gemini-1.5-pro',      'google',     3.50,   10.50),
  ('gemini-1.5-flash',    'google',     0.075,   0.30),
  ('gemini-2.0-flash',    'google',     0.10,    0.40),
  ('llama-3.1-70b',       'meta',       0.59,    0.79)
ON CONFLICT (model) DO NOTHING;

-- ── updated_at trigger ───────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE OR REPLACE TRIGGER organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS Policies ─────────────────────────────────────────────
-- organizations: allow authenticated users to create and access their orgs
CREATE POLICY "organizations_insert" ON organizations
  FOR INSERT WITH CHECK (
    auth.uid() = owner_id OR
    auth.uid() IS NOT NULL  -- allow creation, owner_id is set in app
  );

CREATE POLICY "organizations_select" ON organizations
  FOR SELECT USING (
    auth.uid() = owner_id OR
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = organizations.id AND members.user_id = auth.uid()
    )
  );

CREATE POLICY "organizations_update" ON organizations
  FOR UPDATE USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- members: allow org members to view and add members
CREATE POLICY "members_insert" ON members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM organizations WHERE organizations.id = members.org_id AND organizations.owner_id = auth.uid()
    ) OR
    auth.uid() = invited_by
  );

CREATE POLICY "members_select" ON members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members AS m WHERE m.org_id = members.org_id AND m.user_id = auth.uid()
    )
  );

-- projects: allow org members to view and create projects
CREATE POLICY "projects_select" ON projects
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = projects.org_id AND members.user_id = auth.uid()
    )
  );

CREATE POLICY "projects_insert" ON projects
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = projects.org_id AND members.user_id = auth.uid()
    )
  );

-- api_keys: allow org members to view and create keys
CREATE POLICY "api_keys_select" ON api_keys
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = api_keys.org_id AND members.user_id = auth.uid()
    )
  );

CREATE POLICY "api_keys_insert" ON api_keys
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = api_keys.org_id AND members.user_id = auth.uid() AND members.role IN ('owner', 'admin')
    )
  );

-- usage_events: allow service role to write, members to read
CREATE POLICY "usage_events_select" ON usage_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = usage_events.org_id AND members.user_id = auth.uid()
    )
  );

-- limits: allow org admins to manage limits
CREATE POLICY "limits_select" ON limits
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = limits.org_id AND members.user_id = auth.uid()
    )
  );

CREATE POLICY "limits_insert" ON limits
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = limits.org_id AND members.user_id = auth.uid() AND members.role IN ('owner', 'admin')
    )
  );

-- invitations: allow org owners to send invites
CREATE POLICY "invitations_select" ON invitations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = invitations.org_id AND members.user_id = auth.uid()
    )
  );

CREATE POLICY "invitations_insert" ON invitations
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM organizations WHERE organizations.id = invitations.org_id AND organizations.owner_id = auth.uid()
    )
  );

-- notifications: allow users to view their own notifications
CREATE POLICY "notifications_select" ON notifications
  FOR SELECT USING (user_id = auth.uid() OR user_id IS NULL);

-- alert_rules: allow org members to view, admins to create
CREATE POLICY "alert_rules_select" ON alert_rules
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = alert_rules.org_id AND members.user_id = auth.uid()
    )
  );

-- blocks: allow org admins to view
CREATE POLICY "blocks_select" ON blocks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = blocks.org_id AND members.user_id = auth.uid() AND members.role IN ('owner', 'admin')
    )
  );

-- budget_requests: allow members to view their org's requests
CREATE POLICY "budget_requests_select" ON budget_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = budget_requests.org_id AND members.user_id = auth.uid()
    )
  );

CREATE POLICY "budget_requests_insert" ON budget_requests
  FOR INSERT WITH CHECK (
    auth.uid() = requested_by AND
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = budget_requests.org_id AND members.user_id = auth.uid()
    )
  );

-- usage_agg: allow members to view aggregated usage
CREATE POLICY "usage_agg_select" ON usage_agg
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = usage_agg.org_id AND members.user_id = auth.uid()
    )
  );
