-- ─────────────────────────────────────────────────────────
-- TokenFin: Full DB reset
-- Paste into Supabase SQL editor and run.
-- This wipes ALL data including auth users.
-- ─────────────────────────────────────────────────────────

-- 1. Truncate all application tables in dependency order
TRUNCATE TABLE
  user_preferences,
  notifications,
  alert_rules,
  limits,
  usage_agg,
  usage_events,
  org_integrations,
  api_keys,
  members,
  teams,
  projects,
  organizations
CASCADE;

-- 2. Delete all auth users (Supabase auth schema)
DELETE FROM auth.users;
