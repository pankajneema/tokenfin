-- ════════════════════════════════════════════════════════════════════════════
--  OPT-IN: monthly range partitioning of usage_events (for > ~50M rows)
-- ════════════════════════════════════════════════════════════════════════════
--
--  NOT a migration. Never run automatically, never copied to supabase/migrations.
--  Below ~50M rows the existing (org_id, created_at DESC) indexes are fine;
--  every dashboard reads the rollups (usage_daily / usage_sessions) anyway.
--  Partitioning pays off when retention purges and "last N days" scans on raw
--  events get slow: old months become a DROP/DETACH instead of a big DELETE,
--  and time-bounded scans touch only recent partitions.
--
--  ── Why an app change is required first (step 0) ───────────────────────────
--  On a partitioned table every UNIQUE index must include the partition key
--  (created_at). usage_events has UNIQUE (org_id, event_id) and a partial
--  UNIQUE (org_id, request_idempotency_key), and the app writes with
--  INSERT … ON CONFLICT (org_id, event_id) DO NOTHING (lib/otlp/persist.ts,
--  app/api/v1/ingest/_core.ts). That ON CONFLICT target cannot exist on the
--  partitioned table. This plan moves dedup into a small non-partitioned key
--  table (usage_event_keys) checked by a BEFORE INSERT trigger that silently
--  skips duplicates, so the app must switch to a plain insert:
--
--      .upsert(recs, { onConflict: 'org_id,event_id', ignoreDuplicates: true })
--    → .insert(recs)            -- duplicates are skipped by the trigger
--
--  Deploy that change behind a flag and flip it in the same window as the swap
--  (step 5). Both forms return only the rows actually inserted.
--
--  ── How to run ───────────────────────────────────────────────────────────────
--  1. Take a backup / PITR mark. Try it on a staging copy first.
--  2. Steps 1–4 run online (no lock on usage_events); step 4 can take hours.
--       psql "$DB_URL" -v confirm=yes -v step=prepare  -f scripts/partition-usage-events.sql
--       psql "$DB_URL" -v confirm=yes -v step=backfill -f scripts/partition-usage-events.sql   (re-runnable)
--  3. Maintenance window (seconds–minutes): deploy the app change, then
--       psql "$DB_URL" -v confirm=yes -v step=swap     -f scripts/partition-usage-events.sql
--  4. Keep usage_events_unpartitioned until you are satisfied, then DROP it.
--     Rollback before dropping: see the ROLLBACK section at the end.
--
--  Retention keeps working unchanged (purge_org_data DELETEs by org + cutoff);
--  optionally detach/drop whole months older than the longest org retention.
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\if :{?confirm}
\else
  \echo 'Refusing to run: pass -v confirm=yes -v step=prepare|backfill|swap (read the header first).'
  \quit
\endif
\if :{?step}
\else
  \echo 'Pass -v step=prepare|backfill|swap'
  \quit
\endif

SELECT :'step' = 'prepare'  AS is_prepare,
       :'step' = 'backfill' AS is_backfill,
       :'step' = 'swap'     AS is_swap \gset

-- ─────────────────────────────────────────────────────────────────────────────
--  STEP 1–3: prepare — new partitioned table, partitions, dedup keys
-- ─────────────────────────────────────────────────────────────────────────────
\if :is_prepare
BEGIN;

-- 1. Same columns/defaults/checks as usage_events; PK must include created_at.
CREATE TABLE IF NOT EXISTS public.usage_events_p
  (LIKE public.usage_events INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING GENERATED)
  PARTITION BY RANGE (created_at);
DO $$ BEGIN
  ALTER TABLE public.usage_events_p ADD PRIMARY KEY (id, created_at);
EXCEPTION WHEN invalid_table_definition THEN NULL; END $$;

-- Non-unique indexes mirror usage_events (created on the parent → every partition).
CREATE INDEX IF NOT EXISTS usage_events_p_org_created       ON public.usage_events_p (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_p_org_created_cost  ON public.usage_events_p (org_id, created_at DESC) INCLUDE (cost_usd, cost_basis);
CREATE INDEX IF NOT EXISTS usage_events_p_api_key           ON public.usage_events_p (api_key_id);
CREATE INDEX IF NOT EXISTS usage_events_p_project_created   ON public.usage_events_p (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_p_org_user_created  ON public.usage_events_p (org_id, user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS usage_events_p_org_actor_created ON public.usage_events_p (org_id, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_p_org_source        ON public.usage_events_p (org_id, source, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_p_org_tool          ON public.usage_events_p (org_id, tool_name, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_p_org_provider      ON public.usage_events_p (org_id, provider, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_p_org_repo          ON public.usage_events_p (org_id, repo, created_at DESC) WHERE repo IS NOT NULL;
CREATE INDEX IF NOT EXISTS usage_events_p_org_prompt_hash   ON public.usage_events_p (org_id, prompt_hash) WHERE prompt_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS usage_events_p_org_event_id      ON public.usage_events_p (org_id, event_id);   -- lookups (not unique)
CREATE INDEX IF NOT EXISTS usage_events_p_latency           ON public.usage_events_p (org_id, ((metadata ->> 'latency_ms')::int)) WHERE (metadata ->> 'latency_ms') IS NOT NULL;
-- Re-check this list against `\d usage_events` on YOUR database before running.

-- 2. Monthly partitions + a DEFAULT partition as a safety net.
CREATE OR REPLACE FUNCTION public.usage_events_ensure_partition(p_month DATE)
RETURNS TEXT LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  m0   DATE := date_trunc('month', p_month)::date;
  name TEXT := format('usage_events_%s', to_char(m0, 'YYYY_MM'));
BEGIN
  IF to_regclass('public.' || name) IS NULL THEN
    EXECUTE format('CREATE TABLE public.%I PARTITION OF public.usage_events_p FOR VALUES FROM (%L) TO (%L)',
                   name, m0::timestamptz, (m0 + INTERVAL '1 month')::timestamptz);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', name);
  END IF;
  RETURN name;
END $$;
REVOKE EXECUTE ON FUNCTION public.usage_events_ensure_partition(DATE) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.usage_events_ensure_partition(DATE) TO service_role;

SELECT public.usage_events_ensure_partition(m::date)
FROM generate_series(
  date_trunc('month', COALESCE((SELECT min(created_at) FROM public.usage_events), NOW())),
  date_trunc('month', NOW()) + INTERVAL '3 months',
  INTERVAL '1 month') AS m;
CREATE TABLE IF NOT EXISTS public.usage_events_default PARTITION OF public.usage_events_p DEFAULT;
ALTER TABLE public.usage_events_default ENABLE ROW LEVEL SECURITY;
-- Keep ≥ 3 future months: schedule monthly (pg_cron, see docs/OPERATIONS.md):
--   SELECT cron.schedule('usage-events-partitions', '0 0 1 * *',
--     $$SELECT public.usage_events_ensure_partition((date_trunc('month', now()) + interval '3 months')::date)$$);

-- 3. Dedup keys (replaces the UNIQUE (org_id, event_id) / idempotency indexes).
CREATE TABLE IF NOT EXISTS public.usage_event_keys (
  org_id     UUID NOT NULL,
  key        TEXT NOT NULL,       -- 'e:' || event_id  or  'i:' || request_idempotency_key
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (org_id, key)
);
ALTER TABLE public.usage_event_keys ENABLE ROW LEVEL SECURITY;          -- service role only
REVOKE ALL ON public.usage_event_keys FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.usage_event_keys TO service_role;
CREATE INDEX IF NOT EXISTS usage_event_keys_created ON public.usage_event_keys (created_at);

CREATE OR REPLACE FUNCTION public.usage_events_dedup_trg()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.event_id IS NOT NULL THEN
    INSERT INTO usage_event_keys (org_id, key, created_at) VALUES (NEW.org_id, 'e:' || NEW.event_id, NEW.created_at)
    ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN RETURN NULL; END IF;          -- duplicate event → skip row silently
  END IF;
  IF NEW.request_idempotency_key IS NOT NULL THEN
    INSERT INTO usage_event_keys (org_id, key, created_at) VALUES (NEW.org_id, 'i:' || NEW.request_idempotency_key, NEW.created_at)
    ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.usage_events_dedup_trg() FROM PUBLIC, anon, authenticated;
-- The trigger itself is attached at swap time (backfill writes keys in bulk).

CREATE TABLE IF NOT EXISTS public.usage_events_backfill_state (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  copied_until TIMESTAMPTZ NOT NULL DEFAULT '-infinity'
);
INSERT INTO public.usage_events_backfill_state DEFAULT VALUES ON CONFLICT DO NOTHING;
ALTER TABLE public.usage_events_backfill_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.usage_events_backfill_state FROM PUBLIC, anon, authenticated;
COMMIT;
\echo 'prepare done — now run step=backfill (repeat until it reports 0 rows)'
\endif

-- ─────────────────────────────────────────────────────────────────────────────
--  STEP 4: backfill — copy in 1-day slices, one transaction per slice
--  Re-runnable: progress is kept in usage_events_backfill_state. Rows younger
--  than 10 minutes are left for the swap step (they may still be arriving).
-- ─────────────────────────────────────────────────────────────────────────────
\if :is_backfill
CREATE OR REPLACE PROCEDURE pg_temp.usage_events_backfill(p_slice INTERVAL DEFAULT '1 day')
LANGUAGE plpgsql AS $$
DECLARE
  lo TIMESTAMPTZ; hi TIMESTAMPTZ; stop TIMESTAMPTZ := NOW() - INTERVAL '10 minutes'; n BIGINT; total BIGINT := 0;
BEGIN
  SELECT copied_until INTO lo FROM public.usage_events_backfill_state;
  IF lo = '-infinity' THEN
    SELECT COALESCE(min(created_at), stop) INTO lo FROM public.usage_events;
  END IF;
  WHILE lo < stop LOOP
    hi := LEAST(lo + p_slice, stop);
    INSERT INTO public.usage_events_p SELECT * FROM public.usage_events
      WHERE created_at >= lo AND created_at < hi
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
    INSERT INTO public.usage_event_keys (org_id, key, created_at)
      SELECT org_id, 'e:' || event_id, created_at FROM public.usage_events
      WHERE created_at >= lo AND created_at < hi AND event_id IS NOT NULL
      UNION ALL
      SELECT org_id, 'i:' || request_idempotency_key, created_at FROM public.usage_events
      WHERE created_at >= lo AND created_at < hi AND request_idempotency_key IS NOT NULL
    ON CONFLICT DO NOTHING;
    UPDATE public.usage_events_backfill_state SET copied_until = hi;
    COMMIT;                                   -- one short transaction per slice
    lo := hi;
  END LOOP;
  RAISE NOTICE 'backfill copied % rows, now at %', total, lo;
END $$;
CALL pg_temp.usage_events_backfill();
\endif

-- ─────────────────────────────────────────────────────────────────────────────
--  STEP 5: swap — short exclusive lock, copy the tail, rename, re-attach
-- ─────────────────────────────────────────────────────────────────────────────
\if :is_swap
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.usage_events IN EXCLUSIVE MODE;          -- blocks writes, allows reads

-- Tail since the last backfill slice.
INSERT INTO public.usage_events_p SELECT * FROM public.usage_events
  WHERE created_at >= (SELECT copied_until FROM public.usage_events_backfill_state)
ON CONFLICT DO NOTHING;
INSERT INTO public.usage_event_keys (org_id, key, created_at)
  SELECT org_id, 'e:' || event_id, created_at FROM public.usage_events
  WHERE created_at >= (SELECT copied_until FROM public.usage_events_backfill_state) AND event_id IS NOT NULL
  UNION ALL
  SELECT org_id, 'i:' || request_idempotency_key, created_at FROM public.usage_events
  WHERE created_at >= (SELECT copied_until FROM public.usage_events_backfill_state) AND request_idempotency_key IS NOT NULL
ON CONFLICT DO NOTHING;

DO $$
DECLARE a BIGINT; b BIGINT;
BEGIN
  SELECT count(*) INTO a FROM public.usage_events;
  SELECT count(*) INTO b FROM public.usage_events_p;
  IF a <> b THEN RAISE EXCEPTION 'row count mismatch: usage_events=% usage_events_p=% — aborting swap', a, b; END IF;
END $$;

ALTER TABLE public.usage_events   RENAME TO usage_events_unpartitioned;
ALTER TABLE public.usage_events_p RENAME TO usage_events;

-- Rollups (011): statement-level triggers with transition tables are allowed on
-- a partitioned parent. Copy them from the old table.
CREATE TRIGGER usage_events_rollup_ins AFTER INSERT ON public.usage_events
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.usage_rollup_trg();
CREATE TRIGGER usage_events_rollup_upd AFTER UPDATE ON public.usage_events
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.usage_rollup_trg();
CREATE TRIGGER usage_events_rollup_del AFTER DELETE ON public.usage_events
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.usage_rollup_trg();
DROP TRIGGER IF EXISTS usage_events_rollup_ins ON public.usage_events_unpartitioned;
DROP TRIGGER IF EXISTS usage_events_rollup_upd ON public.usage_events_unpartitioned;
DROP TRIGGER IF EXISTS usage_events_rollup_del ON public.usage_events_unpartitioned;
CREATE TRIGGER usage_events_dedup BEFORE INSERT ON public.usage_events
  FOR EACH ROW EXECUTE FUNCTION public.usage_events_dedup_trg();

-- Foreign keys (same as before).
ALTER TABLE public.usage_events ADD FOREIGN KEY (org_id)     REFERENCES public.organizations(id);
ALTER TABLE public.usage_events ADD FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.usage_events ADD FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE SET NULL;

-- RLS + grants: re-create every policy of the old table on the new parent.
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname, cmd, roles, qual, with_check, permissive FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'usage_events_unpartitioned' LOOP
    EXECUTE format('CREATE POLICY %I ON public.usage_events AS %s FOR %s TO %s%s%s',
      p.policyname, p.permissive, p.cmd, array_to_string(p.roles, ', '),
      CASE WHEN p.qual IS NOT NULL THEN ' USING (' || p.qual || ')' ELSE '' END,
      CASE WHEN p.with_check IS NOT NULL THEN ' WITH CHECK (' || p.with_check || ')' ELSE '' END);
  END LOOP;
END $$;
-- Mirror the old table's grants (by default: service_role only; clients read
-- through the API, never PostgREST directly).
REVOKE ALL ON public.usage_events FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.usage_events TO service_role;
DO $$
DECLARE g RECORD;
BEGIN
  FOR g IN SELECT grantee, privilege_type FROM information_schema.role_table_grants
           WHERE table_schema = 'public' AND table_name = 'usage_events_unpartitioned'
             AND grantee IN ('anon', 'authenticated') LOOP
    EXECUTE format('GRANT %s ON public.usage_events TO %I', g.privilege_type, g.grantee);
  END LOOP;
END $$;
COMMIT;
\echo 'swapped. Verify dashboards + ingest, then later: DROP TABLE public.usage_events_unpartitioned;'
\endif

-- ─────────────────────────────────────────────────────────────────────────────
--  ROLLBACK (manual, before dropping usage_events_unpartitioned):
--    BEGIN;
--    LOCK TABLE public.usage_events IN EXCLUSIVE MODE;
--    INSERT INTO public.usage_events_unpartitioned SELECT * FROM public.usage_events
--      WHERE created_at >= (SELECT copied_until FROM public.usage_events_backfill_state)
--      ON CONFLICT DO NOTHING;                       -- rows written after the swap
--    ALTER TABLE public.usage_events RENAME TO usage_events_p;
--    ALTER TABLE public.usage_events_unpartitioned RENAME TO usage_events;
--    -- re-create the three rollup triggers on usage_events (see 011), revert the app change
--    COMMIT;
-- ─────────────────────────────────────────────────────────────────────────────
