-- =============================================================================
-- schema.sql — the complete TokenFin database in ONE migration file.
-- Run once in a fresh Supabase project (SQL editor). Ordered 001 -> 022;
-- every section is idempotent (IF NOT EXISTS / CREATE OR REPLACE), safe to re-run.
-- =============================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>  001_initial_schema.sql  >>>>>>>>>>>>>>>>>>>>>>>>
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
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- ── teams ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id   UUID REFERENCES projects(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE members ENABLE ROW LEVEL SECURITY;

-- ── api_keys ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by   UUID REFERENCES auth.users(id),
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,   -- SHA-256 of raw key
  key_prefix   TEXT NOT NULL,          -- first 20 chars for lookup
  is_active    BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE usage_agg ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE limits ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE budget_requests ENABLE ROW LEVEL SECURITY;

-- ── alert_rules ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_rules (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id   UUID REFERENCES projects(id),
  name         TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('threshold','anomaly','limit_breach')),
  threshold    NUMERIC(12,2),
  channels     JSONB NOT NULL DEFAULT '{"email":true}',  -- email,slack,telegram,webhook
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

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


-- >>>>>>>>>>>>>>>>>>>>>>>>  002_functions.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- TokenFin SQL Functions
-- Run AFTER schema.sql

-- ── Aggregate upsert (called fire-and-forget from ingest) ────
CREATE OR REPLACE FUNCTION upsert_usage_agg(
  p_org_id     UUID,
  p_project_id UUID,
  p_model      TEXT,
  p_bucket     DATE,
  p_tokens     BIGINT,
  p_cost       NUMERIC,
  p_requests   INT DEFAULT 1
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO usage_agg (org_id, project_id, model, bucket, total_tokens, cost_usd, request_count)
  VALUES (p_org_id, p_project_id, p_model, p_bucket, p_tokens, p_cost, p_requests)
  ON CONFLICT (org_id, project_id, model, bucket) DO UPDATE SET
    total_tokens  = usage_agg.total_tokens  + EXCLUDED.total_tokens,
    cost_usd      = usage_agg.cost_usd      + EXCLUDED.cost_usd,
    request_count = usage_agg.request_count + EXCLUDED.request_count;
END;
$$;

-- ── Cost summary for a project ───────────────────────────────
CREATE OR REPLACE FUNCTION project_cost_summary(
  p_project_id UUID,
  p_since      TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days'
)
RETURNS TABLE (
  model         TEXT,
  total_tokens  BIGINT,
  cost_usd      NUMERIC,
  request_count BIGINT
) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT model,
         SUM(total_tokens)::BIGINT,
         SUM(cost_usd),
         COUNT(*)
  FROM usage_events
  WHERE project_id = p_project_id AND created_at >= p_since
  GROUP BY model
  ORDER BY cost_usd DESC;
$$;

-- ── Check if project is over limit ───────────────────────────
CREATE OR REPLACE FUNCTION check_project_limit(p_project_id UUID)
RETURNS TABLE (
  scope      TEXT,
  budget_usd NUMERIC,
  spent_usd  NUMERIC,
  pct_used   INT,
  status     TEXT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_limit limits%ROWTYPE;
  v_spent NUMERIC;
  v_pct   INT;
BEGIN
  FOR v_limit IN
    SELECT * FROM limits WHERE project_id = p_project_id AND is_active = true
  LOOP
    SELECT COALESCE(SUM(cost_usd), 0) INTO v_spent
    FROM usage_events
    WHERE project_id = p_project_id
      AND created_at >= (
        CASE v_limit.period
          WHEN 'daily'   THEN date_trunc('day', NOW())
          WHEN 'weekly'  THEN date_trunc('week', NOW())
          WHEN 'monthly' THEN date_trunc('month', NOW())
        END
      );

    v_pct := LEAST(ROUND((v_spent / v_limit.budget_usd) * 100)::INT, 100);

    RETURN QUERY SELECT
      v_limit.scope,
      v_limit.budget_usd,
      v_spent,
      v_pct,
      CASE
        WHEN v_pct >= v_limit.block_at    THEN 'blocked'
        WHEN v_pct >= v_limit.throttle_at THEN 'throttled'
        WHEN v_pct >= v_limit.warn_at     THEN 'warning'
        ELSE 'ok'
      END;
  END LOOP;
END;
$$;


-- >>>>>>>>>>>>>>>>>>>>>>>>  003_invitations.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- Migration 003: Add invitations table
-- Run after 001_initial_schema.sql

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
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;


-- >>>>>>>>>>>>>>>>>>>>>>>>  004_rls_policies.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- TokenFin RLS Policies Migration
-- Applied: 2026-06-15

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


-- per-file 005-022 and the partial APPLY_PENDING.sql bundle.
-- =============================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>  005_api_keys_user_id.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- Migration 005: add user_id (assigned member) to api_keys
-- Run this in the Supabase SQL Editor before deploying the updated Keys page.

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN api_keys.user_id IS 'Team member this key is assigned to (for cost attribution)';

-- Enforce: each member can have at most 1 active key per project
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_member_project_unique
  ON api_keys (org_id, project_id, user_id)
  WHERE user_id IS NOT NULL AND is_active = TRUE;


-- >>>>>>>>>>>>>>>>>>>>>>>>  006_api_keys_team_id.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- Migration 006: add team_id (assigned team) to api_keys
-- Run this in the Supabase SQL Editor after migration 005.

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

COMMENT ON COLUMN api_keys.team_id IS 'Team this key is assigned to (for team-level cost attribution)';

-- Enforce: each team can have at most 1 active key per project
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_team_project_unique
  ON api_keys (org_id, project_id, team_id)
  WHERE team_id IS NOT NULL AND is_active = TRUE;


-- >>>>>>>>>>>>>>>>>>>>>>>>  007_prompt_analytics_indexes.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- Migration 007: Prompt analytics indexes on usage_events.metadata JSONB
-- Run in Supabase SQL Editor after migrations 001–006.

CREATE INDEX IF NOT EXISTS idx_usage_events_prompt_hash
  ON usage_events ((metadata->>'prompt_hash'))
  WHERE metadata->>'prompt_hash' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usage_events_latency
  ON usage_events (org_id, ((metadata->>'latency_ms')::int))
  WHERE metadata->>'latency_ms' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usage_events_org_created
  ON usage_events (org_id, created_at DESC);


-- >>>>>>>>>>>>>>>>>>>>>>>>  008_rbac_and_orgs_view.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- Migration 008 — RBAC role rename + orgs view + members.joined_at
-- =============================================================================
-- Run once in Supabase SQL Editor (or via psql).
-- All statements are idempotent — safe to re-run.
--
-- Changes:
--   1. members.role  — rename 'developer' → 'member', fix CHECK + default
--   2. invitations.role — add 'owner' guard (keep 'member' as default)
--   3. members.joined_at — add column used by auth.ts ordering
--   4. orgs view  — alias for `organizations` (ingest route uses .from('orgs'))
--   5. ratelimit plan  — add 'team' to organizations.plan CHECK
-- =============================================================================

BEGIN;

-- ── 1. members.role ───────────────────────────────────────────────────────────
-- a) Migrate any existing 'developer' rows to 'member'
UPDATE members
   SET role = 'member'
 WHERE role = 'developer';

-- b) Drop old CHECK, add new one that includes 'member' and excludes 'developer'
ALTER TABLE members
  DROP CONSTRAINT IF EXISTS members_role_check;

ALTER TABLE members
  ADD CONSTRAINT members_role_check
  CHECK (role IN ('owner', 'admin', 'member', 'viewer'));

-- c) Fix the column default
ALTER TABLE members
  ALTER COLUMN role SET DEFAULT 'member';

-- ── 2. invitations.role ───────────────────────────────────────────────────────
-- Invitations can target admin/member/viewer — owners are not invited, they
-- create the org. Ensure the check is clean (no 'developer').
ALTER TABLE invitations
  DROP CONSTRAINT IF EXISTS invitations_role_check;

ALTER TABLE invitations
  ADD CONSTRAINT invitations_role_check
  CHECK (role IN ('admin', 'member', 'viewer'));

-- ── 3. members.joined_at ─────────────────────────────────────────────────────
-- Used in auth.ts: .order('joined_at', { ascending: true })
-- Backfill from created_at for existing rows.
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE members
   SET joined_at = created_at
 WHERE joined_at = NOW()                -- only rows that got the DEFAULT just now
   AND created_at < NOW() - INTERVAL '1 second';

-- ── 4. orgs view ─────────────────────────────────────────────────────────────
-- The ingest route and several API routes use `.from('orgs')`.
-- `organizations` is the real table — this view makes both names work.
CREATE OR REPLACE VIEW orgs AS
  SELECT * FROM organizations;

-- Grant the same permissions as the base table.
-- (Supabase anon + service_role inherit through RLS on organizations.)
GRANT SELECT, INSERT, UPDATE, DELETE ON orgs TO anon, authenticated, service_role;

-- ── 5. organizations.plan — add 'team' tier ───────────────────────────────────
-- ratelimit.ts supports free / pro / team / enterprise.
-- Original CHECK missed 'team'; add it.
ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_plan_check;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_plan_check
  CHECK (plan IN ('free', 'pro', 'team', 'enterprise'));

-- ── 6. usage_events — ensure metadata column exists (should already) ──────────
ALTER TABLE usage_events
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

COMMIT;

-- =============================================================================
-- Verify (run separately to inspect results)
-- =============================================================================
-- SELECT DISTINCT role FROM members;
-- SELECT table_name FROM information_schema.views WHERE table_name = 'orgs';
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'members' AND column_name = 'joined_at';


-- >>>>>>>>>>>>>>>>>>>>>>>>  009_fix_upsert_usage_agg.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- Migration 009 — Fix upsert_usage_agg RPC
-- =============================================================================
-- Fixes two bugs in the original function:
--   1. p_bucket was TIMESTAMPTZ but usage_agg.bucket is DATE → type mismatch
--      caused every RPC call to fail and fall back to a JS upsert that
--      OVERWROTE request_count with 1 instead of incrementing it.
--   2. ON CONFLICT clause was missing org_id, so it never matched the actual
--      unique constraint (org_id, project_id, model, bucket).
--
-- Safe to re-run — uses CREATE OR REPLACE.
-- =============================================================================

CREATE OR REPLACE FUNCTION upsert_usage_agg(
  p_org_id     UUID,
  p_project_id UUID,
  p_model      TEXT,
  p_bucket     DATE,          -- was TIMESTAMPTZ — now correctly DATE
  p_tokens     BIGINT,
  p_cost       NUMERIC,
  p_requests   INT DEFAULT 1
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO usage_agg (org_id, project_id, model, bucket, total_tokens, cost_usd, request_count)
  VALUES (p_org_id, p_project_id, p_model, p_bucket, p_tokens, p_cost, p_requests)
  ON CONFLICT (org_id, project_id, model, bucket) DO UPDATE SET  -- was missing org_id
    total_tokens  = usage_agg.total_tokens  + EXCLUDED.total_tokens,
    cost_usd      = usage_agg.cost_usd      + EXCLUDED.cost_usd,
    request_count = usage_agg.request_count + EXCLUDED.request_count;
END;
$$;


-- >>>>>>>>>>>>>>>>>>>>>>>>  010_recompute_usage_agg_from_events.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- Migration 010 — Recompute usage_agg from usage_events (IST dates)
-- =============================================================================
-- The original upsert_usage_agg RPC had wrong param types so it always failed,
-- causing a JS fallback that set request_count=1 and overwrote costs.
-- This migration rebuilds usage_agg from usage_events using IST (UTC+5:30) dates.
-- Run AFTER migration 009 (which fixes the RPC function).
-- =============================================================================

-- Rebuild usage_agg from usage_events using IST date buckets
INSERT INTO usage_agg (org_id, project_id, model, bucket, total_tokens, cost_usd, request_count)
SELECT
  org_id,
  project_id,
  model,
  (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS bucket,
  SUM(total_tokens)  AS total_tokens,
  SUM(cost_usd)      AS cost_usd,
  COUNT(*)           AS request_count
FROM usage_events
WHERE total_tokens > 0
GROUP BY org_id, project_id, model,
         (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date
ON CONFLICT (org_id, project_id, model, bucket) DO UPDATE SET
  total_tokens  = EXCLUDED.total_tokens,
  cost_usd      = EXCLUDED.cost_usd,
  request_count = EXCLUDED.request_count;


-- >>>>>>>>>>>>>>>>>>>>>>>>  011_drop_stale_upsert_overload.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- Migration 011 — Drop stale upsert_usage_agg overload + fix batch conflict
-- =============================================================================
-- Problem found in production (2026-06-27):
--   The DB had TWO upsert_usage_agg functions — the old (p_bucket TIMESTAMPTZ)
--   and the new (p_bucket DATE). Migration 009 used CREATE OR REPLACE, which
--   creates a NEW overload instead of replacing one with a different signature,
--   so both lingered. PostgREST then returned 300 PGRST203 ("could not choose
--   the best candidate function") on every rpc('upsert_usage_agg', ...) call,
--   forcing the ingest JS fallback to last-write-wins and corrupting usage_agg
--   (request_count stuck at 1; tokens/cost = last event only).
--
-- This migration removes EVERY overload of the function, then recreates the
-- single canonical (p_bucket DATE) version. Also fixes the batch upsert's
-- ON CONFLICT target, which was missing org_id and so did not match the
-- usage_agg unique index (org_id, project_id, model, bucket).
--
-- Safe to re-run. Run BEFORE migration 010's recompute (or re-run 010 after).
-- =============================================================================

-- 1. Drop all overloads of upsert_usage_agg regardless of signature.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig
    FROM pg_proc
    WHERE proname = 'upsert_usage_agg'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

-- 2. Recreate the single canonical version (p_bucket DATE, increments on conflict).
CREATE FUNCTION upsert_usage_agg(
  p_org_id     UUID,
  p_project_id UUID,
  p_model      TEXT,
  p_bucket     DATE,
  p_tokens     BIGINT,
  p_cost       NUMERIC,
  p_requests   INT DEFAULT 1
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO usage_agg (org_id, project_id, model, bucket, total_tokens, cost_usd, request_count)
  VALUES (p_org_id, p_project_id, p_model, p_bucket, p_tokens, p_cost, p_requests)
  ON CONFLICT (org_id, project_id, model, bucket) DO UPDATE SET
    total_tokens  = usage_agg.total_tokens  + EXCLUDED.total_tokens,
    cost_usd      = usage_agg.cost_usd      + EXCLUDED.cost_usd,
    request_count = usage_agg.request_count + EXCLUDED.request_count;
END;
$$;

-- 3. Fix the batch upsert conflict target to match the unique index (adds org_id).
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
  ON CONFLICT (org_id, project_id, model, bucket) DO UPDATE SET
    total_tokens  = usage_agg.total_tokens  + EXCLUDED.total_tokens,
    cost_usd      = usage_agg.cost_usd      + EXCLUDED.cost_usd,
    request_count = usage_agg.request_count + EXCLUDED.request_count;
END;
$$;


-- >>>>>>>>>>>>>>>>>>>>>>>>  012_key_reveals_and_service_accounts.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- Migration 012 — One-time key reveals + service accounts
-- =============================================================================
-- Supports bulk provisioning: an admin can create API keys for many members at
-- once, and each member retrieves their key exactly once via a secure,
-- single-use, expiring link — instead of logging in and creating a token
-- themselves, or having keys shared insecurely.
--
-- The raw key is stored ONLY as AES-256-GCM ciphertext here, is single-use,
-- auto-expires, and the ciphertext is nulled after the first reveal. The
-- api_keys table continues to store only key_hash (+ masked key_prefix).
-- =============================================================================

-- 1. Service-account flag for non-human agents (keys not tied to a person).
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS is_service_account BOOLEAN NOT NULL DEFAULT false;

-- 2. One-time reveal records.
CREATE TABLE IF NOT EXISTS key_reveals (
  token       TEXT PRIMARY KEY,                 -- random; used in the reveal URL
  key_id      UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       TEXT,                             -- intended recipient (for display)
  ciphertext  TEXT,                             -- AES-256-GCM(base64); nulled after reveal
  iv          TEXT,                             -- GCM nonce (base64)
  auth_tag    TEXT,                             -- GCM auth tag (base64)
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  revealed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_key_reveals_org ON key_reveals(org_id);
CREATE INDEX IF NOT EXISTS idx_key_reveals_key ON key_reveals(key_id);

-- 3. RLS: deny all to anon/authenticated. Only the service-role reveal endpoint
--    (which validates the token server-side) may read/write. Enabling RLS with
--    no policies = deny by default; service_role bypasses RLS.
ALTER TABLE key_reveals ENABLE ROW LEVEL SECURITY;


-- >>>>>>>>>>>>>>>>>>>>>>>>  013_savings.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- Migration 013 — Token-saving (Gateway) columns + savings-aware upserts
-- =============================================================================
-- TokenFin Saver: the gateway records, per request, not just actual usage but
-- the BASELINE it would have used without optimization. The delta is savings.
-- A random holdout bypasses optimization so we can report a MEASURED rate.
--
-- Adds savings columns to usage_events + usage_agg, and rebuilds the
-- upsert_usage_agg / upsert_usage_agg_batch functions to accumulate them.
-- Functions are DROPped first (new signature) to avoid PostgREST overload
-- ambiguity (the bug fixed in migration 011). New params have DEFAULT 0 so the
-- existing ingest route's RPC call keeps working unchanged.
-- =============================================================================

-- 1. Columns -----------------------------------------------------------------
ALTER TABLE usage_events
  ADD COLUMN IF NOT EXISTS input_tokens_saved  BIGINT        NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens_saved BIGINT        NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS baseline_cost_usd   NUMERIC(14,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS optimizations       JSONB         NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS was_holdout         BOOLEAN       NOT NULL DEFAULT false;

ALTER TABLE usage_agg
  ADD COLUMN IF NOT EXISTS tokens_saved  BIGINT        NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_saved    NUMERIC(14,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS holdout_count INT           NOT NULL DEFAULT 0;

-- 1b. Ensure the 4-column unique index the upserts conflict on actually exists.
-- The original schema (001) only declared UNIQUE(bucket, project_id, model) — 3
-- columns — but every upsert_usage_agg* uses ON CONFLICT (org_id, project_id,
-- model, bucket). Postgres requires an exact-match unique index, so without this
-- the functions would error. Safe: project_id already implies org_id, so no
-- duplicate rows can exist and the index always builds.
CREATE UNIQUE INDEX IF NOT EXISTS usage_agg_org_proj_model_bucket
  ON usage_agg (org_id, project_id, model, bucket);

-- 2. Drop all overloads of both functions ------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig FROM pg_proc
    WHERE proname IN ('upsert_usage_agg', 'upsert_usage_agg_batch')
      AND pronamespace = 'public'::regnamespace
  LOOP EXECUTE 'DROP FUNCTION ' || r.sig || ' CASCADE'; END LOOP;
END $$;

-- 3. Recreate single-row upsert (savings-aware; new params default 0) --------
CREATE FUNCTION upsert_usage_agg(
  p_org_id        UUID,
  p_project_id    UUID,
  p_model         TEXT,
  p_bucket        DATE,
  p_tokens        BIGINT,
  p_cost          NUMERIC,
  p_requests      INT DEFAULT 1,
  p_tokens_saved  BIGINT DEFAULT 0,
  p_cost_saved    NUMERIC DEFAULT 0,
  p_holdout       INT DEFAULT 0
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO usage_agg (org_id, project_id, model, bucket, total_tokens, cost_usd,
                         request_count, tokens_saved, cost_saved, holdout_count)
  VALUES (p_org_id, p_project_id, p_model, p_bucket, p_tokens, p_cost,
          p_requests, p_tokens_saved, p_cost_saved, p_holdout)
  ON CONFLICT (org_id, project_id, model, bucket) DO UPDATE SET
    total_tokens  = usage_agg.total_tokens  + EXCLUDED.total_tokens,
    cost_usd      = usage_agg.cost_usd      + EXCLUDED.cost_usd,
    request_count = usage_agg.request_count + EXCLUDED.request_count,
    tokens_saved  = usage_agg.tokens_saved  + EXCLUDED.tokens_saved,
    cost_saved    = usage_agg.cost_saved    + EXCLUDED.cost_saved,
    holdout_count = usage_agg.holdout_count + EXCLUDED.holdout_count;
END;
$$;

-- 4. Recreate batch upsert (savings-aware; 4-col conflict target) ------------
CREATE FUNCTION upsert_usage_agg_batch(rows JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO usage_agg (org_id, project_id, model, bucket, total_tokens, cost_usd,
                         request_count, tokens_saved, cost_saved, holdout_count)
  SELECT
    (r->>'p_org_id')::UUID,
    (r->>'p_project_id')::UUID,
    (r->>'p_model')::TEXT,
    (r->>'p_bucket')::DATE,
    (r->>'p_tokens')::BIGINT,
    (r->>'p_cost')::NUMERIC,
    COALESCE((r->>'p_requests')::INT, 1),
    COALESCE((r->>'p_tokens_saved')::BIGINT, 0),
    COALESCE((r->>'p_cost_saved')::NUMERIC, 0),
    COALESCE((r->>'p_holdout')::INT, 0)
  FROM jsonb_array_elements(rows) AS r
  ON CONFLICT (org_id, project_id, model, bucket) DO UPDATE SET
    total_tokens  = usage_agg.total_tokens  + EXCLUDED.total_tokens,
    cost_usd      = usage_agg.cost_usd      + EXCLUDED.cost_usd,
    request_count = usage_agg.request_count + EXCLUDED.request_count,
    tokens_saved  = usage_agg.tokens_saved  + EXCLUDED.tokens_saved,
    cost_saved    = usage_agg.cost_saved    + EXCLUDED.cost_saved,
    holdout_count = usage_agg.holdout_count + EXCLUDED.holdout_count;
END;
$$;


-- >>>>>>>>>>>>>>>>>>>>>>>>  014_prompt_captures.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- Migration 014 — Full prompt capture (opt-in) for richer prompt analytics
-- =============================================================================
-- Stores the full prompt (and optional response) per gateway request so the
-- Prompts analytics page can show real text, not just a hash.
--
-- ⚠️ SECURITY / PRIVACY: prompts can contain PII and secrets. This is OPT-IN
-- (gateway env CAPTURE_PROMPTS=1) and:
--   - lives in its OWN table (not usage_events) so it can be dropped/rotated
--     independently,
--   - is RLS-protected (org members read; only service role writes),
--   - carries expires_at for retention (default 30 days) — purge with a cron:
--       DELETE FROM prompt_captures WHERE expires_at < NOW();
-- =============================================================================

CREATE TABLE IF NOT EXISTS prompt_captures (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id    UUID REFERENCES projects(id) ON DELETE SET NULL,
  user_id       UUID,                       -- auth.users (no FK; may be a service account)
  model         TEXT NOT NULL,
  prompt_hash   TEXT,                        -- groups identical prompts
  prompt_text   TEXT NOT NULL,               -- the full rendered prompt
  response_text TEXT,                        -- optional assistant response
  input_tokens  BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(14,8) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days'
);

CREATE INDEX IF NOT EXISTS idx_prompt_captures_org_created ON prompt_captures(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_captures_hash       ON prompt_captures(org_id, prompt_hash);
CREATE INDEX IF NOT EXISTS idx_prompt_captures_expires    ON prompt_captures(expires_at);

ALTER TABLE prompt_captures ENABLE ROW LEVEL SECURITY;

-- Org members may read their org's captures.
DROP POLICY IF EXISTS prompt_captures_select ON prompt_captures;
CREATE POLICY prompt_captures_select ON prompt_captures
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM members WHERE user_id = auth.uid())
  );

-- No INSERT/UPDATE/DELETE policies → only the service role (gateway / cleanup)
-- can write. RLS denies all other roles by default.


-- >>>>>>>>>>>>>>>>>>>>>>>>  015_ccr_store.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- Migration 015 — CCR reversible store (for the unified MCP token-saving tools)
-- =============================================================================
-- When an agent calls the MCP `compress` tool, the original content is cached
-- here so `retrieve` can return it verbatim (reversibility). TTL-bounded; purge
-- expired rows with: DELETE FROM ccr_store WHERE expires_at < NOW();
--
-- RLS-protected: only the service role (the MCP server) reads/writes it.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ccr_store (
  hash       TEXT PRIMARY KEY,
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX IF NOT EXISTS idx_ccr_store_org     ON ccr_store(org_id);
CREATE INDEX IF NOT EXISTS idx_ccr_store_expires ON ccr_store(expires_at);

ALTER TABLE ccr_store ENABLE ROW LEVEL SECURITY;
-- No policies → service role only.


-- >>>>>>>>>>>>>>>>>>>>>>>>  016_usage_events_api_key_id.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- Migration 016 — Attribute usage to the API key that generated it
-- =============================================================================
-- The deployed usage_events table is missing api_key_id (schema drift from the
-- repo's 001). Without it, usage can only be grouped by project, so EVERY key
-- on a project shows that project's whole usage — a brand-new, never-used key
-- appears to have spend/tokens/model-breakdown it never generated.
--
-- This adds a nullable api_key_id so each usage_event points at its key. The
-- ingest + MCP write paths now populate it; historical rows stay NULL (they
-- count toward no specific key). Deleting a key keeps its usage (SET NULL).
--
-- REQUIRED: the app now inserts api_key_id, so apply this before/with the
-- corresponding deploy or usage_events inserts will error.
-- =============================================================================

ALTER TABLE usage_events
  ADD COLUMN IF NOT EXISTS api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_usage_events_api_key
  ON usage_events(api_key_id);


-- >>>>>>>>>>>>>>>>>>>>>>>>  017_traces_spans.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- Migration 017 — Traces & spans (observability backbone, OTEL GenAI model)
-- =============================================================================
-- TokenFin becomes an OTLP backend: incoming OpenTelemetry GenAI spans are
-- stored here (trace tree: invoke_agent → chat → execute_tool). Each LLM span
-- also lands in usage_events for cost analytics; spans keep the full structure.
-- RLS: org members read their org; only the service role writes.
-- =============================================================================

CREATE TABLE IF NOT EXISTS traces (
  trace_id    TEXT PRIMARY KEY,
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id  UUID REFERENCES projects(id) ON DELETE SET NULL,
  name        TEXT,
  start_time  TIMESTAMPTZ,
  end_time    TIMESTAMPTZ,
  span_count  INT NOT NULL DEFAULT 0,
  total_tokens BIGINT NOT NULL DEFAULT 0,
  cost_usd    NUMERIC(14,8) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_traces_org_created ON traces(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS spans (
  span_id        TEXT PRIMARY KEY,
  trace_id       TEXT NOT NULL,
  parent_span_id TEXT,
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name           TEXT,
  kind           TEXT,                      -- chat | execute_tool | invoke_agent | …
  model          TEXT,
  input_tokens   BIGINT NOT NULL DEFAULT 0,
  output_tokens  BIGINT NOT NULL DEFAULT 0,
  total_tokens   BIGINT NOT NULL DEFAULT 0,
  cost_usd       NUMERIC(14,8) NOT NULL DEFAULT 0,
  start_time     TIMESTAMPTZ,
  end_time       TIMESTAMPTZ,
  attributes     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_org   ON spans(org_id, created_at DESC);

ALTER TABLE traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE spans  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS traces_select ON traces;
CREATE POLICY traces_select ON traces FOR SELECT USING (
  org_id IN (SELECT org_id FROM members WHERE user_id = auth.uid())
);
DROP POLICY IF EXISTS spans_select ON spans;
CREATE POLICY spans_select ON spans FOR SELECT USING (
  org_id IN (SELECT org_id FROM members WHERE user_id = auth.uid())
);
-- No write policies → service-role (the OTLP ingest route) only.


-- >>>>>>>>>>>>>>>>>>>>>>>>  018_evals.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- Migration 018 — Evaluation layer (datasets, experiments, scores)
-- =============================================================================
-- Offline: datasets/examples (curated inputs + reference outputs) → eval_runs.
-- Online: sample prompt_captures/spans → reference-free judges → eval_scores.
-- Metrics land in eval_scores (faithfulness/hallucination, correctness, etc.).
-- RLS: org members read their org; service role writes.
-- =============================================================================

-- Reference-free faithfulness needs the retrieved context; capture it optionally.
ALTER TABLE prompt_captures
  ADD COLUMN IF NOT EXISTS context TEXT;

CREATE TABLE IF NOT EXISTS datasets (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS examples (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dataset_id       UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  input            JSONB NOT NULL DEFAULT '{}'::jsonb,
  reference_output TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_examples_dataset ON examples(dataset_id);

CREATE TABLE IF NOT EXISTS eval_runs (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT,
  kind       TEXT NOT NULL DEFAULT 'online',      -- 'online' | 'offline'
  evaluator  TEXT NOT NULL,                       -- 'faithfulness' | 'correctness' | …
  judge_model TEXT,
  dataset_id UUID REFERENCES datasets(id) ON DELETE SET NULL,
  summary    JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {count, mean_score, hallucination_rate, …}
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_eval_runs_org ON eval_runs(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS eval_scores (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  eval_run_id  UUID REFERENCES eval_runs(id) ON DELETE CASCADE,
  target_type  TEXT NOT NULL,                     -- 'prompt_capture' | 'example' | 'span'
  target_id    TEXT,
  evaluator    TEXT NOT NULL,                     -- 'faithfulness' | 'correctness' | …
  score        NUMERIC(6,4),                      -- 0..1
  passed       BOOLEAN,
  rationale    TEXT,
  model        TEXT,                              -- the model that produced the output
  judge_model  TEXT,                              -- the judge
  cost_usd     NUMERIC(14,8) NOT NULL DEFAULT 0,  -- cost of the scored call (for $/correct)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_eval_scores_org     ON eval_scores(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_scores_run     ON eval_scores(eval_run_id);
CREATE INDEX IF NOT EXISTS idx_eval_scores_eval    ON eval_scores(org_id, evaluator, created_at DESC);

ALTER TABLE datasets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE examples     ENABLE ROW LEVEL SECURITY;
ALTER TABLE eval_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE eval_scores  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['datasets','examples','eval_runs','eval_scores'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_select ON %I FOR SELECT USING (org_id IN (SELECT org_id FROM members WHERE user_id = auth.uid()))',
      t, t);
  END LOOP;
END $$;
-- No write policies → service role only.


-- >>>>>>>>>>>>>>>>>>>>>>>>  019_prompts.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- Migration 019 — Prompt registry + versions (for A/B and pairwise eval)
-- =============================================================================
CREATE TABLE IF NOT EXISTS prompts (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prompt_id  UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version    INT NOT NULL DEFAULT 1,
  template   TEXT NOT NULL,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt ON prompt_versions(prompt_id, version DESC);

ALTER TABLE prompts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_versions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['prompts','prompt_versions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING (org_id IN (SELECT org_id FROM members WHERE user_id = auth.uid()))', t, t);
  END LOOP;
END $$;


-- >>>>>>>>>>>>>>>>>>>>>>>>  020_org_eval_settings.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- Migration 020 — Per-org eval provider key (BYO) + judge model
-- =============================================================================
-- Eval / pairwise / online-hallucination calls cost provider credits, so each
-- org brings its OWN key — TokenFin never pays for an org's evals. The key is
-- stored AES-256-GCM-encrypted (same KEY_ENCRYPTION_SECRET as key reveals) and
-- never returned to the client. Falls back to the server env key only if unset.
-- RLS: service role only (it holds a secret).
-- =============================================================================

CREATE TABLE IF NOT EXISTS org_eval_settings (
  org_id      UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  key_cipher  TEXT,          -- AES-256-GCM ciphertext (base64)
  key_iv      TEXT,
  key_tag     TEXT,
  judge_model TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE org_eval_settings ENABLE ROW LEVEL SECURITY;
-- No policies → service role only (the API route reads/writes; never exposed).


-- >>>>>>>>>>>>>>>>>>>>>>>>  021_model_routes.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- Migration 021 — Eval-informed model routing (Phase 4)
-- =============================================================================
-- A route rewrites requests for `from_model` to a cheaper `to_model` at the
-- gateway, when eval quality shows the cheaper model is good enough. Same
-- provider only (the gateway is pass-through with the client's provider key).
-- The gateway loads active routes periodically and applies them in-line,
-- recording the saved cost (baseline = from_model, actual = to_model).
-- RLS: org members read; service role writes.
-- =============================================================================

CREATE TABLE IF NOT EXISTS model_routes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_model  TEXT NOT NULL,
  to_model    TEXT NOT NULL,
  min_quality NUMERIC(4,3),          -- the quality that justified this route (for display)
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- one active route per (org, from_model)
CREATE UNIQUE INDEX IF NOT EXISTS ux_model_routes_active
  ON model_routes(org_id, from_model) WHERE is_active;

ALTER TABLE model_routes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS model_routes_select ON model_routes;
CREATE POLICY model_routes_select ON model_routes FOR SELECT USING (
  org_id IN (SELECT org_id FROM members WHERE user_id = auth.uid())
);


-- >>>>>>>>>>>>>>>>>>>>>>>>  022_api_key_encrypted.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- Migration 022 — Copy-anytime API keys (encrypted raw key at rest)
-- =============================================================================
-- Product choice: users want to copy the REAL, ready-to-use key from the Keys
-- list at any time (not just once at creation). So we store the raw key
-- AES-256-GCM-encrypted (same KEY_ENCRYPTION_SECRET as reveals). key_hash and
-- the masked key_prefix stay as-is; the reveal-full endpoint decrypts on demand
-- for org admins only.
--
-- Tradeoff vs shown-once: keys become retrievable (like a password manager).
-- Mitigated by: encryption at rest, admin-only reveal, RLS (columns never
-- selected by normal reads). Keys created before this migration have NULL
-- cipher → not copyable; regenerate to enable.
-- =============================================================================

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS key_enc_cipher TEXT,
  ADD COLUMN IF NOT EXISTS key_enc_iv     TEXT,
  ADD COLUMN IF NOT EXISTS key_enc_tag    TEXT;


-- =============================================================================
-- Migration 023 — OTLP push ingest (Connections rebuild, Milestone 1)
-- =============================================================================
-- TokenFin now receives usage as native OpenTelemetry from CLI agents (Claude
-- Code / Codex / Gemini) at /api/otel/v1/{metrics,logs,traces}. This is an
-- ADDITIVE migration: the existing UUID `id` PK, every analytics query, and the
-- Go worker keep working unchanged. The receiver populates the new columns.
--
-- Idempotency (non-negotiable — the same spend can arrive via push AND a future
-- pull poll): `event_id` is a UNIQUE dedupe key. The receiver inserts with
-- ON CONFLICT (event_id) DO NOTHING, so a replay never double-counts.
--
-- `cost_basis` keeps us honest: 'metered' = real per-token money, 'notional' =
-- subscription usage priced at API rates (e.g. Claude Code on Pro/Max — NOT a
-- bill; never sum into a metered total), 'vendor_reported' = the vendor's own $.
--
-- input_tokens/output_tokens are re-asserted defensively: the deployed DB and
-- the ingest/otel routes already use them, but a fresh 001 apply created only
-- prompt_/completion_tokens. IF NOT EXISTS makes this safe either way.
-- =============================================================================

ALTER TABLE usage_events
  ADD COLUMN IF NOT EXISTS input_tokens        BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens       BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS event_id            TEXT,
  ADD COLUMN IF NOT EXISTS source              TEXT,      -- claude_code | codex_cli | gemini_cli | ...
  ADD COLUMN IF NOT EXISTS mode                TEXT,      -- 'push' | 'pull'
  ADD COLUMN IF NOT EXISTS provider_request_id TEXT,
  ADD COLUMN IF NOT EXISTS correlation_id      TEXT,      -- prompt.id (CC) / conversation.id (Codex) / session
  ADD COLUMN IF NOT EXISTS cache_read_tokens   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_write_tokens  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reasoning_tokens    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_basis          TEXT,      -- metered | notional | vendor_reported
  ADD COLUMN IF NOT EXISTS user_email          TEXT,
  ADD COLUMN IF NOT EXISTS session_id          TEXT;

-- Dedupe identity. Plain unique index: Postgres allows many NULLs (legacy rows
-- keep event_id NULL) while enforcing uniqueness on real ids — and unlike a
-- partial index it can serve as an ON CONFLICT (event_id) arbiter for upserts.
CREATE UNIQUE INDEX IF NOT EXISTS usage_events_event_id_uq
  ON usage_events(event_id);

-- Connections status endpoint reads latest event per (org, source).
CREATE INDEX IF NOT EXISTS usage_events_org_source_created
  ON usage_events(org_id, source, created_at DESC);


-- =============================================================================
-- Migration 024 — OTLP metric state (Codex/Gemini cumulative-counter diffing)
-- =============================================================================
-- Codex and Gemini report per-turn tokens only as metric COUNTERS, usually
-- cumulative (monotonically growing totals). To turn those into per-turn rows
-- without double-counting, the /api/otel/v1/metrics receiver diffs each metric
-- series against its last-seen value, stored here. First observation of a series
-- records a baseline and emits nothing; later observations emit only the delta.
-- (Claude Code is unaffected — its per-turn rows come from logs, not metrics.)
-- =============================================================================

CREATE TABLE IF NOT EXISTS otlp_metric_state (
  org_id     UUID        NOT NULL,
  series_key TEXT        NOT NULL,
  value      NUMERIC     NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, series_key)
);

