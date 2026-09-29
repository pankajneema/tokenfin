-- TokenFin migration 005 — security hardening
--
-- Idempotent and safe to re-run on production (which already has every object
-- touched here) and on a fresh database that may lack some of them: every
-- statement is guarded by IF EXISTS / to_regclass / DO blocks.
--
--   a. members RLS: no client-side writes (app writes members via service role),
--      non-recursive members_select via private.user_org_ids(); notifications
--      broadcast rows scoped to the caller's orgs; organizations_insert requires
--      owner_id = auth.uid().
--   b. orgs view: security_invoker + no anon/authenticated access.
--   c. SECURITY DEFINER functions in public: pinned search_path, EXECUTE only
--      for service_role; default privileges no longer grant EXECUTE to clients;
--      unused leaking functions dropped.
--   d. RLS on otlp_metric_state, model_prices (authenticated read), org_models.
--   e. Tenant-scoped keys for traces / spans / ccr_store; usage_events
--      UNIQUE (org_id, event_id) alongside the existing global event_id index.
--   f. prompt_captures.expires_at default → 90 days.

-- ── a. members / notifications / organizations RLS ──────────────────────────
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA private FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA private TO authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA private TO service_role';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.members') IS NULL THEN
    RAISE NOTICE '005: public.members missing — skipping members/notifications/organizations RLS';
    RETURN;
  END IF;

  -- Org ids the calling user belongs to. SECURITY DEFINER so policies on
  -- members (and tables that reference members) do not recurse through RLS.
  EXECUTE $f$
    CREATE OR REPLACE FUNCTION private.user_org_ids()
    RETURNS SETOF uuid
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
      SELECT m.org_id FROM public.members m WHERE m.user_id = auth.uid()
    $body$
  $f$;
  EXECUTE 'REVOKE ALL ON FUNCTION private.user_org_ids() FROM PUBLIC';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION private.user_org_ids() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION private.user_org_ids() TO authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION private.user_org_ids() TO service_role';
  END IF;

  EXECUTE 'ALTER TABLE public.members ENABLE ROW LEVEL SECURITY';
  -- The app writes members exclusively with the service role (bypasses RLS).
  -- No client-side INSERT/UPDATE/DELETE policy → default deny.
  EXECUTE 'DROP POLICY IF EXISTS "members_insert" ON public.members';
  EXECUTE 'DROP POLICY IF EXISTS "members_update" ON public.members';
  EXECUTE 'DROP POLICY IF EXISTS "members_delete" ON public.members';
  EXECUTE 'DROP POLICY IF EXISTS "members_select" ON public.members';
  EXECUTE 'CREATE POLICY "members_select" ON public.members FOR SELECT
             USING (org_id IN (SELECT private.user_org_ids()))';

  IF to_regclass('public.notifications') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "notifications_select" ON public.notifications';
    EXECUTE 'CREATE POLICY "notifications_select" ON public.notifications FOR SELECT
               USING (user_id = auth.uid()
                      OR (user_id IS NULL AND org_id IN (SELECT private.user_org_ids())))';
  END IF;

  IF to_regclass('public.organizations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "organizations_insert" ON public.organizations';
    EXECUTE 'CREATE POLICY "organizations_insert" ON public.organizations FOR INSERT
               WITH CHECK (owner_id = auth.uid())';
    EXECUTE 'DROP POLICY IF EXISTS "organizations_select" ON public.organizations';
    EXECUTE 'CREATE POLICY "organizations_select" ON public.organizations FOR SELECT
               USING (owner_id = auth.uid() OR id IN (SELECT private.user_org_ids()))';
  END IF;
END $$;

-- ── b. orgs view must not bypass RLS ────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = 'orgs' AND c.relkind = 'v') THEN
    IF current_setting('server_version_num')::int >= 150000 THEN
      EXECUTE 'ALTER VIEW public.orgs SET (security_invoker = true)';
    END IF;
    EXECUTE 'REVOKE ALL ON public.orgs FROM PUBLIC';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.orgs FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL ON public.orgs FROM authenticated';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.orgs TO service_role';
    END IF;
  END IF;
END $$;

-- ── c. SECURITY DEFINER functions ───────────────────────────────────────────
-- project_cost_summary / check_project_limit: unused by web/, backend/, sdk/,
-- and executable by anon over any project id → drop every overload.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('project_cost_summary', 'check_project_limit')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', r.sig);
  END LOOP;
END $$;

DO $$
DECLARE
  r record;
  has_anon bool := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_auth bool := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
  has_svc  bool := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role');
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, pg_has_role(current_user, p.proowner, 'USAGE') AS owned
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef AND p.prokind = 'f'
  LOOP
    IF NOT r.owned THEN
      RAISE WARNING '005: % is SECURITY DEFINER but not owned by %; fix manually', r.sig, current_user;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    IF has_anon THEN EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig); END IF;
    IF has_auth THEN EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig); END IF;
    IF has_svc  THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig); END IF;
  END LOOP;
END $$;

-- New functions created by this role are no longer client-executable by
-- default. (Revoking from PUBLIC is only valid as a global default privilege;
-- the anon/authenticated revoke targets Supabase's schema-level grant.)
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated';
  END IF;
END $$;

-- ── d. RLS on remaining public tables ───────────────────────────────────────
DO $$
BEGIN
  -- Server-side cumulative→delta state for the OTLP metrics receiver; service role only.
  IF to_regclass('public.otlp_metric_state') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.otlp_metric_state ENABLE ROW LEVEL SECURITY';
  END IF;

  -- Public price list: readable by signed-in users, writable only by service role.
  IF to_regclass('public.model_prices') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.model_prices ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "model_prices_read" ON public.model_prices';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'CREATE POLICY "model_prices_read" ON public.model_prices FOR SELECT TO authenticated USING (true)';
    ELSE
      EXECUTE 'CREATE POLICY "model_prices_read" ON public.model_prices FOR SELECT USING (true)';
    END IF;
  END IF;

  IF to_regclass('public.org_models') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.org_models ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- ── e. Tenant-scoped keys ───────────────────────────────────────────────────
-- A trace/span id or CCR hash supplied by one tenant must never collide with
-- (and overwrite) another tenant's row. Replace the PK only when it is not
-- already the desired column list.
DO $$
DECLARE
  spec record;
  cur_cols text;
  cur_name text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('traces',    'traces_pkey',    'org_id,trace_id'),
      ('spans',     'spans_pkey',     'org_id,trace_id,span_id'),
      ('ccr_store', 'ccr_store_pkey', 'org_id,hash')
    ) AS t(tbl, pk_name, cols)
  LOOP
    IF to_regclass('public.' || spec.tbl) IS NULL THEN
      CONTINUE;
    END IF;

    SELECT c.conname,
           string_agg(a.attname, ',' ORDER BY k.ord)
      INTO cur_name, cur_cols
    FROM pg_constraint c
    CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.conrelid = ('public.' || spec.tbl)::regclass AND c.contype = 'p'
    GROUP BY c.conname;

    IF cur_cols IS DISTINCT FROM spec.cols THEN
      IF cur_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', spec.tbl, cur_name);
      END IF;
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I PRIMARY KEY (%s)',
                     spec.tbl, spec.pk_name, spec.cols);
    END IF;
    cur_name := NULL; cur_cols := NULL;
  END LOOP;

  -- Span lookups by trace within an org (rollup) — covered by the new spans PK
  -- prefix; keep the old idx_spans_trace for existing readers.

  -- usage_events: tenant-scoped uniqueness. The global event_id unique index
  -- stays (ingest paths upsert with onConflict 'event_id').
  IF to_regclass('public.usage_events') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'usage_events' AND column_name = 'event_id') THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS usage_events_org_event_id_uq ON public.usage_events (org_id, event_id)';
  END IF;
END $$;

-- ── f. prompt_captures retention default ────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'prompt_captures' AND column_name = 'expires_at') THEN
    EXECUTE $s$ALTER TABLE public.prompt_captures ALTER COLUMN expires_at SET DEFAULT (now() + interval '90 days')$s$;
  END IF;
END $$;
