-- =============================================================================
-- Migration 012: keys & access hardening
--   1. api_keys.device_id / api_keys.kind  (per-device CLI keys; split ingest/read keys)
--   2. member-per-project unique index now also keyed by (kind, device_id)
--   3. REVOKE TRUNCATE / TRIGGER / REFERENCES from anon + authenticated
--   4. RLS policies: bare auth.uid() → (select auth.uid()) (initplan, evaluated once)
-- Idempotent: safe to run any number of times.
-- =============================================================================

-- ── 1. api_keys.device_id + kind ────────────────────────────────────────────
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS device_id text;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS kind      text NOT NULL DEFAULT 'legacy';

COMMENT ON COLUMN public.api_keys.device_id IS
  'CLI device identifier (per-device keys: a repeat login on the same device rotates only that device''s key)';
COMMENT ON COLUMN public.api_keys.kind IS
  'ingest = write telemetry only (OTLP/SDK); read = analytics/MCP only; legacy = pre-split read+write key';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_kind_check') THEN
    ALTER TABLE public.api_keys
      ADD CONSTRAINT api_keys_kind_check CHECK (kind IN ('ingest', 'read', 'legacy'));
  END IF;
END $$;

-- Backfill kind from scopes for rows still on the default (only single-purpose keys change).
UPDATE public.api_keys SET kind = 'ingest'
 WHERE kind = 'legacy' AND scopes = ARRAY['ingest']::text[];
UPDATE public.api_keys SET kind = 'read'
 WHERE kind = 'legacy' AND scopes = ARRAY['read']::text[];

-- ── 2. Unique index: one active key per (member, project, kind, device) ──────
-- Previously (org_id, project_id, user_id): a member could hold ONE active key
-- per project, which made per-device CLI keys and split ingest/read keys
-- impossible. Legacy manual keys (kind='legacy', device_id NULL) keep the old
-- one-per-member-per-project rule.
DROP INDEX IF EXISTS public.api_keys_member_project_unique;
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_member_project_kind_device_unique
  ON public.api_keys (org_id, project_id, user_id, kind, (coalesce(device_id, '')))
  WHERE user_id IS NOT NULL AND is_active = true;

-- Member removal / demotion looks up a user's keys in an org.
CREATE INDEX IF NOT EXISTS idx_api_keys_org_user_active
  ON public.api_keys (org_id, user_id) WHERE is_active = true;

-- ── 3. Table privileges: no TRUNCATE / TRIGGER / REFERENCES for API roles ────
-- RLS does not apply to TRUNCATE; these privileges are never needed by PostgREST.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;

-- ── 4. RLS: wrap bare auth.uid() as (select auth.uid()) ──────────────────────
-- Evaluated once per statement instead of once per row. Rewrites only
-- occurrences not already inside "SELECT auth.uid()"; any policy that fails to
-- re-apply is left untouched (logged as a NOTICE) — never dropped.
DO $$
DECLARE
  p        record;
  new_qual text;
  new_chk  text;
  stmt     text;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND (coalesce(qual, '') LIKE '%auth.uid()%' OR coalesce(with_check, '') LIKE '%auth.uid()%')
  LOOP
    -- Protect already-wrapped calls, wrap the rest, then restore.
    new_qual := replace(replace(replace(p.qual,       'SELECT auth.uid()', '@@WRAPPED@@'), 'auth.uid()', '( SELECT auth.uid() AS uid)'), '@@WRAPPED@@', 'SELECT auth.uid()');
    new_chk  := replace(replace(replace(p.with_check, 'SELECT auth.uid()', '@@WRAPPED@@'), 'auth.uid()', '( SELECT auth.uid() AS uid)'), '@@WRAPPED@@', 'SELECT auth.uid()');
    IF new_qual IS NOT DISTINCT FROM p.qual AND new_chk IS NOT DISTINCT FROM p.with_check THEN
      CONTINUE;
    END IF;
    stmt := format('ALTER POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    IF new_qual IS NOT NULL THEN stmt := stmt || ' USING (' || new_qual || ')'; END IF;
    IF new_chk  IS NOT NULL THEN stmt := stmt || ' WITH CHECK (' || new_chk || ')'; END IF;
    BEGIN
      EXECUTE stmt;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'skipped policy %.%: %', p.tablename, p.policyname, SQLERRM;
    END;
  END LOOP;
END $$;

-- ── 5. Per-caller usage aggregation (CLI status / statusline) ────────────────
-- SQL aggregation instead of row reads (no PostgREST 1000-row cap). Service role
-- only. All filters optional (NULL = no filter).
CREATE OR REPLACE FUNCTION public.tf_spend_window(
  p_org      uuid,
  p_since    timestamptz,
  p_user     uuid    DEFAULT NULL,
  p_project  uuid    DEFAULT NULL,
  p_users    uuid[]  DEFAULT NULL,
  p_key_ids  uuid[]  DEFAULT NULL
) RETURNS TABLE (cost_usd numeric, notional_cost_usd numeric, total_tokens bigint, events bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT coalesce(sum(e.cost_usd), 0),
         coalesce(sum(e.cost_usd) FILTER (WHERE e.cost_basis = 'notional'), 0),
         coalesce(sum(e.total_tokens), 0)::bigint,
         count(*)
    FROM usage_events e
   WHERE e.org_id = p_org
     AND e.created_at >= p_since
     AND (p_user    IS NULL OR e.user_id    = p_user)
     AND (p_project IS NULL OR e.project_id = p_project)
     AND (p_users   IS NULL OR e.user_id    = ANY (p_users))
     AND (p_key_ids IS NULL OR e.api_key_id = ANY (p_key_ids))
$$;

-- Per-source connection status: latest event (last 90 days) + tokens since p_since.
CREATE OR REPLACE FUNCTION public.tf_connection_sources(
  p_org      uuid,
  p_since    timestamptz,
  p_user     uuid    DEFAULT NULL,
  p_key_ids  uuid[]  DEFAULT NULL,
  p_source   text    DEFAULT NULL
) RETURNS TABLE (source text, last_event_at timestamptz, tokens_today bigint, cost_basis text, model text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH ev AS (
    SELECT e.source, e.created_at, e.total_tokens, e.cost_basis, e.model
      FROM usage_events e
     WHERE e.org_id = p_org
       AND e.source IS NOT NULL
       AND e.created_at >= now() - interval '90 days'
       AND (p_source  IS NULL OR e.source     = p_source)
       AND (p_user    IS NULL OR e.user_id    = p_user)
       AND (p_key_ids IS NULL OR e.api_key_id = ANY (p_key_ids))
  ), last AS (
    SELECT DISTINCT ON (ev.source) ev.source, ev.created_at, ev.cost_basis, ev.model
      FROM ev ORDER BY ev.source, ev.created_at DESC
  )
  SELECT l.source, l.created_at,
         coalesce((SELECT sum(x.total_tokens) FROM ev x WHERE x.source = l.source AND x.created_at >= p_since), 0)::bigint,
         l.cost_basis, l.model
    FROM last l
   ORDER BY l.created_at DESC
$$;

REVOKE EXECUTE ON FUNCTION public.tf_spend_window(uuid, timestamptz, uuid, uuid, uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tf_connection_sources(uuid, timestamptz, uuid, uuid[], text)     FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tf_spend_window(uuid, timestamptz, uuid, uuid, uuid[], uuid[]) TO service_role;
GRANT  EXECUTE ON FUNCTION public.tf_connection_sources(uuid, timestamptz, uuid, uuid[], text)     TO service_role;
