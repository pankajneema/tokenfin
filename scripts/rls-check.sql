-- RLS / privilege regression check. Proves that the anon and authenticated
-- (non-member) roles cannot read or write TokenFin data, and that the
-- service-role-only tables and functions stay locked down.
--
-- Run against a Supabase Postgres (roles anon/authenticated/service_role and
-- auth.uid() must exist) AFTER all db/migrations are applied:
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f scripts/rls-check.sql
--
-- Non-destructive: everything runs in one transaction that is rolled back.
-- Exits non-zero (RAISE EXCEPTION) on the first failed assertion; prints
-- "RLS check passed" otherwise. Used by .github/workflows/ci.yml (db job).

BEGIN;

-- ── Seed one row in a few sensitive tables (as postgres) so "0 rows visible"
--    actually proves denial rather than an empty table. ─────────────────────
CREATE TEMP TABLE _rls_seed ON COMMIT DROP AS
SELECT gen_random_uuid() AS org_id, gen_random_uuid() AS project_id, gen_random_uuid() AS stranger;
GRANT SELECT ON _rls_seed TO anon, authenticated;

INSERT INTO public.organizations (id, name, slug)
  SELECT org_id, 'rlscheck org', 'rlscheck-' || left(org_id::text, 8) FROM _rls_seed;
INSERT INTO public.projects (id, org_id, name, slug)
  SELECT project_id, org_id, 'rlscheck project', 'rlscheck-p' FROM _rls_seed;
INSERT INTO public.api_keys (org_id, project_id, name, key_hash, key_prefix)
  SELECT org_id, project_id, 'rlscheck key', md5(random()::text), 'tfk_rls_…0000' FROM _rls_seed;
INSERT INTO public.job_runs (job, ok) VALUES ('rlscheck', true);
DO $$ BEGIN
  IF to_regclass('public.audit_log') IS NOT NULL THEN
    EXECUTE 'INSERT INTO public.audit_log (org_id, action) SELECT org_id, ''rlscheck'' FROM _rls_seed';
  END IF;
  IF to_regclass('public.provider_connections') IS NOT NULL THEN
    EXECUTE 'INSERT INTO public.provider_connections (org_id, provider, key_enc) SELECT org_id, ''anthropic'', ''{}''::jsonb FROM _rls_seed';
  END IF;
END $$;

-- ── 1. Every public base table has RLS enabled. ──────────────────────────────
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
    AND NOT c.relispartition;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'RLS disabled on: %', bad; END IF;
END $$;

-- ── 2. No public view readable by anon/authenticated bypasses RLS. ───────────
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
    AND NOT COALESCE('security_invoker=true' = ANY (c.reloptions), false)
    AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT'));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'views readable by clients without security_invoker: %', bad; END IF;
END $$;

-- ── 3. Service-role-only functions are not executable by clients. ────────────
DO $$
DECLARE
  fn TEXT; r TEXT;
  fns TEXT[] := ARRAY['job_run_start', 'job_run_finish', 'tf_schema_probe', 'purge_expired_data', 'purge_org_data'];
BEGIN
  FOR fn IN SELECT unnest(fns) LOOP
    FOR r IN SELECT unnest(ARRAY['anon', 'authenticated']) LOOP
      IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = fn AND has_function_privilege(r, p.oid, 'EXECUTE')
      ) THEN RAISE EXCEPTION '% can EXECUTE public.%', r, fn; END IF;
    END LOOP;
  END LOOP;
END $$;

-- ── 4. As anon and as an authenticated NON-member, every public table and
--       view returns 0 rows (or is denied outright). ─────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.rls_visible_rows(p_role TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE t RECORD; n BIGINT; leaks TEXT := '';
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm') ORDER BY c.relname
  LOOP
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', p_role);
      EXECUTE format('SELECT count(*) FROM public.%I', t.relname) INTO n;
      RESET ROLE;
      IF n > 0 THEN leaks := leaks || format('%s(%s) ', t.relname, n); END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE;   -- denied outright: good
    END;
  END LOOP;
  RETURN leaks;
END $$;

DO $$
DECLARE leaks TEXT; stranger UUID;
BEGIN
  leaks := pg_temp.rls_visible_rows('anon');
  IF leaks <> '' THEN RAISE EXCEPTION 'anon can read rows in: %', leaks; END IF;

  SELECT s.stranger INTO stranger FROM _rls_seed s;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', stranger::text, true);
  leaks := pg_temp.rls_visible_rows('authenticated');
  IF leaks <> '' THEN RAISE EXCEPTION 'authenticated non-member can read rows in: %', leaks; END IF;
END $$;

-- ── 5. Clients cannot write service-role-only tables. ────────────────────────
DO $$
DECLARE r TEXT; tbl TEXT; wrote BOOLEAN;
BEGIN
  FOR r IN SELECT unnest(ARRAY['anon', 'authenticated']) LOOP
    FOR tbl IN SELECT unnest(ARRAY['job_runs', 'api_keys', 'organizations']) LOOP
      wrote := false;
      BEGIN
        EXECUTE format('SET LOCAL ROLE %I', r);
        IF tbl = 'job_runs' THEN
          EXECUTE 'INSERT INTO public.job_runs (job) VALUES (''rlscheck-client'')';
        ELSIF tbl = 'api_keys' THEN
          EXECUTE 'UPDATE public.api_keys SET is_active = false WHERE name = ''rlscheck key''';
          GET DIAGNOSTICS wrote = ROW_COUNT;  -- 0 rows = RLS filtered: fine
          RESET ROLE;
          IF wrote THEN RAISE EXCEPTION '% updated api_keys', r; END IF;
          CONTINUE;
        ELSE
          EXECUTE 'DELETE FROM public.organizations WHERE name = ''rlscheck org''';
          GET DIAGNOSTICS wrote = ROW_COUNT;
          RESET ROLE;
          IF wrote THEN RAISE EXCEPTION '% deleted organizations', r; END IF;
          CONTINUE;
        END IF;
        RESET ROLE;
        RAISE EXCEPTION '% inserted into %', r, tbl;
      EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE;   -- denied: good
      END;
    END LOOP;
  END LOOP;
END $$;

-- ── 6. service_role still works (the app path). ──────────────────────────────
DO $$
DECLARE id BIGINT; n BIGINT;
BEGIN
  SET LOCAL ROLE service_role;
  id := public.job_run_start('rlscheck-service');
  PERFORM public.job_run_finish(id, true, '{"n":1}'::jsonb, NULL);
  SELECT count(*) INTO n FROM public.job_runs WHERE job LIKE 'rlscheck%';
  RESET ROLE;
  IF n < 2 THEN RAISE EXCEPTION 'service_role could not use job_runs (saw % rows)', n; END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'RLS check passed'; END $$;
ROLLBACK;
