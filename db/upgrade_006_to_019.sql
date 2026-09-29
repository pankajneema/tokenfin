-- =============================================================================
-- TokenFin — upgrade a live project from migration 006 to 019, in ONE file.
--
-- Generated from db/migrations/007…019 (unchanged, concatenated in order).
-- Run it once in the Supabase SQL editor (or: psql "$DB_URL" -v ON_ERROR_STOP=1 -f <this file>).
-- It runs in a single transaction: if any statement fails, nothing is applied.
-- Every migration is idempotent, so re-running it is safe.
--
-- Prerequisite: 001–006 already applied (check: SELECT retention_days FROM organizations LIMIT 1;).
-- =============================================================================

BEGIN;

-- >>>>>>>>>>>>>>>>>>>>>>>>  007_telemetry_enrichment.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- TokenFin additive migration 007
-- Telemetry enrichment from Claude Code / CLI-agent OTLP exports:
--   * productivity_daily   — lines/commits/PRs/edit decisions/active time per user·repo·day
--   * api_errors_daily     — api_error events counted per user·model·day (no usage rows)
--   * usage_events         — vendor-reported cost + repo + attribution dimensions
--   * org_model_prices     — per-org custom price overrides (longest model prefix wins)
-- Safe to re-run.

-- ── productivity_daily ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.productivity_daily (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_key        TEXT NOT NULL,                 -- user.email, else account uuid, else 'unknown'
  user_id         UUID NULL,
  repo            TEXT NOT NULL DEFAULT '',
  day             DATE NOT NULL,
  lines_added     BIGINT DEFAULT 0,
  lines_removed   BIGINT DEFAULT 0,
  commits         INT DEFAULT 0,
  pull_requests   INT DEFAULT 0,
  edits_accepted  INT DEFAULT 0,
  edits_rejected  INT DEFAULT 0,
  active_seconds  NUMERIC DEFAULT 0,
  sessions        INT DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT productivity_daily_uq UNIQUE (org_id, user_key, repo, day)
);
CREATE INDEX IF NOT EXISTS productivity_daily_org_day ON public.productivity_daily (org_id, day);
ALTER TABLE public.productivity_daily ENABLE ROW LEVEL SECURITY;   -- no policies: service role only

CREATE OR REPLACE FUNCTION public.upsert_productivity(
  p_org UUID, p_user_key TEXT, p_user_id UUID, p_repo TEXT, p_day DATE,
  p_lines_added BIGINT, p_lines_removed BIGINT, p_commits INT, p_prs INT,
  p_accepted INT, p_rejected INT, p_active NUMERIC, p_sessions INT
) RETURNS VOID LANGUAGE sql SET search_path = public, pg_temp AS $$
  INSERT INTO productivity_daily AS p
    (org_id, user_key, user_id, repo, day, lines_added, lines_removed, commits, pull_requests,
     edits_accepted, edits_rejected, active_seconds, sessions, updated_at)
  VALUES
    (p_org, COALESCE(NULLIF(p_user_key, ''), 'unknown'), p_user_id, COALESCE(p_repo, ''), p_day,
     COALESCE(p_lines_added, 0), COALESCE(p_lines_removed, 0), COALESCE(p_commits, 0), COALESCE(p_prs, 0),
     COALESCE(p_accepted, 0), COALESCE(p_rejected, 0), COALESCE(p_active, 0), COALESCE(p_sessions, 0), now())
  ON CONFLICT (org_id, user_key, repo, day) DO UPDATE SET
    user_id        = COALESCE(p.user_id, EXCLUDED.user_id),
    lines_added    = COALESCE(p.lines_added, 0)    + EXCLUDED.lines_added,
    lines_removed  = COALESCE(p.lines_removed, 0)  + EXCLUDED.lines_removed,
    commits        = COALESCE(p.commits, 0)        + EXCLUDED.commits,
    pull_requests  = COALESCE(p.pull_requests, 0)  + EXCLUDED.pull_requests,
    edits_accepted = COALESCE(p.edits_accepted, 0) + EXCLUDED.edits_accepted,
    edits_rejected = COALESCE(p.edits_rejected, 0) + EXCLUDED.edits_rejected,
    active_seconds = COALESCE(p.active_seconds, 0) + EXCLUDED.active_seconds,
    sessions       = COALESCE(p.sessions, 0)       + EXCLUDED.sessions,
    updated_at     = now()
$$;
REVOKE EXECUTE ON FUNCTION public.upsert_productivity(UUID, TEXT, UUID, TEXT, DATE, BIGINT, BIGINT, INT, INT, INT, INT, NUMERIC, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.upsert_productivity(UUID, TEXT, UUID, TEXT, DATE, BIGINT, BIGINT, INT, INT, INT, INT, NUMERIC, INT)
  TO service_role;

-- ── usage_events enrichment ──────────────────────────────────────────────────
ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS vendor_cost_usd NUMERIC(14,8) NULL;
ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS repo            TEXT NULL;
ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS query_source    TEXT NULL;
ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS agent_name      TEXT NULL;
ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS skill_name      TEXT NULL;
ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS mcp_server      TEXT NULL;
CREATE INDEX IF NOT EXISTS usage_events_org_repo_created
  ON public.usage_events (org_id, repo, created_at DESC) WHERE repo IS NOT NULL;

-- ── api_errors_daily ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_errors_daily (
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_key   TEXT NOT NULL,
  model      TEXT NOT NULL,
  day        DATE NOT NULL,
  errors     INT  NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT api_errors_daily_uq UNIQUE (org_id, user_key, model, day)
);
CREATE INDEX IF NOT EXISTS api_errors_daily_org_day ON public.api_errors_daily (org_id, day);
ALTER TABLE public.api_errors_daily ENABLE ROW LEVEL SECURITY;     -- service role only

CREATE OR REPLACE FUNCTION public.increment_api_errors(
  p_org UUID, p_user_key TEXT, p_model TEXT, p_day DATE, p_errors INT
) RETURNS VOID LANGUAGE sql SET search_path = public, pg_temp AS $$
  INSERT INTO api_errors_daily AS e (org_id, user_key, model, day, errors, updated_at)
  VALUES (p_org, COALESCE(NULLIF(p_user_key, ''), 'unknown'), COALESCE(NULLIF(p_model, ''), 'unknown'),
          p_day, COALESCE(p_errors, 1), now())
  ON CONFLICT (org_id, user_key, model, day) DO UPDATE SET
    errors = e.errors + EXCLUDED.errors, updated_at = now()
$$;
REVOKE EXECUTE ON FUNCTION public.increment_api_errors(UUID, TEXT, TEXT, DATE, INT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.increment_api_errors(UUID, TEXT, TEXT, DATE, INT) TO service_role;

-- ── org_model_prices ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_model_prices (
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  model_prefix      TEXT NOT NULL,
  input_per_m       NUMERIC NOT NULL,
  output_per_m      NUMERIC NOT NULL,
  cache_read_per_m  NUMERIC NULL,
  cache_write_per_m NUMERIC NULL,
  updated_at        TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (org_id, model_prefix)
);
ALTER TABLE public.org_model_prices ENABLE ROW LEVEL SECURITY;     -- service role only (API enforces models:manage)

-- NOTE: purge_org_data() (migration 006) does not yet clear productivity_daily /
-- api_errors_daily; both cascade on org delete.

NOTIFY pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>>>>>>  008_provider_billing.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- TokenFin additive migration 008
-- Provider bill reconciliation: org-connected read-only admin keys for the
-- Anthropic / OpenAI cost APIs, and the daily costs those providers report.
-- Compared on /dashboard/analytics/reconciliation against TokenFin's own
-- metered spend. Service role only. Safe to re-run; nothing is dropped.

CREATE TABLE IF NOT EXISTS provider_connections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL,
  key_enc        JSONB NOT NULL,                     -- sealKey(): {ciphertext, iv, authTag}
  key_hint       TEXT NOT NULL DEFAULT '',           -- masked, safe to display
  status         TEXT NOT NULL DEFAULT 'pending',    -- pending | ok | error
  last_synced_at TIMESTAMPTZ,
  last_error     TEXT,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, provider)
);
DO $$ BEGIN
  ALTER TABLE provider_connections ADD CONSTRAINT provider_connections_provider_chk
    CHECK (provider IN ('anthropic', 'openai'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE provider_connections ADD CONSTRAINT provider_connections_status_chk
    CHECK (status IN ('pending', 'ok', 'error'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS provider_costs (
  id                   BIGSERIAL PRIMARY KEY,
  org_id               UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider             TEXT NOT NULL,
  day                  DATE NOT NULL,                 -- UTC day as reported by the provider
  workspace_or_project TEXT NOT NULL DEFAULT '',
  line_item            TEXT NOT NULL DEFAULT '',
  model                TEXT NOT NULL DEFAULT '',
  cost_usd             NUMERIC(14,6) NOT NULL DEFAULT 0,
  input_tokens         BIGINT NOT NULL DEFAULT 0,
  output_tokens        BIGINT NOT NULL DEFAULT 0,
  cache_read_tokens    BIGINT NOT NULL DEFAULT 0,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, provider, day, workspace_or_project, line_item, model)
);
CREATE INDEX IF NOT EXISTS provider_costs_org_day ON provider_costs (org_id, day);

ALTER TABLE provider_connections ENABLE ROW LEVEL SECURITY;   -- service role only
ALTER TABLE provider_costs       ENABLE ROW LEVEL SECURITY;   -- service role only

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON provider_connections, provider_costs FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON provider_connections, provider_costs FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON provider_connections, provider_costs TO service_role';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE provider_costs_id_seq TO service_role';
  END IF;
END $$;

-- TokenFin's own METERED spend per UTC day and provider, for reconciliation.
-- Notional (subscription / CLI-agent) usage is never billed by the provider API
-- so it is excluded. Provider comes from usage_events.provider when it names
-- anthropic/openai; any other explicit provider (bedrock, vertex, azure, …) is
-- billed elsewhere and excluded; otherwise it is inferred from the model name.
CREATE OR REPLACE FUNCTION public.reconciliation_metered_daily(p_org UUID, p_since DATE)
RETURNS TABLE (day DATE, provider TEXT, cost_usd NUMERIC, events BIGINT)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH e AS (
    SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
           cost_usd,
           CASE
             WHEN lower(coalesce(provider, '')) IN ('anthropic', 'openai') THEN lower(provider)
             WHEN coalesce(provider, '') <> '' THEN NULL
             WHEN lower(regexp_replace(model, '^(anthropic|openai)/', '')) LIKE 'claude%' THEN 'anthropic'
             WHEN lower(regexp_replace(model, '^(anthropic|openai)/', '')) ~ '^(gpt|o1|o3|o4|chatgpt|text-embedding|codex)' THEN 'openai'
             ELSE NULL
           END AS provider
    FROM usage_events
    WHERE org_id = p_org
      AND created_at >= (p_since::timestamp AT TIME ZONE 'UTC')
      AND cost_basis IS DISTINCT FROM 'notional'
  )
  SELECT day, provider, SUM(cost_usd), COUNT(*)::bigint
  FROM e WHERE provider IS NOT NULL
  GROUP BY day, provider
$$;
REVOKE EXECUTE ON FUNCTION public.reconciliation_metered_daily(UUID, DATE) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.reconciliation_metered_daily(UUID, DATE) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.reconciliation_metered_daily(UUID, DATE) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.reconciliation_metered_daily(UUID, DATE) TO service_role';
  END IF;
END $$;

-- >>>>>>>>>>>>>>>>>>>>>>>>  009_alerts_digest.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- TokenFin additive migration 009
-- Alerts: robust anomaly scopes + forecast trigger; weekly digest idempotency.
-- Safe to re-run.

-- 1. Trigger types. 'member' was already used by the app/API but missing from
--    the original CHECK; 'forecast' = "projected to exceed budget".
ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_trigger_type_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_trigger_type_check
  CHECK (trigger_type IN ('threshold','anomaly','limit_breach','member','forecast'));

-- 2. Which breakdown an anomaly rule baselines. Existing rules keep org scope.
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS anomaly_scope TEXT NOT NULL DEFAULT 'org';
ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_anomaly_scope_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_anomaly_scope_check
  CHECK (anomaly_scope IN ('org','project','member','model'));

-- 3. One weekly digest per org per ISO week. The cron claims a row with
--    INSERT … ON CONFLICT DO NOTHING before delivering, so two overlapping
--    runs (Vercel + GitHub Actions, or a manual re-run) never double-send.
CREATE TABLE IF NOT EXISTS digest_runs (
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  week_key   TEXT NOT NULL,                  -- ISO week covered, e.g. 2026-W39
  summary    JSONB NOT NULL DEFAULT '{}',
  delivered  JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, week_key)
);
ALTER TABLE digest_runs ENABLE ROW LEVEL SECURITY;           -- service role only
GRANT ALL ON digest_runs TO service_role;

NOTIFY pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>>>>>>  010_audit_timezone.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- TokenFin additive migration 010
-- Audit log (who changed what) and a per-workspace time zone. Safe to re-run.

CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id UUID,
  actor_email   TEXT,
  action        TEXT NOT NULL,          -- e.g. key.create, limit.delete, data.delete
  target_type   TEXT,
  target_id     TEXT,
  details       JSONB NOT NULL DEFAULT '{}',
  ip            TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_log_org_created ON audit_log (org_id, created_at DESC);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;              -- service role only
GRANT ALL ON audit_log TO service_role;

-- IANA time zone used to bucket days on dashboards and in daily totals.
-- Existing workspaces keep India time (the previous hard-coded behaviour).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- Settings → Data deletion and daily retention also cover the telemetry tables
-- added in 007 (productivity and API-error daily counts). Replaces 006's version.
CREATE OR REPLACE FUNCTION public.purge_org_data(p_org UUID, p_before TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  n_events BIGINT; n_agg BIGINT; n_prompts BIGINT; n_spans BIGINT; n_traces BIGINT; n_ccr BIGINT;
  n_prod BIGINT := 0; n_err BIGINT := 0;
  cutoff TIMESTAMPTZ := COALESCE(p_before, 'infinity'::timestamptz);
BEGIN
  DELETE FROM usage_events    WHERE org_id = p_org AND created_at < cutoff;                GET DIAGNOSTICS n_events  = ROW_COUNT;
  DELETE FROM usage_agg       WHERE org_id = p_org AND bucket     < cutoff;                GET DIAGNOSTICS n_agg     = ROW_COUNT;
  DELETE FROM prompt_captures WHERE org_id = p_org AND created_at < cutoff;                GET DIAGNOSTICS n_prompts = ROW_COUNT;
  DELETE FROM spans           WHERE org_id = p_org AND COALESCE(start_time, created_at) < cutoff; GET DIAGNOSTICS n_spans = ROW_COUNT;
  DELETE FROM traces          WHERE org_id = p_org AND COALESCE(start_time, created_at) < cutoff; GET DIAGNOSTICS n_traces = ROW_COUNT;
  DELETE FROM ccr_store       WHERE org_id = p_org AND created_at < cutoff;                GET DIAGNOSTICS n_ccr     = ROW_COUNT;
  IF to_regclass('public.productivity_daily') IS NOT NULL THEN
    EXECUTE 'DELETE FROM productivity_daily WHERE org_id = $1 AND day < $2::date' USING p_org, cutoff;
    GET DIAGNOSTICS n_prod = ROW_COUNT;
  END IF;
  IF to_regclass('public.api_errors_daily') IS NOT NULL THEN
    EXECUTE 'DELETE FROM api_errors_daily WHERE org_id = $1 AND day < $2::date' USING p_org, cutoff;
    GET DIAGNOSTICS n_err = ROW_COUNT;
  END IF;
  IF p_before IS NULL THEN
    DELETE FROM otlp_metric_state WHERE org_id = p_org;   -- next export re-baselines cleanly
  END IF;
  RETURN jsonb_build_object(
    'usage_events', n_events, 'usage_agg', n_agg, 'prompt_captures', n_prompts,
    'spans', n_spans, 'traces', n_traces, 'ccr_store', n_ccr,
    'productivity_daily', n_prod, 'api_errors_daily', n_err);
END $$;
REVOKE EXECUTE ON FUNCTION public.purge_org_data(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_org_data(UUID, TIMESTAMPTZ) TO service_role;

NOTIFY pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>>>>>>  011_rollups_ingest.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- TokenFin additive migration 011 — rollups + ingest engine. Safe to re-run.
--
--  1. Rollup tables maintained by statement-level triggers on usage_events:
--       usage_daily          one row per org · org-local day · dimension set
--       usage_sessions       one row per org · session_id
--       usage_daily_prompts  one row per org · day · prompt_key
--     Paging raw usage_events breaks around 100k events/org/30d; reading these
--     keeps every dashboard query O(days × dimensions).
--  2. Dashboard RPCs over the rollups: dash_summary, dash_breakdown,
--     dash_sessions, dash_prompts (jsonb, SECURITY INVOKER, service_role only).
--  3. Ingest helpers: otlp_state_advance / otlp_state_revert (atomic cumulative
--     counter diffing), insert_prompt_captures (batched, deduped by prompt id),
--     org_member_ids_by_email (OTLP user.email → workspace member).
--  4. organizations.capture_prompts (privacy switch, default on).
--  5. Drops duplicate usage_events indexes.
--
-- usage_agg and upsert_usage_agg(_batch) are untouched: existing pages still
-- read usage_agg and the ingest paths still write it (metered rows only) until
-- every page reads the rollups instead.

-- ── 0. Settings ─────────────────────────────────────────────────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS capture_prompts BOOLEAN NOT NULL DEFAULT true;

-- A workspace time zone the database can't resolve must never fail an insert.
CREATE OR REPLACE FUNCTION public.tokenfin_safe_tz(p_tz TEXT)
RETURNS TEXT LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_tz IS NULL OR btrim(p_tz) = '' THEN RETURN 'Asia/Kolkata'; END IF;
  PERFORM now() AT TIME ZONE p_tz;
  RETURN p_tz;
EXCEPTION WHEN others THEN
  RETURN 'Asia/Kolkata';
END $$;

-- ── 1. Duplicate indexes ────────────────────────────────────────────────────
-- usage_events_org_created duplicates idx_usage_events_org_created (same
-- columns); nothing filters usage_events by model or metadata->>'prompt_hash'
-- without an org (the org-scoped usage_events_org_prompt_hash covers prompts).
DO $$
BEGIN
  IF to_regclass('public.usage_events_org_created') IS NOT NULL
     AND to_regclass('public.idx_usage_events_org_created') IS NOT NULL THEN
    EXECUTE 'DROP INDEX public.usage_events_org_created';
  END IF;
  IF to_regclass('public.usage_events_model') IS NOT NULL THEN
    EXECUTE 'DROP INDEX public.usage_events_model';
  END IF;
  IF to_regclass('public.idx_usage_events_prompt_hash') IS NOT NULL THEN
    EXECUTE 'DROP INDEX public.idx_usage_events_prompt_hash';
  END IF;
END $$;

-- Org-scoped idempotency: ingest upserts ON CONFLICT (org_id, event_id).
CREATE UNIQUE INDEX IF NOT EXISTS usage_events_org_event_id_uq ON usage_events (org_id, event_id);

-- ── 2. Rollup tables ────────────────────────────────────────────────────────
-- project_id uses the zero uuid for "no project" so it can sit in the key.
CREATE TABLE IF NOT EXISTS usage_daily (
  org_id             UUID    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  day                DATE    NOT NULL,
  project_id         UUID    NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  model              TEXT    NOT NULL DEFAULT '',
  source             TEXT    NOT NULL DEFAULT '',
  cost_basis         TEXT    NOT NULL DEFAULT 'metered',
  user_key           TEXT    NOT NULL DEFAULT '',
  repo               TEXT    NOT NULL DEFAULT '',
  agent              TEXT    NOT NULL DEFAULT '',
  skill              TEXT    NOT NULL DEFAULT '',
  mcp_server         TEXT    NOT NULL DEFAULT '',
  requests           BIGINT  NOT NULL DEFAULT 0,
  input_tokens       BIGINT  NOT NULL DEFAULT 0,
  output_tokens      BIGINT  NOT NULL DEFAULT 0,
  cache_read_tokens  BIGINT  NOT NULL DEFAULT 0,
  cache_write_tokens BIGINT  NOT NULL DEFAULT 0,
  reasoning_tokens   BIGINT  NOT NULL DEFAULT 0,
  total_tokens       BIGINT  NOT NULL DEFAULT 0,
  cost_usd           NUMERIC NOT NULL DEFAULT 0,
  vendor_cost_usd    NUMERIC NOT NULL DEFAULT 0,
  latency_ms_sum     BIGINT  NOT NULL DEFAULT 0,
  latency_n          BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, day, project_id, model, source, cost_basis, user_key, repo, agent, skill, mcp_server)
);
CREATE INDEX IF NOT EXISTS usage_daily_org_day ON usage_daily (org_id, day)
  INCLUDE (cost_usd, total_tokens, requests, cost_basis);

CREATE TABLE IF NOT EXISTS usage_sessions (
  org_id             UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id         TEXT        NOT NULL,
  first_at           TIMESTAMPTZ NOT NULL,
  last_at            TIMESTAMPTZ NOT NULL,
  user_key           TEXT        NOT NULL DEFAULT '',
  source             TEXT        NOT NULL DEFAULT '',
  repo               TEXT        NOT NULL DEFAULT '',
  project_id         UUID        NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  model              TEXT        NOT NULL DEFAULT '',
  agent              TEXT        NOT NULL DEFAULT '',
  requests           BIGINT      NOT NULL DEFAULT 0,
  input_tokens       BIGINT      NOT NULL DEFAULT 0,
  output_tokens      BIGINT      NOT NULL DEFAULT 0,
  cache_read_tokens  BIGINT      NOT NULL DEFAULT 0,
  cache_write_tokens BIGINT      NOT NULL DEFAULT 0,
  total_tokens       BIGINT      NOT NULL DEFAULT 0,
  cost_usd           NUMERIC     NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, session_id)
);
CREATE INDEX IF NOT EXISTS usage_sessions_org_last ON usage_sessions (org_id, last_at DESC);

CREATE TABLE IF NOT EXISTS usage_daily_prompts (
  org_id        UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  day           DATE        NOT NULL,
  prompt_key    TEXT        NOT NULL,           -- coalesce(correlation_id, usage_events.id)
  user_key      TEXT        NOT NULL DEFAULT '',
  model         TEXT        NOT NULL DEFAULT '', -- last model seen for the prompt that day
  source        TEXT        NOT NULL DEFAULT '',
  repo          TEXT        NOT NULL DEFAULT '',
  agent         TEXT        NOT NULL DEFAULT '',
  project_id    UUID        NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  first_at      TIMESTAMPTZ NOT NULL,
  last_at       TIMESTAMPTZ NOT NULL,
  requests      BIGINT      NOT NULL DEFAULT 0,
  total_tokens  BIGINT      NOT NULL DEFAULT 0,
  cost_usd      NUMERIC     NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, day, prompt_key)
);

ALTER TABLE usage_daily         ENABLE ROW LEVEL SECURITY;   -- service role only
ALTER TABLE usage_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_daily_prompts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON usage_daily, usage_sessions, usage_daily_prompts FROM anon, authenticated;
GRANT  ALL ON usage_daily, usage_sessions, usage_daily_prompts TO service_role;

-- ── 3. Rollup maintenance ───────────────────────────────────────────────────
-- One generator, three consumers: the INSERT / DELETE / UPDATE statement
-- triggers (source = a transition table) and rebuild_rollups (source = a
-- usage_events subquery). p_sign = +1 adds, -1 subtracts.
-- user_key = lower(user_email), else user_id, else ''.
CREATE OR REPLACE FUNCTION public.usage_rollup_sql(p_src TEXT, p_sign INT)
RETURNS TEXT[] LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $fn$
DECLARE
  s   TEXT := p_sign::text;
  src TEXT := format($q$
    tz AS (SELECT o.id, public.tokenfin_safe_tz(o.timezone) AS tz FROM organizations o
           WHERE o.id IN (SELECT DISTINCT org_id FROM %1$s)),
    src AS (
      SELECT r.*, (r.created_at AT TIME ZONE tz.tz)::date AS d,
             COALESCE(NULLIF(lower(btrim(r.user_email)), ''), r.user_id::text, '') AS uk,
             COALESCE(r.project_id, '00000000-0000-0000-0000-000000000000'::uuid) AS pid,
             COALESCE(NULLIF(r.agent_name, ''), NULLIF(r.query_source, ''), '') AS ag
      FROM %1$s r JOIN tz ON tz.id = r.org_id)$q$, p_src);
BEGIN
  RETURN ARRAY[
    -- usage_daily
    format($q$WITH %1$s
      INSERT INTO usage_daily AS t (org_id, day, project_id, model, source, cost_basis, user_key, repo, agent, skill, mcp_server,
        requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, total_tokens,
        cost_usd, vendor_cost_usd, latency_ms_sum, latency_n)
      SELECT org_id, d, pid, COALESCE(model, ''), COALESCE(source, ''), COALESCE(NULLIF(cost_basis, ''), 'metered'), uk,
        COALESCE(repo, ''), ag, COALESCE(skill_name, ''), COALESCE(mcp_server, ''),
        %2$s * count(*), %2$s * sum(input_tokens), %2$s * sum(output_tokens), %2$s * sum(cache_read_tokens),
        %2$s * sum(cache_write_tokens), %2$s * sum(reasoning_tokens), %2$s * sum(total_tokens),
        %2$s * sum(cost_usd), %2$s * COALESCE(sum(vendor_cost_usd), 0),
        %2$s * COALESCE(sum(latency_ms), 0), %2$s * count(latency_ms)
      FROM src GROUP BY 1,2,3,4,5,6,7,8,9,10,11 ORDER BY 1,2,3,4,5,6,7,8,9,10,11
      ON CONFLICT (org_id, day, project_id, model, source, cost_basis, user_key, repo, agent, skill, mcp_server) DO UPDATE SET
        requests = t.requests + EXCLUDED.requests,
        input_tokens = t.input_tokens + EXCLUDED.input_tokens,
        output_tokens = t.output_tokens + EXCLUDED.output_tokens,
        cache_read_tokens = t.cache_read_tokens + EXCLUDED.cache_read_tokens,
        cache_write_tokens = t.cache_write_tokens + EXCLUDED.cache_write_tokens,
        reasoning_tokens = t.reasoning_tokens + EXCLUDED.reasoning_tokens,
        total_tokens = t.total_tokens + EXCLUDED.total_tokens,
        cost_usd = t.cost_usd + EXCLUDED.cost_usd,
        vendor_cost_usd = t.vendor_cost_usd + EXCLUDED.vendor_cost_usd,
        latency_ms_sum = t.latency_ms_sum + EXCLUDED.latency_ms_sum,
        latency_n = t.latency_n + EXCLUDED.latency_n$q$, src, s),
    -- usage_sessions (newest non-empty attribute wins)
    format($q$WITH %1$s
      INSERT INTO usage_sessions AS t (org_id, session_id, first_at, last_at, user_key, source, repo, project_id, model, agent,
        requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost_usd)
      SELECT org_id, session_id, min(created_at), max(created_at),
        COALESCE((array_agg(uk ORDER BY created_at DESC) FILTER (WHERE uk <> ''))[1], ''),
        COALESCE((array_agg(source ORDER BY created_at DESC) FILTER (WHERE COALESCE(source, '') <> ''))[1], ''),
        COALESCE((array_agg(repo ORDER BY created_at DESC) FILTER (WHERE COALESCE(repo, '') <> ''))[1], ''),
        (array_agg(pid ORDER BY created_at DESC))[1],
        COALESCE((array_agg(model ORDER BY created_at DESC) FILTER (WHERE COALESCE(model, '') <> ''))[1], ''),
        COALESCE((array_agg(ag ORDER BY created_at DESC) FILTER (WHERE ag <> ''))[1], ''),
        %2$s * count(*), %2$s * sum(input_tokens), %2$s * sum(output_tokens), %2$s * sum(cache_read_tokens),
        %2$s * sum(cache_write_tokens), %2$s * sum(total_tokens), %2$s * sum(cost_usd)
      FROM src WHERE COALESCE(session_id, '') <> ''
      GROUP BY org_id, session_id ORDER BY org_id, session_id
      ON CONFLICT (org_id, session_id) DO UPDATE SET
        first_at = CASE WHEN %2$s > 0 THEN LEAST(t.first_at, EXCLUDED.first_at) ELSE t.first_at END,
        last_at  = CASE WHEN %2$s > 0 THEN GREATEST(t.last_at, EXCLUDED.last_at) ELSE t.last_at END,
        user_key = COALESCE(NULLIF(CASE WHEN EXCLUDED.last_at >= t.last_at THEN EXCLUDED.user_key END, ''), NULLIF(t.user_key, ''), EXCLUDED.user_key),
        source   = COALESCE(NULLIF(CASE WHEN EXCLUDED.last_at >= t.last_at THEN EXCLUDED.source END, ''), NULLIF(t.source, ''), EXCLUDED.source),
        repo     = COALESCE(NULLIF(CASE WHEN EXCLUDED.last_at >= t.last_at THEN EXCLUDED.repo END, ''), NULLIF(t.repo, ''), EXCLUDED.repo),
        model    = COALESCE(NULLIF(CASE WHEN EXCLUDED.last_at >= t.last_at THEN EXCLUDED.model END, ''), NULLIF(t.model, ''), EXCLUDED.model),
        agent    = COALESCE(NULLIF(CASE WHEN EXCLUDED.last_at >= t.last_at THEN EXCLUDED.agent END, ''), NULLIF(t.agent, ''), EXCLUDED.agent),
        project_id = CASE WHEN EXCLUDED.last_at >= t.last_at THEN EXCLUDED.project_id ELSE t.project_id END,
        requests = t.requests + EXCLUDED.requests,
        input_tokens = t.input_tokens + EXCLUDED.input_tokens,
        output_tokens = t.output_tokens + EXCLUDED.output_tokens,
        cache_read_tokens = t.cache_read_tokens + EXCLUDED.cache_read_tokens,
        cache_write_tokens = t.cache_write_tokens + EXCLUDED.cache_write_tokens,
        total_tokens = t.total_tokens + EXCLUDED.total_tokens,
        cost_usd = t.cost_usd + EXCLUDED.cost_usd$q$, src, s),
    -- usage_daily_prompts
    format($q$WITH %1$s
      INSERT INTO usage_daily_prompts AS t (org_id, day, prompt_key, user_key, model, source, repo, agent, project_id,
        first_at, last_at, requests, total_tokens, cost_usd)
      SELECT org_id, d, COALESCE(NULLIF(correlation_id, ''), id::text),
        COALESCE((array_agg(uk ORDER BY created_at DESC) FILTER (WHERE uk <> ''))[1], ''),
        COALESCE((array_agg(model ORDER BY created_at DESC) FILTER (WHERE COALESCE(model, '') <> ''))[1], ''),
        COALESCE((array_agg(source ORDER BY created_at DESC) FILTER (WHERE COALESCE(source, '') <> ''))[1], ''),
        COALESCE((array_agg(repo ORDER BY created_at DESC) FILTER (WHERE COALESCE(repo, '') <> ''))[1], ''),
        COALESCE((array_agg(ag ORDER BY created_at DESC) FILTER (WHERE ag <> ''))[1], ''),
        (array_agg(pid ORDER BY created_at DESC))[1],
        min(created_at), max(created_at),
        %2$s * count(*), %2$s * sum(total_tokens), %2$s * sum(cost_usd)
      FROM src GROUP BY 1,2,3 ORDER BY 1,2,3
      ON CONFLICT (org_id, day, prompt_key) DO UPDATE SET
        first_at = CASE WHEN %2$s > 0 THEN LEAST(t.first_at, EXCLUDED.first_at) ELSE t.first_at END,
        last_at  = CASE WHEN %2$s > 0 THEN GREATEST(t.last_at, EXCLUDED.last_at) ELSE t.last_at END,
        user_key = COALESCE(NULLIF(CASE WHEN EXCLUDED.last_at >= t.last_at THEN EXCLUDED.user_key END, ''), NULLIF(t.user_key, ''), EXCLUDED.user_key),
        model    = COALESCE(NULLIF(CASE WHEN EXCLUDED.last_at >= t.last_at THEN EXCLUDED.model END, ''), NULLIF(t.model, ''), EXCLUDED.model),
        source   = COALESCE(NULLIF(CASE WHEN EXCLUDED.last_at >= t.last_at THEN EXCLUDED.source END, ''), NULLIF(t.source, ''), EXCLUDED.source),
        repo     = COALESCE(NULLIF(CASE WHEN EXCLUDED.last_at >= t.last_at THEN EXCLUDED.repo END, ''), NULLIF(t.repo, ''), EXCLUDED.repo),
        agent    = COALESCE(NULLIF(CASE WHEN EXCLUDED.last_at >= t.last_at THEN EXCLUDED.agent END, ''), NULLIF(t.agent, ''), EXCLUDED.agent),
        project_id = CASE WHEN EXCLUDED.last_at >= t.last_at THEN EXCLUDED.project_id ELSE t.project_id END,
        requests = t.requests + EXCLUDED.requests,
        total_tokens = t.total_tokens + EXCLUDED.total_tokens,
        cost_usd = t.cost_usd + EXCLUDED.cost_usd$q$, src, s)
  ];
END $fn$;

-- Rows whose last event was removed (subtraction reached zero) disappear.
CREATE OR REPLACE FUNCTION public.usage_rollup_prune(p_orgs UUID[])
RETURNS VOID LANGUAGE sql SET search_path = public, pg_temp AS $$
  DELETE FROM usage_daily         WHERE org_id = ANY (p_orgs) AND requests <= 0;
  DELETE FROM usage_sessions      WHERE org_id = ANY (p_orgs) AND requests <= 0;
  DELETE FROM usage_daily_prompts WHERE org_id = ANY (p_orgs) AND requests <= 0;
$$;

CREATE OR REPLACE FUNCTION public.usage_rollup_trg()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  q TEXT;
  orgs UUID[];
BEGIN
  -- purge_org_data sets this while it wipes a whole org's rollups itself.
  IF current_setting('tokenfin.skip_rollups', true) = 'on' THEN RETURN NULL; END IF;

  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    EXECUTE 'SELECT array_agg(DISTINCT org_id) FROM old_rows' INTO orgs;
  ELSE
    EXECUTE 'SELECT array_agg(DISTINCT org_id) FROM new_rows' INTO orgs;
  END IF;
  IF orgs IS NULL THEN RETURN NULL; END IF;
  -- Shared with other writers; rebuild_rollups takes it exclusively.
  PERFORM pg_advisory_xact_lock_shared(hashtext('tokenfin_rollup:' || o::text)) FROM unnest(orgs) o ORDER BY o;

  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    FOREACH q IN ARRAY public.usage_rollup_sql('old_rows', -1) LOOP EXECUTE q; END LOOP;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    FOREACH q IN ARRAY public.usage_rollup_sql('new_rows', 1) LOOP EXECUTE q; END LOOP;
  END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    PERFORM public.usage_rollup_prune(orgs);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS usage_events_rollup_ins ON usage_events;
DROP TRIGGER IF EXISTS usage_events_rollup_del ON usage_events;
DROP TRIGGER IF EXISTS usage_events_rollup_upd ON usage_events;
CREATE TRIGGER usage_events_rollup_ins AFTER INSERT ON usage_events
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.usage_rollup_trg();
CREATE TRIGGER usage_events_rollup_del AFTER DELETE ON usage_events
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.usage_rollup_trg();
CREATE TRIGGER usage_events_rollup_upd AFTER UPDATE ON usage_events
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.usage_rollup_trg();

-- Recompute an org's rollups from usage_events (backfill; re-bucket after a
-- time-zone change). Returns the usage_daily row count.
CREATE OR REPLACE FUNCTION public.rebuild_rollups(p_org UUID)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  q TEXT;
  n BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('tokenfin_rollup:' || p_org::text));
  DELETE FROM usage_daily         WHERE org_id = p_org;
  DELETE FROM usage_sessions      WHERE org_id = p_org;
  DELETE FROM usage_daily_prompts WHERE org_id = p_org;
  FOREACH q IN ARRAY public.usage_rollup_sql(format('(SELECT * FROM usage_events WHERE org_id = %L)', p_org), 1) LOOP
    EXECUTE q;
  END LOOP;
  SELECT count(*) INTO n FROM usage_daily WHERE org_id = p_org;
  RETURN n;
END $$;

-- Days are org-local: a time-zone change re-buckets that org's rollups.
CREATE OR REPLACE FUNCTION public.org_timezone_rollup_trg()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.rebuild_rollups(NEW.id);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS organizations_timezone_rollups ON organizations;
CREATE TRIGGER organizations_timezone_rollups AFTER UPDATE OF timezone ON organizations
  FOR EACH ROW WHEN (OLD.timezone IS DISTINCT FROM NEW.timezone)
  EXECUTE FUNCTION public.org_timezone_rollup_trg();

-- ── 4. purge_org_data (replaces 010's; same behaviour + rollups) ────────────
-- A dated purge lets the DELETE trigger subtract exactly the removed events; a
-- full wipe (p_before NULL) skips the trigger and drops the rollups directly.
CREATE OR REPLACE FUNCTION public.purge_org_data(p_org UUID, p_before TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  n_events BIGINT; n_agg BIGINT; n_prompts BIGINT; n_spans BIGINT; n_traces BIGINT; n_ccr BIGINT;
  n_prod BIGINT := 0; n_err BIGINT := 0; n_daily BIGINT := 0;
  cutoff TIMESTAMPTZ := COALESCE(p_before, 'infinity'::timestamptz);
BEGIN
  IF p_before IS NULL THEN
    PERFORM set_config('tokenfin.skip_rollups', 'on', true);
    DELETE FROM usage_events WHERE org_id = p_org;                                        GET DIAGNOSTICS n_events = ROW_COUNT;
    PERFORM set_config('tokenfin.skip_rollups', 'off', true);
    DELETE FROM usage_daily         WHERE org_id = p_org;                                 GET DIAGNOSTICS n_daily = ROW_COUNT;
    DELETE FROM usage_sessions      WHERE org_id = p_org;
    DELETE FROM usage_daily_prompts WHERE org_id = p_org;
  ELSE
    DELETE FROM usage_events WHERE org_id = p_org AND created_at < cutoff;                GET DIAGNOSTICS n_events = ROW_COUNT;
  END IF;
  DELETE FROM usage_agg       WHERE org_id = p_org AND bucket     < cutoff;                GET DIAGNOSTICS n_agg     = ROW_COUNT;
  DELETE FROM prompt_captures WHERE org_id = p_org AND created_at < cutoff;                GET DIAGNOSTICS n_prompts = ROW_COUNT;
  DELETE FROM spans           WHERE org_id = p_org AND COALESCE(start_time, created_at) < cutoff; GET DIAGNOSTICS n_spans = ROW_COUNT;
  DELETE FROM traces          WHERE org_id = p_org AND COALESCE(start_time, created_at) < cutoff; GET DIAGNOSTICS n_traces = ROW_COUNT;
  DELETE FROM ccr_store       WHERE org_id = p_org AND created_at < cutoff;                GET DIAGNOSTICS n_ccr     = ROW_COUNT;
  IF to_regclass('public.productivity_daily') IS NOT NULL THEN
    EXECUTE 'DELETE FROM productivity_daily WHERE org_id = $1 AND day < $2::date' USING p_org, cutoff;
    GET DIAGNOSTICS n_prod = ROW_COUNT;
  END IF;
  IF to_regclass('public.api_errors_daily') IS NOT NULL THEN
    EXECUTE 'DELETE FROM api_errors_daily WHERE org_id = $1 AND day < $2::date' USING p_org, cutoff;
    GET DIAGNOSTICS n_err = ROW_COUNT;
  END IF;
  IF p_before IS NULL THEN
    DELETE FROM otlp_metric_state WHERE org_id = p_org;   -- next export re-baselines cleanly
  END IF;
  RETURN jsonb_build_object(
    'usage_events', n_events, 'usage_agg', n_agg, 'prompt_captures', n_prompts,
    'spans', n_spans, 'traces', n_traces, 'ccr_store', n_ccr,
    'productivity_daily', n_prod, 'api_errors_daily', n_err, 'usage_daily', n_daily);
END $$;

-- ── 5. org_spend_since: whole org-local days from usage_daily ───────────────
-- Same signature. Full days on/after p_since come from the rollup; only the
-- partial first day (when p_since isn't an org-local midnight) reads events.
CREATE OR REPLACE FUNCTION public.org_spend_since(p_org UUID, p_since TIMESTAMPTZ, p_metered_only BOOLEAN DEFAULT false)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_tz TEXT;
  v_day DATE;
  v_boundary TIMESTAMPTZ;
  v_rollup NUMERIC := 0;
  v_partial NUMERIC := 0;
BEGIN
  SELECT public.tokenfin_safe_tz(timezone) INTO v_tz FROM organizations WHERE id = p_org;
  IF v_tz IS NULL THEN RETURN 0; END IF;
  v_day := (p_since AT TIME ZONE v_tz)::date;
  IF (v_day::timestamp AT TIME ZONE v_tz) < p_since THEN v_day := v_day + 1; END IF;
  v_boundary := v_day::timestamp AT TIME ZONE v_tz;

  SELECT COALESCE(SUM(cost_usd), 0) INTO v_rollup FROM usage_daily
  WHERE org_id = p_org AND day >= v_day AND (NOT p_metered_only OR cost_basis <> 'notional');

  IF v_boundary > p_since THEN
    SELECT COALESCE(SUM(cost_usd), 0) INTO v_partial FROM usage_events
    WHERE org_id = p_org AND created_at >= p_since AND created_at < v_boundary
      AND (NOT p_metered_only OR cost_basis IS DISTINCT FROM 'notional');
  END IF;
  RETURN v_rollup + v_partial;
END $$;

-- ── 6. Dashboard RPCs ───────────────────────────────────────────────────────
-- p_filters keys (all optional, exact match): project_id (zero uuid = none),
-- user_key, model, source, repo, agent. Sessions and prompts match on the
-- attribute last seen for that session/prompt.

CREATE OR REPLACE FUNCTION public.dash_summary(p_org UUID, p_from DATE, p_to DATE, p_filters JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  f JSONB := COALESCE(p_filters, '{}'::jsonb);
  f_project UUID := NULLIF(f->>'project_id', '')::uuid;
  f_user TEXT := NULLIF(f->>'user_key', '');
  f_model TEXT := NULLIF(f->>'model', '');
  f_source TEXT := NULLIF(f->>'source', '');
  f_repo TEXT := NULLIF(f->>'repo', '');
  f_agent TEXT := NULLIF(f->>'agent', '');
  v_tz TEXT;
  v_totals JSONB;
  v_series JSONB;
  v_prompts BIGINT;
  v_sessions BIGINT;
  v_users BIGINT;
BEGIN
  IF p_to < p_from OR p_to - p_from > 1100 THEN RAISE EXCEPTION 'invalid date range'; END IF;
  SELECT public.tokenfin_safe_tz(timezone) INTO v_tz FROM organizations WHERE id = p_org;

  WITH base AS (
    SELECT * FROM usage_daily
    WHERE org_id = p_org AND day BETWEEN p_from AND p_to
      AND (f_project IS NULL OR project_id = f_project)
      AND (f_user IS NULL OR user_key = f_user)
      AND (f_model IS NULL OR model = f_model)
      AND (f_source IS NULL OR source = f_source)
      AND (f_repo IS NULL OR repo = f_repo)
      AND (f_agent IS NULL OR agent = f_agent)
  ), per_day AS (
    SELECT day,
      SUM(cost_usd) AS cost_usd,
      COALESCE(SUM(cost_usd) FILTER (WHERE cost_basis <> 'notional'), 0) AS metered_cost_usd,
      COALESCE(SUM(cost_usd) FILTER (WHERE cost_basis = 'notional'), 0) AS notional_cost_usd,
      SUM(vendor_cost_usd) AS vendor_cost_usd,
      SUM(requests) AS requests, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
      SUM(cache_read_tokens) AS cache_read_tokens, SUM(cache_write_tokens) AS cache_write_tokens,
      SUM(reasoning_tokens) AS reasoning_tokens, SUM(total_tokens) AS total_tokens,
      SUM(latency_ms_sum) AS latency_ms_sum, SUM(latency_n) AS latency_n
    FROM base GROUP BY day
  )
  SELECT
    jsonb_build_object(
      'cost_usd', COALESCE(SUM(p.cost_usd), 0),
      'metered_cost_usd', COALESCE(SUM(p.metered_cost_usd), 0),
      'notional_cost_usd', COALESCE(SUM(p.notional_cost_usd), 0),
      'vendor_cost_usd', COALESCE(SUM(p.vendor_cost_usd), 0),
      'requests', COALESCE(SUM(p.requests), 0),
      'input_tokens', COALESCE(SUM(p.input_tokens), 0),
      'output_tokens', COALESCE(SUM(p.output_tokens), 0),
      'cache_read_tokens', COALESCE(SUM(p.cache_read_tokens), 0),
      'cache_write_tokens', COALESCE(SUM(p.cache_write_tokens), 0),
      'reasoning_tokens', COALESCE(SUM(p.reasoning_tokens), 0),
      'total_tokens', COALESCE(SUM(p.total_tokens), 0),
      'avg_latency_ms', CASE WHEN COALESCE(SUM(p.latency_n), 0) > 0 THEN round(SUM(p.latency_ms_sum)::numeric / SUM(p.latency_n), 1) END,
      'active_days', count(p.day)),
    COALESCE(jsonb_agg(jsonb_build_object(
      'day', g.day::date,
      'cost_usd', COALESCE(p.cost_usd, 0),
      'metered_cost_usd', COALESCE(p.metered_cost_usd, 0),
      'notional_cost_usd', COALESCE(p.notional_cost_usd, 0),
      'requests', COALESCE(p.requests, 0),
      'total_tokens', COALESCE(p.total_tokens, 0),
      'cache_read_tokens', COALESCE(p.cache_read_tokens, 0),
      'input_tokens', COALESCE(p.input_tokens, 0),
      'output_tokens', COALESCE(p.output_tokens, 0)
    ) ORDER BY g.day), '[]'::jsonb)
  INTO v_totals, v_series
  FROM generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') AS g(day)
  LEFT JOIN per_day p ON p.day = g.day::date;

  -- DISTINCT in a subquery hashes; count(DISTINCT) sorts (4x slower here).
  SELECT count(*) INTO v_prompts FROM (SELECT DISTINCT prompt_key FROM usage_daily_prompts
  WHERE org_id = p_org AND day BETWEEN p_from AND p_to
    AND (f_project IS NULL OR project_id = f_project)
    AND (f_user IS NULL OR user_key = f_user)
    AND (f_model IS NULL OR model = f_model)
    AND (f_source IS NULL OR source = f_source)
    AND (f_repo IS NULL OR repo = f_repo)
    AND (f_agent IS NULL OR agent = f_agent)) x;

  SELECT count(*) INTO v_sessions FROM usage_sessions
  WHERE org_id = p_org
    AND last_at >= (p_from::timestamp AT TIME ZONE v_tz) AND last_at < ((p_to + 1)::timestamp AT TIME ZONE v_tz)
    AND (f_project IS NULL OR project_id = f_project)
    AND (f_user IS NULL OR user_key = f_user)
    AND (f_model IS NULL OR model = f_model)
    AND (f_source IS NULL OR source = f_source)
    AND (f_repo IS NULL OR repo = f_repo)
    AND (f_agent IS NULL OR agent = f_agent);

  SELECT count(*) INTO v_users FROM (SELECT DISTINCT user_key FROM usage_daily
  WHERE org_id = p_org AND day BETWEEN p_from AND p_to AND user_key <> ''
    AND (f_project IS NULL OR project_id = f_project)
    AND (f_user IS NULL OR user_key = f_user)
    AND (f_model IS NULL OR model = f_model)
    AND (f_source IS NULL OR source = f_source)
    AND (f_repo IS NULL OR repo = f_repo)
    AND (f_agent IS NULL OR agent = f_agent)) u;

  RETURN v_totals || jsonb_build_object(
    'from', p_from, 'to', p_to, 'timezone', v_tz,
    'prompts', v_prompts, 'sessions', v_sessions, 'active_users', v_users,
    'series', v_series);
END $$;

-- p_dim: model | project | member | source | agent | skill | mcp_server | repo | day | cost_basis
-- Returns { rows: [...top p_limit by cost (day: chronological)], other: {...rest} | null, total_keys }.
CREATE OR REPLACE FUNCTION public.dash_breakdown(p_org UUID, p_from DATE, p_to DATE, p_dim TEXT,
  p_filters JSONB DEFAULT '{}'::jsonb, p_limit INT DEFAULT 50)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  f JSONB := COALESCE(p_filters, '{}'::jsonb);
  v_col TEXT;
  v_lim INT := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 1000);
  v_out JSONB;
BEGIN
  IF p_to < p_from OR p_to - p_from > 1100 THEN RAISE EXCEPTION 'invalid date range'; END IF;
  v_col := CASE p_dim
    WHEN 'model' THEN 'model' WHEN 'project' THEN 'project_id::text' WHEN 'member' THEN 'user_key'
    WHEN 'source' THEN 'source' WHEN 'agent' THEN 'agent' WHEN 'skill' THEN 'skill'
    WHEN 'mcp_server' THEN 'mcp_server' WHEN 'repo' THEN 'repo' WHEN 'day' THEN 'day::text'
    WHEN 'cost_basis' THEN 'cost_basis' END;
  IF v_col IS NULL THEN RAISE EXCEPTION 'unknown dimension: %', p_dim; END IF;
  IF p_dim = 'day' THEN v_lim := 1101; END IF;

  EXECUTE format($q$
    WITH g AS (
      SELECT %1$s AS key,
        SUM(requests) AS requests, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
        SUM(cache_read_tokens) AS cache_read_tokens, SUM(cache_write_tokens) AS cache_write_tokens,
        SUM(reasoning_tokens) AS reasoning_tokens, SUM(total_tokens) AS total_tokens,
        SUM(cost_usd) AS cost_usd,
        COALESCE(SUM(cost_usd) FILTER (WHERE cost_basis <> 'notional'), 0) AS metered_cost_usd,
        COALESCE(SUM(cost_usd) FILTER (WHERE cost_basis = 'notional'), 0) AS notional_cost_usd,
        SUM(vendor_cost_usd) AS vendor_cost_usd,
        CASE WHEN SUM(latency_n) > 0 THEN round(SUM(latency_ms_sum)::numeric / SUM(latency_n), 1) END AS avg_latency_ms,
        count(DISTINCT day) AS active_days,
        count(DISTINCT user_key) FILTER (WHERE user_key <> '') AS users
      FROM usage_daily
      WHERE org_id = $1 AND day BETWEEN $2 AND $3
        AND ($4::uuid IS NULL OR project_id = $4)
        AND ($5::text IS NULL OR user_key = $5)
        AND ($6::text IS NULL OR model = $6)
        AND ($7::text IS NULL OR source = $7)
        AND ($8::text IS NULL OR repo = $8)
        AND ($9::text IS NULL OR agent = $9)
      GROUP BY 1
    ), ranked AS (
      SELECT g.*, row_number() OVER (ORDER BY %2$s) AS rn, count(*) OVER () AS n FROM g
    )
    SELECT jsonb_build_object(
      'rows', COALESCE(jsonb_agg(to_jsonb(r) - 'rn' - 'n' ORDER BY r.rn) FILTER (WHERE r.rn <= $10), '[]'::jsonb),
      'other', CASE WHEN COALESCE(max(r.n), 0) > $10 THEN jsonb_build_object(
        'keys', max(r.n) - $10,
        'requests', SUM(r.requests) FILTER (WHERE r.rn > $10),
        'total_tokens', SUM(r.total_tokens) FILTER (WHERE r.rn > $10),
        'cost_usd', SUM(r.cost_usd) FILTER (WHERE r.rn > $10),
        'metered_cost_usd', SUM(r.metered_cost_usd) FILTER (WHERE r.rn > $10),
        'notional_cost_usd', SUM(r.notional_cost_usd) FILTER (WHERE r.rn > $10)) END,
      'total_keys', COALESCE(max(r.n), 0))
    FROM ranked r$q$, v_col, CASE WHEN p_dim = 'day' THEN 'key' ELSE 'cost_usd DESC, total_tokens DESC, key' END)
  INTO v_out
  USING p_org, p_from, p_to,
    NULLIF(f->>'project_id', '')::uuid, NULLIF(f->>'user_key', ''), NULLIF(f->>'model', ''),
    NULLIF(f->>'source', ''), NULLIF(f->>'repo', ''), NULLIF(f->>'agent', ''), v_lim;
  RETURN v_out;
END $$;

-- Sessions whose last activity falls in [p_from, p_to] (org-local days).
-- p_order: recent (default) | cost | tokens. Returns { total, rows }.
CREATE OR REPLACE FUNCTION public.dash_sessions(p_org UUID, p_from DATE, p_to DATE,
  p_filters JSONB DEFAULT '{}'::jsonb, p_limit INT DEFAULT 50, p_offset INT DEFAULT 0, p_order TEXT DEFAULT 'recent')
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  f JSONB := COALESCE(p_filters, '{}'::jsonb);
  f_project UUID := NULLIF(f->>'project_id', '')::uuid;
  f_user TEXT := NULLIF(f->>'user_key', '');
  f_model TEXT := NULLIF(f->>'model', '');
  f_source TEXT := NULLIF(f->>'source', '');
  f_repo TEXT := NULLIF(f->>'repo', '');
  f_agent TEXT := NULLIF(f->>'agent', '');
  v_lim INT := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 1000);
  v_off INT := GREATEST(COALESCE(p_offset, 0), 0);
  v_tz TEXT;
  v_out JSONB;
BEGIN
  IF p_to < p_from OR p_to - p_from > 1100 THEN RAISE EXCEPTION 'invalid date range'; END IF;
  SELECT public.tokenfin_safe_tz(timezone) INTO v_tz FROM organizations WHERE id = p_org;
  WITH s AS (
    SELECT * FROM usage_sessions
    WHERE org_id = p_org
      AND last_at >= (p_from::timestamp AT TIME ZONE v_tz) AND last_at < ((p_to + 1)::timestamp AT TIME ZONE v_tz)
      AND (f_project IS NULL OR project_id = f_project)
      AND (f_user IS NULL OR user_key = f_user)
      AND (f_model IS NULL OR model = f_model)
      AND (f_source IS NULL OR source = f_source)
      AND (f_repo IS NULL OR repo = f_repo)
      AND (f_agent IS NULL OR agent = f_agent)
  ), page AS (
    SELECT * FROM s
    ORDER BY
      CASE WHEN p_order = 'cost' THEN cost_usd END DESC NULLS LAST,
      CASE WHEN p_order = 'tokens' THEN total_tokens END DESC NULLS LAST,
      last_at DESC, session_id
    LIMIT v_lim OFFSET v_off
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM s),
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(p) - 'org_id' ORDER BY
      CASE WHEN p_order = 'cost' THEN p.cost_usd END DESC NULLS LAST,
      CASE WHEN p_order = 'tokens' THEN p.total_tokens END DESC NULLS LAST,
      p.last_at DESC, p.session_id) FROM page p), '[]'::jsonb))
  INTO v_out;
  RETURN v_out;
END $$;

-- Prompts (one per prompt_key) active in [p_from, p_to], summed across days.
-- p_order: cost (default) | recent | tokens | requests. Returns { total, rows }.
CREATE OR REPLACE FUNCTION public.dash_prompts(p_org UUID, p_from DATE, p_to DATE,
  p_filters JSONB DEFAULT '{}'::jsonb, p_limit INT DEFAULT 50, p_offset INT DEFAULT 0, p_order TEXT DEFAULT 'cost')
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  f JSONB := COALESCE(p_filters, '{}'::jsonb);
  f_project UUID := NULLIF(f->>'project_id', '')::uuid;
  f_user TEXT := NULLIF(f->>'user_key', '');
  f_model TEXT := NULLIF(f->>'model', '');
  f_source TEXT := NULLIF(f->>'source', '');
  f_repo TEXT := NULLIF(f->>'repo', '');
  f_agent TEXT := NULLIF(f->>'agent', '');
  v_lim INT := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 1000);
  v_off INT := GREATEST(COALESCE(p_offset, 0), 0);
  v_out JSONB;
BEGIN
  IF p_to < p_from OR p_to - p_from > 1100 THEN RAISE EXCEPTION 'invalid date range'; END IF;
  WITH d AS (
    SELECT * FROM usage_daily_prompts
    WHERE org_id = p_org AND day BETWEEN p_from AND p_to
      AND (f_project IS NULL OR project_id = f_project)
      AND (f_user IS NULL OR user_key = f_user)
      AND (f_model IS NULL OR model = f_model)
      AND (f_source IS NULL OR source = f_source)
      AND (f_repo IS NULL OR repo = f_repo)
      AND (f_agent IS NULL OR agent = f_agent)
  ), g AS (
    SELECT prompt_key,
      (array_agg(user_key ORDER BY last_at DESC))[1] AS user_key,
      (array_agg(model ORDER BY last_at DESC))[1] AS model,
      (array_agg(source ORDER BY last_at DESC))[1] AS source,
      (array_agg(repo ORDER BY last_at DESC))[1] AS repo,
      (array_agg(agent ORDER BY last_at DESC))[1] AS agent,
      (array_agg(project_id ORDER BY last_at DESC))[1] AS project_id,
      min(first_at) AS first_at, max(last_at) AS last_at,
      SUM(requests) AS requests, SUM(total_tokens) AS total_tokens, SUM(cost_usd) AS cost_usd
    FROM d GROUP BY prompt_key
  ), page AS (
    SELECT * FROM g
    ORDER BY
      CASE WHEN p_order = 'recent' THEN extract(epoch FROM last_at) END DESC NULLS LAST,
      CASE WHEN p_order = 'tokens' THEN total_tokens END DESC NULLS LAST,
      CASE WHEN p_order = 'requests' THEN requests END DESC NULLS LAST,
      cost_usd DESC, prompt_key
    LIMIT v_lim OFFSET v_off
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM g),
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY
      CASE WHEN p_order = 'recent' THEN extract(epoch FROM p.last_at) END DESC NULLS LAST,
      CASE WHEN p_order = 'tokens' THEN p.total_tokens END DESC NULLS LAST,
      CASE WHEN p_order = 'requests' THEN p.requests END DESC NULLS LAST,
      p.cost_usd DESC, p.prompt_key) FROM page p), '[]'::jsonb))
  INTO v_out;
  RETURN v_out;
END $$;

-- ── 7. Ingest helpers ───────────────────────────────────────────────────────
-- Cumulative OTLP counters: advance each series to GREATEST(old, new) and
-- return the previous value (NULL = first seen). Row locks make the claim
-- atomic, so two concurrent exports can never both emit the same delta.
CREATE OR REPLACE FUNCTION public.otlp_state_advance(p_org UUID, p_keys TEXT[], p_values NUMERIC[])
RETURNS TABLE (series_key TEXT, prev NUMERIC) LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH input AS (
    SELECT k, max(v) AS v FROM unnest(p_keys, p_values) AS x(k, v) WHERE k IS NOT NULL AND v IS NOT NULL GROUP BY k
  ), locked AS (
    SELECT s.series_key AS k, s.value FROM otlp_metric_state s JOIN input i ON i.k = s.series_key
    WHERE s.org_id = p_org ORDER BY s.series_key FOR UPDATE OF s
  ), upd AS (
    UPDATE otlp_metric_state s SET value = GREATEST(s.value, i.v), updated_at = now()
    FROM input i JOIN locked l ON l.k = i.k
    WHERE s.org_id = p_org AND s.series_key = i.k
    RETURNING s.series_key AS k, l.value AS prev
  ), ins AS (
    INSERT INTO otlp_metric_state (org_id, series_key, value)
    SELECT p_org, i.k, i.v FROM input i WHERE NOT EXISTS (SELECT 1 FROM locked l WHERE l.k = i.k)
    ORDER BY i.k
    ON CONFLICT (org_id, series_key) DO NOTHING
    RETURNING otlp_metric_state.series_key AS k, NULL::numeric AS prev
  )
  SELECT u.k, u.prev FROM upd u UNION ALL SELECT n.k, n.prev FROM ins n;
END $$;

-- Undo an advance whose rows failed to persist (compare-and-set: only if no
-- later export has moved the series since).
CREATE OR REPLACE FUNCTION public.otlp_state_revert(p_org UUID, p_keys TEXT[], p_values NUMERIC[], p_prev NUMERIC[])
RETURNS INT LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE n INT := 0; m INT := 0;
BEGIN
  UPDATE otlp_metric_state s SET value = x.p, updated_at = now()
  FROM unnest(p_keys, p_values, p_prev) AS x(k, v, p)
  WHERE s.org_id = p_org AND s.series_key = x.k AND s.value = x.v AND x.p IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM otlp_metric_state s
  USING unnest(p_keys, p_values, p_prev) AS x(k, v, p)
  WHERE s.org_id = p_org AND s.series_key = x.k AND s.value = x.v AND x.p IS NULL;
  GET DIAGNOSTICS m = ROW_COUNT;
  RETURN n + m;
END $$;

-- Batched prompt capture, one row per (org, prompt_hash): skips prompts already
-- stored. Rows without a hash are always inserted.
CREATE OR REPLACE FUNCTION public.insert_prompt_captures(p_rows JSONB)
RETURNS INT LANGUAGE sql SET search_path = public, pg_temp AS $$
  WITH r AS (
    SELECT * FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS x(
      org_id UUID, project_id UUID, user_id UUID, model TEXT, prompt_hash TEXT, prompt_text TEXT,
      response_text TEXT, context TEXT, input_tokens BIGINT, output_tokens BIGINT, cost_usd NUMERIC,
      created_at TIMESTAMPTZ)
    WHERE org_id IS NOT NULL AND COALESCE(prompt_text, '') <> ''
  ), d AS (
    SELECT DISTINCT ON (org_id, COALESCE(prompt_hash, md5(prompt_text))) *
    FROM r ORDER BY org_id, COALESCE(prompt_hash, md5(prompt_text)), created_at NULLS LAST
  ), ins AS (
    INSERT INTO prompt_captures (org_id, project_id, user_id, model, prompt_hash, prompt_text, response_text,
      context, input_tokens, output_tokens, cost_usd, created_at)
    SELECT d.org_id, d.project_id, d.user_id, COALESCE(d.model, ''), d.prompt_hash, d.prompt_text, d.response_text,
      d.context, COALESCE(d.input_tokens, 0), COALESCE(d.output_tokens, 0), COALESCE(d.cost_usd, 0),
      COALESCE(d.created_at, now())
    FROM d
    WHERE d.prompt_hash IS NULL OR NOT EXISTS (
      SELECT 1 FROM prompt_captures pc WHERE pc.org_id = d.org_id AND pc.prompt_hash = d.prompt_hash)
    RETURNING 1
  )
  SELECT count(*)::int FROM ins;
$$;

-- OTLP user.email / SDK user_email → the workspace member's user id.
CREATE OR REPLACE FUNCTION public.org_member_ids_by_email(p_org UUID, p_emails TEXT[])
RETURNS TABLE (email TEXT, user_id UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT lower(u.email)::text, m.user_id
  FROM members m JOIN auth.users u ON u.id = m.user_id
  WHERE m.org_id = p_org
    AND lower(u.email) IN (SELECT lower(btrim(e)) FROM unnest(p_emails) e);
$$;

-- ── 8. Privileges: service role only ────────────────────────────────────────
DO $$
DECLARE fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.tokenfin_safe_tz(text)',
    'public.usage_rollup_sql(text, integer)',
    'public.usage_rollup_prune(uuid[])',
    'public.usage_rollup_trg()',
    'public.rebuild_rollups(uuid)',
    'public.org_timezone_rollup_trg()',
    'public.purge_org_data(uuid, timestamptz)',
    'public.org_spend_since(uuid, timestamptz, boolean)',
    'public.dash_summary(uuid, date, date, jsonb)',
    'public.dash_breakdown(uuid, date, date, text, jsonb, integer)',
    'public.dash_sessions(uuid, date, date, jsonb, integer, integer, text)',
    'public.dash_prompts(uuid, date, date, jsonb, integer, integer, text)',
    'public.otlp_state_advance(uuid, text[], numeric[])',
    'public.otlp_state_revert(uuid, text[], numeric[], numeric[])',
    'public.insert_prompt_captures(jsonb)',
    'public.org_member_ids_by_email(uuid, text[])'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- ── 9. Backfill ─────────────────────────────────────────────────────────────
SELECT public.rebuild_rollups(id) FROM organizations;

NOTIFY pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>>>>>>  012_keys_access.sql  >>>>>>>>>>>>>>>>>>>>>>>>
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

-- >>>>>>>>>>>>>>>>>>>>>>>>  013_connectors.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- TokenFin additive migration 013
-- Pull connectors for coding-AI vendors + cost per merged PR.
--   * provider_connections  — new providers (claude_code_analytics, cursor,
--                             github_copilot, github) + a non-secret config jsonb
--   * coding_tool_usage     — daily per-user rows pulled from vendor admin APIs
--   * merged_prs            — merged pull requests pulled from GitHub
--   * github_user_map       — manual GitHub login → user_key (email) mapping
--   * coding_tools_summary() / merged_pr_costs() — read-side aggregation RPCs
-- Service role only. Safe to re-run; nothing is dropped except the provider
-- CHECK constraint, which is re-created wider.

-- ── provider_connections: more providers + config ───────────────────────────
ALTER TABLE public.provider_connections ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'::jsonb;   -- non-secret settings (github_org, repos)
ALTER TABLE public.provider_connections DROP CONSTRAINT IF EXISTS provider_connections_provider_chk;
ALTER TABLE public.provider_connections ADD CONSTRAINT provider_connections_provider_chk
  CHECK (provider IN ('anthropic', 'openai', 'claude_code_analytics', 'cursor', 'github_copilot', 'github'));

-- ── coding_tool_usage ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coding_tool_usage (
  id             BIGSERIAL PRIMARY KEY,
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tool           TEXT NOT NULL,                     -- claude_code_analytics | cursor | github_copilot
  day            DATE NOT NULL,                     -- UTC day as reported by the vendor
  user_key       TEXT NOT NULL,                     -- lowercased email; 'github:<login>' for Copilot; '(organization)' for org-level spend
  model          TEXT NOT NULL DEFAULT '',          -- '' = activity row (not model-specific)
  requests       BIGINT NOT NULL DEFAULT 0,
  sessions       BIGINT NOT NULL DEFAULT 0,
  input_tokens   BIGINT NOT NULL DEFAULT 0,
  output_tokens  BIGINT NOT NULL DEFAULT 0,
  lines_added    BIGINT NOT NULL DEFAULT 0,
  lines_removed  BIGINT NOT NULL DEFAULT 0,
  accepted       BIGINT NOT NULL DEFAULT 0,
  suggested      BIGINT NOT NULL DEFAULT 0,
  commits        BIGINT NOT NULL DEFAULT 0,
  pull_requests  BIGINT NOT NULL DEFAULT 0,
  cost_usd       NUMERIC(14,6) NOT NULL DEFAULT 0,
  cost_basis     TEXT NOT NULL DEFAULT 'vendor_reported',
  raw            JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT coding_tool_usage_uq UNIQUE (org_id, tool, day, user_key, model)
);
DO $$ BEGIN
  ALTER TABLE public.coding_tool_usage ADD CONSTRAINT coding_tool_usage_basis_chk
    CHECK (cost_basis IN ('vendor_reported', 'notional'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS coding_tool_usage_org_day ON public.coding_tool_usage (org_id, day);

-- ── merged_prs ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.merged_prs (
  id            BIGSERIAL PRIMARY KEY,
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  repo          TEXT NOT NULL,                      -- owner/name
  number        INT  NOT NULL,
  author_login  TEXT NOT NULL DEFAULT '',
  author_email  TEXT NULL,                          -- head-commit author email when not a noreply address
  opened_at     TIMESTAMPTZ NULL,
  merged_at     TIMESTAMPTZ NOT NULL,
  additions     INT NULL,                           -- NULL until the PR detail has been fetched
  deletions     INT NULL,
  head_ref      TEXT NOT NULL DEFAULT '',
  title         TEXT NOT NULL DEFAULT '',
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT merged_prs_uq UNIQUE (org_id, repo, number)
);
CREATE INDEX IF NOT EXISTS merged_prs_org_merged ON public.merged_prs (org_id, merged_at DESC);

-- ── github_user_map ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.github_user_map (
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  login       TEXT NOT NULL,                        -- stored lowercased
  user_key    TEXT NOT NULL,                        -- lowercased email (matches usage_events.user_email / productivity_daily.user_key)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, login)
);

ALTER TABLE public.coding_tool_usage ENABLE ROW LEVEL SECURITY;   -- service role only
ALTER TABLE public.merged_prs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_user_map   ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.coding_tool_usage, public.merged_prs, public.github_user_map FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.coding_tool_usage, public.merged_prs, public.github_user_map FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.coding_tool_usage, public.merged_prs, public.github_user_map TO service_role';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.coding_tool_usage_id_seq, public.merged_prs_id_seq TO service_role';
  END IF;
END $$;

-- Repository key used to join GitHub repos (owner/name) with telemetry repos
-- (usually the bare basename, sometimes a URL): lowercased basename, no .git.
CREATE OR REPLACE FUNCTION public.tf_repo_key(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT NULLIF(regexp_replace(lower(regexp_replace(btrim(coalesce(p, '')), '/+$', '')), '^.*[/:]|\.git$', '', 'g'), '')
$$;

-- Per tool × developer totals across vendor connectors and TokenFin's own
-- CLI-agent telemetry (usage_events by source + productivity_daily).
-- Copilot rows keyed 'github:<login>' resolve through github_user_map.
CREATE OR REPLACE FUNCTION public.coding_tools_summary(p_org UUID, p_since DATE, p_since_ts TIMESTAMPTZ)
RETURNS TABLE (
  tool TEXT, user_key TEXT,
  cost_vendor NUMERIC, cost_notional NUMERIC,
  requests BIGINT, sessions BIGINT, input_tokens BIGINT, output_tokens BIGINT,
  lines_added BIGINT, lines_removed BIGINT, accepted BIGINT, suggested BIGINT,
  commits BIGINT, pull_requests BIGINT, active_days BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH u AS (
    -- vendor connectors
    SELECT c.tool,
           lower(coalesce(gm.user_key, c.user_key)) AS user_key,
           c.day,
           CASE WHEN c.cost_basis = 'notional' THEN 0 ELSE c.cost_usd END AS cost_vendor,
           CASE WHEN c.cost_basis = 'notional' THEN c.cost_usd ELSE 0 END AS cost_notional,
           c.requests, c.sessions, c.input_tokens, c.output_tokens, c.lines_added, c.lines_removed,
           c.accepted, c.suggested, c.commits, c.pull_requests
    FROM coding_tool_usage c
    LEFT JOIN github_user_map gm
      ON c.tool = 'github_copilot' AND gm.org_id = c.org_id AND 'github:' || gm.login = c.user_key
    WHERE c.org_id = p_org AND c.day >= p_since
    UNION ALL
    -- TokenFin telemetry: per-turn usage rows from CLI agents
    SELECT 'otel:' || e.source,
           lower(coalesce(NULLIF(e.user_email, ''), au.email, NULLIF(e.actor_id, ''), 'unknown')),
           (e.created_at AT TIME ZONE 'UTC')::date,
           CASE WHEN e.cost_basis IS DISTINCT FROM 'notional' THEN e.cost_usd ELSE 0 END,
           CASE WHEN e.cost_basis = 'notional' THEN e.cost_usd ELSE 0 END,
           1, 0, e.input_tokens, e.output_tokens, 0, 0, 0, 0, 0, 0
    FROM usage_events e
    LEFT JOIN auth.users au ON au.id = e.user_id
    WHERE e.org_id = p_org AND e.created_at >= p_since_ts
      AND e.source IN ('claude_code', 'codex_cli', 'gemini_cli', 'opencode')
    UNION ALL
    -- TokenFin telemetry: Claude Code productivity counters
    SELECT 'otel:claude_code',
           lower(coalesce(au.email, NULLIF(p.user_key, ''), 'unknown')),
           p.day, 0, 0, 0, coalesce(p.sessions, 0), 0, 0,
           coalesce(p.lines_added, 0), coalesce(p.lines_removed, 0),
           coalesce(p.edits_accepted, 0), coalesce(p.edits_accepted, 0) + coalesce(p.edits_rejected, 0),
           coalesce(p.commits, 0), coalesce(p.pull_requests, 0)
    FROM productivity_daily p
    LEFT JOIN auth.users au ON au.id = p.user_id
    WHERE p.org_id = p_org AND p.day >= p_since
  )
  SELECT tool, user_key,
         SUM(cost_vendor), SUM(cost_notional),
         SUM(requests)::bigint, SUM(sessions)::bigint, SUM(input_tokens)::bigint, SUM(output_tokens)::bigint,
         SUM(lines_added)::bigint, SUM(lines_removed)::bigint, SUM(accepted)::bigint, SUM(suggested)::bigint,
         SUM(commits)::bigint, SUM(pull_requests)::bigint, COUNT(DISTINCT day)::bigint
  FROM u
  GROUP BY tool, user_key
$$;

-- Cost per merged PR. Attribution: TokenFin usage (usage_events) in the PR's
-- repo by the PR's author between that author's previous merge in the same repo
-- (else the PR's open time, else 14 days before merge) and this merge.
-- Author → user_key via github_user_map, else the head-commit author email.
CREATE OR REPLACE FUNCTION public.merged_pr_costs(p_org UUID, p_since TIMESTAMPTZ)
RETURNS TABLE (
  repo TEXT, number INT, title TEXT, author_login TEXT, user_key TEXT,
  merged_at TIMESTAMPTZ, window_start TIMESTAMPTZ, additions INT, deletions INT,
  cost_usd NUMERIC, notional_usd NUMERIC, events BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH pr AS (
    SELECT m.repo, m.number, m.title, m.author_login, m.merged_at, m.additions, m.deletions,
           NULLIF(lower(coalesce(gm.user_key, m.author_email, '')), '') AS ukey,
           tf_repo_key(m.repo) AS rkey,
           coalesce(
             lag(m.merged_at) OVER (PARTITION BY m.repo, lower(m.author_login) ORDER BY m.merged_at, m.number),
             m.opened_at,
             m.merged_at - interval '14 days') AS wstart
    FROM merged_prs m
    LEFT JOIN github_user_map gm ON gm.org_id = m.org_id AND gm.login = lower(m.author_login)
    WHERE m.org_id = p_org
  )
  SELECT pr.repo, pr.number, pr.title, pr.author_login, pr.ukey, pr.merged_at, pr.wstart,
         pr.additions, pr.deletions,
         coalesce(x.cost, 0), coalesce(x.notional, 0), coalesce(x.n, 0)
  FROM pr
  LEFT JOIN LATERAL (
    SELECT SUM(e.cost_usd) AS cost,
           SUM(CASE WHEN e.cost_basis = 'notional' THEN e.cost_usd ELSE 0 END) AS notional,
           COUNT(*)::bigint AS n
    FROM usage_events e
    LEFT JOIN auth.users au ON au.id = e.user_id
    WHERE pr.ukey IS NOT NULL
      AND e.org_id = p_org
      AND e.repo IS NOT NULL
      AND e.created_at >  pr.wstart
      AND e.created_at <= pr.merged_at
      AND tf_repo_key(e.repo) = pr.rkey
      AND lower(coalesce(NULLIF(e.user_email, ''), au.email, '')) = pr.ukey
  ) x ON true
  WHERE pr.merged_at >= p_since
$$;

REVOKE EXECUTE ON FUNCTION public.tf_repo_key(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.coding_tools_summary(UUID, DATE, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merged_pr_costs(UUID, TIMESTAMPTZ) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.tf_repo_key(TEXT) FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.coding_tools_summary(UUID, DATE, TIMESTAMPTZ) FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.merged_pr_costs(UUID, TIMESTAMPTZ) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.tf_repo_key(TEXT) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.coding_tools_summary(UUID, DATE, TIMESTAMPTZ) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.merged_pr_costs(UUID, TIMESTAMPTZ) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.tf_repo_key(TEXT) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.coding_tools_summary(UUID, DATE, TIMESTAMPTZ) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.merged_pr_costs(UUID, TIMESTAMPTZ) TO service_role';
  END IF;
END $$;

-- >>>>>>>>>>>>>>>>>>>>>>>>  014_finops.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- TokenFin additive migration 014 — FinOps exports & governance.
--   * allocation_rules        : tag/repo/email/project → team & cost center (+ shared-cost split)
--   * price_sync_findings     : nightly catalog-vs-public-source diffs and unpriced models seen
--   * finops_usage_dims()     : event-level usage grouped by the dimensions allocation needs
--                               (FOCUS export, allocation preview)
--   * price_sync_model_usage(): which orgs used which models recently (and how many unpriced)
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS allocation_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'assign',
  priority    INTEGER NOT NULL DEFAULT 100,
  match       JSONB NOT NULL DEFAULT '{}'::jsonb,
  assign      JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  ALTER TABLE allocation_rules ADD CONSTRAINT allocation_rules_kind_check CHECK (kind IN ('assign', 'shared_split'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS allocation_rules_org_priority ON allocation_rules (org_id, priority, created_at);
ALTER TABLE allocation_rules ENABLE ROW LEVEL SECURITY;          -- service role only
GRANT ALL ON allocation_rules TO service_role;

CREATE TABLE IF NOT EXISTS price_sync_findings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model       TEXT NOT NULL,
  kind        TEXT NOT NULL,                    -- price_mismatch | unpriced_seen
  ours        JSONB NOT NULL DEFAULT '{}'::jsonb,
  theirs      JSONB NOT NULL DEFAULT '{}'::jsonb,
  orgs        UUID[] NOT NULL DEFAULT '{}',     -- orgs that used the model recently (scopes visibility)
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);
DO $$ BEGIN
  ALTER TABLE price_sync_findings ADD CONSTRAINT price_sync_findings_kind_check CHECK (kind IN ('price_mismatch', 'unpriced_seen'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS price_sync_findings_model_kind ON price_sync_findings (model, kind);
CREATE INDEX IF NOT EXISTS price_sync_findings_orgs ON price_sync_findings USING GIN (orgs);
ALTER TABLE price_sync_findings ENABLE ROW LEVEL SECURITY;       -- service role only
GRANT ALL ON price_sync_findings TO service_role;

-- Usage grouped by every dimension allocation rules can match on. One row per
-- (day?, provider, model, project, source, cost_basis, user, email, repo, tag subset).
-- p_by_day = false collapses the day dimension (allocation preview).
CREATE OR REPLACE FUNCTION public.finops_usage_dims(
  p_org UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tz TEXT DEFAULT 'UTC',
  p_tag_keys TEXT[] DEFAULT '{}', p_by_day BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  day DATE, provider TEXT, model TEXT, project_id UUID, source TEXT, cost_basis TEXT,
  user_id UUID, user_email TEXT, repo TEXT, tag_values JSONB,
  events BIGINT, input_tokens BIGINT, output_tokens BIGINT, cache_read_tokens BIGINT,
  cache_write_tokens BIGINT, reasoning_tokens BIGINT, total_tokens BIGINT,
  cost_usd NUMERIC, vendor_cost_usd NUMERIC
)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT
    CASE WHEN p_by_day THEN (e.created_at AT TIME ZONE COALESCE(p_tz, 'UTC'))::date END AS day,
    e.provider, e.model, e.project_id, e.source, e.cost_basis,
    e.user_id, e.user_email, e.repo,
    COALESCE((SELECT jsonb_object_agg(k, e.tags->>k) FROM unnest(p_tag_keys) k WHERE e.tags ? k), '{}'::jsonb) AS tag_values,
    COUNT(*)::bigint,
    COALESCE(SUM(e.input_tokens), 0)::bigint, COALESCE(SUM(e.output_tokens), 0)::bigint,
    COALESCE(SUM(e.cache_read_tokens), 0)::bigint, COALESCE(SUM(e.cache_write_tokens), 0)::bigint,
    COALESCE(SUM(e.reasoning_tokens), 0)::bigint, COALESCE(SUM(e.total_tokens), 0)::bigint,
    COALESCE(SUM(e.cost_usd), 0), SUM(e.vendor_cost_usd)
  FROM usage_events e
  WHERE e.org_id = p_org AND e.created_at >= p_from AND e.created_at < p_to
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
  ORDER BY 1, 2, 3, 4, 5, 6, 7, 8, 9
$$;
REVOKE EXECUTE ON FUNCTION public.finops_usage_dims(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT[], BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.finops_usage_dims(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT[], BOOLEAN) TO service_role;

-- Models each org used since p_since, with how many events were priced with
-- the fallback rate (ingest tags them price_known = 'false').
CREATE OR REPLACE FUNCTION public.price_sync_model_usage(p_since TIMESTAMPTZ)
RETURNS TABLE (org_id UUID, model TEXT, events BIGINT, unpriced BIGINT)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT e.org_id, e.model, COUNT(*)::bigint,
         COUNT(*) FILTER (WHERE e.tags->>'price_known' = 'false')::bigint
  FROM usage_events e
  WHERE e.created_at >= p_since
  GROUP BY e.org_id, e.model
$$;
REVOKE EXECUTE ON FUNCTION public.price_sync_model_usage(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.price_sync_model_usage(TIMESTAMPTZ) TO service_role;

NOTIFY pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>>>>>>  015_retention_connectors.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- 015: retention covers the connector tables (013).
--
-- Redefines purge_org_data (last set in 011) so Settings → Data and the daily
-- retention cron also clear coding_tool_usage (by vendor day) and merged_prs
-- (by merged_at). A full wipe also removes the org from price_sync_findings.orgs
-- (014). Same signature and return shape (two extra counters). Idempotent.

CREATE OR REPLACE FUNCTION public.purge_org_data(p_org UUID, p_before TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  n_events BIGINT; n_agg BIGINT; n_prompts BIGINT; n_spans BIGINT; n_traces BIGINT; n_ccr BIGINT;
  n_prod BIGINT := 0; n_err BIGINT := 0; n_daily BIGINT := 0; n_tools BIGINT := 0; n_prs BIGINT := 0;
  cutoff TIMESTAMPTZ := COALESCE(p_before, 'infinity'::timestamptz);
BEGIN
  IF p_before IS NULL THEN
    PERFORM set_config('tokenfin.skip_rollups', 'on', true);
    DELETE FROM usage_events WHERE org_id = p_org;                                        GET DIAGNOSTICS n_events = ROW_COUNT;
    PERFORM set_config('tokenfin.skip_rollups', 'off', true);
    DELETE FROM usage_daily         WHERE org_id = p_org;                                 GET DIAGNOSTICS n_daily = ROW_COUNT;
    DELETE FROM usage_sessions      WHERE org_id = p_org;
    DELETE FROM usage_daily_prompts WHERE org_id = p_org;
  ELSE
    DELETE FROM usage_events WHERE org_id = p_org AND created_at < cutoff;                GET DIAGNOSTICS n_events = ROW_COUNT;
  END IF;
  DELETE FROM usage_agg       WHERE org_id = p_org AND bucket     < cutoff;                GET DIAGNOSTICS n_agg     = ROW_COUNT;
  DELETE FROM prompt_captures WHERE org_id = p_org AND created_at < cutoff;                GET DIAGNOSTICS n_prompts = ROW_COUNT;
  DELETE FROM spans           WHERE org_id = p_org AND COALESCE(start_time, created_at) < cutoff; GET DIAGNOSTICS n_spans = ROW_COUNT;
  DELETE FROM traces          WHERE org_id = p_org AND COALESCE(start_time, created_at) < cutoff; GET DIAGNOSTICS n_traces = ROW_COUNT;
  DELETE FROM ccr_store       WHERE org_id = p_org AND created_at < cutoff;                GET DIAGNOSTICS n_ccr     = ROW_COUNT;
  IF to_regclass('public.productivity_daily') IS NOT NULL THEN
    EXECUTE 'DELETE FROM productivity_daily WHERE org_id = $1 AND day < $2::date' USING p_org, cutoff;
    GET DIAGNOSTICS n_prod = ROW_COUNT;
  END IF;
  IF to_regclass('public.api_errors_daily') IS NOT NULL THEN
    EXECUTE 'DELETE FROM api_errors_daily WHERE org_id = $1 AND day < $2::date' USING p_org, cutoff;
    GET DIAGNOSTICS n_err = ROW_COUNT;
  END IF;
  IF to_regclass('public.coding_tool_usage') IS NOT NULL THEN
    EXECUTE 'DELETE FROM coding_tool_usage WHERE org_id = $1 AND day < $2::date' USING p_org, cutoff;
    GET DIAGNOSTICS n_tools = ROW_COUNT;
  END IF;
  IF to_regclass('public.merged_prs') IS NOT NULL THEN
    EXECUTE 'DELETE FROM merged_prs WHERE org_id = $1 AND merged_at < $2' USING p_org, cutoff;
    GET DIAGNOSTICS n_prs = ROW_COUNT;
  END IF;
  IF p_before IS NULL AND to_regclass('public.price_sync_findings') IS NOT NULL THEN
    EXECUTE 'UPDATE price_sync_findings SET orgs = array_remove(orgs, $1) WHERE $1 = ANY(orgs)' USING p_org;
  END IF;
  IF p_before IS NULL THEN
    DELETE FROM otlp_metric_state WHERE org_id = p_org;   -- next export re-baselines cleanly
  END IF;
  RETURN jsonb_build_object(
    'usage_events', n_events, 'usage_agg', n_agg, 'prompt_captures', n_prompts,
    'spans', n_spans, 'traces', n_traces, 'ccr_store', n_ccr,
    'productivity_daily', n_prod, 'api_errors_daily', n_err, 'usage_daily', n_daily,
    'coding_tool_usage', n_tools, 'merged_prs', n_prs);
END $$;

REVOKE EXECUTE ON FUNCTION public.purge_org_data(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_org_data(UUID, TIMESTAMPTZ) TO service_role;

-- >>>>>>>>>>>>>>>>>>>>>>>>  016_prompt_privacy.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- 016: prompt privacy at the database layer.
--
-- Before: every member of an org could read every other member's prompt text
-- straight from PostgREST with their own JWT (prompt_captures.prompt_text,
-- usage_events.prompt_preview / session_id / user_email, spans.attributes which
-- can carry gen_ai prompt content). The app pages use the service role, so this
-- only changes what an `authenticated` user can read directly.
--
-- After (matches lib/rbac.ts promptScope):
--   owner / admin  → every row in their org
--   member / viewer → only rows attributed to themselves
--
--   prompt_captures : user_id = auth.uid()
--   usage_events    : user_id = auth.uid() OR lower(user_email) = JWT email
--   spans           : attributes 'user.id' = auth.uid() OR 'user.email' = JWT email
--                     (most spans carry no user → owner/admin only)
--
-- Checked and left alone:
--   usage_sessions / usage_daily_prompts / usage_daily (011): RLS on with NO
--     policies → service role only already.
--   traces: name + totals only, no per-user text; policy unchanged.
--   ccr_store: RLS on, no policies → service role only.
--
-- Idempotent (DROP POLICY IF EXISTS + CREATE), guarded by to_regclass.

DO $$
BEGIN
  -- ── prompt_captures ──────────────────────────────────────────────────────
  IF to_regclass('public.prompt_captures') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.prompt_captures ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS prompt_captures_select ON public.prompt_captures';
    EXECUTE $p$
      CREATE POLICY prompt_captures_select ON public.prompt_captures
      FOR SELECT TO authenticated
      USING (
        org_id IN (SELECT m.org_id FROM public.members m
                   WHERE m.user_id = (SELECT auth.uid()) AND m.role IN ('owner', 'admin'))
        OR (
          user_id = (SELECT auth.uid())
          AND org_id IN (SELECT m.org_id FROM public.members m WHERE m.user_id = (SELECT auth.uid()))
        )
      )
    $p$;
  END IF;

  -- ── usage_events (prompt_preview, session_id, user_email) ────────────────
  IF to_regclass('public.usage_events') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS usage_events_select ON public.usage_events';
    EXECUTE $p$
      CREATE POLICY usage_events_select ON public.usage_events
      FOR SELECT TO authenticated
      USING (
        org_id IN (SELECT m.org_id FROM public.members m
                   WHERE m.user_id = (SELECT auth.uid()) AND m.role IN ('owner', 'admin'))
        OR (
          org_id IN (SELECT m.org_id FROM public.members m WHERE m.user_id = (SELECT auth.uid()))
          AND (
            user_id = (SELECT auth.uid())
            OR (user_email IS NOT NULL AND lower(user_email) = lower((SELECT auth.jwt() ->> 'email')))
          )
        )
      )
    $p$;
  END IF;

  -- ── spans (attributes may hold gen_ai prompt / completion text) ──────────
  IF to_regclass('public.spans') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.spans ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS spans_select ON public.spans';
    EXECUTE $p$
      CREATE POLICY spans_select ON public.spans
      FOR SELECT TO authenticated
      USING (
        org_id IN (SELECT m.org_id FROM public.members m
                   WHERE m.user_id = (SELECT auth.uid()) AND m.role IN ('owner', 'admin'))
        OR (
          org_id IN (SELECT m.org_id FROM public.members m WHERE m.user_id = (SELECT auth.uid()))
          AND (
            attributes ->> 'user.id' = (SELECT auth.uid())::text
            OR lower(attributes ->> 'user.email') = lower((SELECT auth.jwt() ->> 'email'))
          )
        )
      )
    $p$;
  END IF;
END $$;

-- >>>>>>>>>>>>>>>>>>>>>>>>  017_job_runs.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- 017: job_runs — one row per scheduled job run (cron routes / pg_cron).
--
-- Written by lib/jobs.ts withJobRun() through job_run_start / job_run_finish,
-- read by operators (docs/OPERATIONS.md). Service role only: RLS on, no
-- policies, and table privileges revoked from anon/authenticated.
--
-- job_run_start() also prunes rows older than 30 days, so the table never
-- grows without bound (no separate cleanup job needed).
--
-- tf_schema_probe() lets /api/health report the highest detectable migration
-- without exposing the catalog to clients. Idempotent; safe to re-run.

CREATE TABLE IF NOT EXISTS public.job_runs (
  id           BIGSERIAL PRIMARY KEY,
  job          TEXT        NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  ok           BOOLEAN,                      -- NULL while running (or if the run died)
  duration_ms  INTEGER,
  summary      JSONB,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS job_runs_job_started ON public.job_runs (job, started_at DESC);
CREATE INDEX IF NOT EXISTS job_runs_started     ON public.job_runs (started_at);

ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;          -- service role only
REVOKE ALL ON public.job_runs FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.job_runs TO service_role;
DO $$ BEGIN
  REVOKE ALL ON SEQUENCE public.job_runs_id_seq FROM PUBLIC, anon, authenticated;
  GRANT USAGE, SELECT ON SEQUENCE public.job_runs_id_seq TO service_role;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Start a run: insert the row and prune anything older than 30 days.
CREATE OR REPLACE FUNCTION public.job_run_start(p_job TEXT)
RETURNS BIGINT LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_id BIGINT;
BEGIN
  IF p_job IS NULL OR length(p_job) = 0 OR length(p_job) > 64 THEN
    RAISE EXCEPTION 'job name must be 1-64 chars';
  END IF;
  DELETE FROM job_runs WHERE started_at < NOW() - INTERVAL '30 days';
  INSERT INTO job_runs (job, started_at) VALUES (p_job, NOW()) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Finish a run. The error text is truncated; summaries over 16 KB are replaced
-- by a marker so one noisy run cannot bloat the table.
CREATE OR REPLACE FUNCTION public.job_run_finish(
  p_id BIGINT, p_ok BOOLEAN, p_summary JSONB DEFAULT NULL, p_error TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE job_runs SET
    finished_at = NOW(),
    ok          = p_ok,
    duration_ms = LEAST(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000, 2147483647)::INTEGER,
    summary     = CASE WHEN p_summary IS NULL THEN NULL
                       WHEN length(p_summary::text) > 16384 THEN jsonb_build_object('truncated', true)
                       ELSE p_summary END,
    error       = left(p_error, 2000)
  WHERE id = p_id;
END $$;

-- Which of the given objects exist? 'table' → to_regclass, 'table.column' →
-- information_schema.columns, 'fn()' → pg_proc. Public schema only.
CREATE OR REPLACE FUNCTION public.tf_schema_probe(p_names TEXT[])
RETURNS TEXT[] LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(array_agg(n), '{}') FROM unnest(p_names) AS n
  WHERE CASE
    WHEN n LIKE '%()' THEN EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
      WHERE s.nspname = 'public' AND p.proname = left(n, length(n) - 2))
    WHEN n LIKE '%.%' THEN EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = split_part(n, '.', 1)
        AND c.column_name = split_part(n, '.', 2))
    ELSE to_regclass('public.' || quote_ident(n)) IS NOT NULL
  END
$$;

REVOKE EXECUTE ON FUNCTION public.job_run_start(TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.job_run_start(TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.job_run_finish(BIGINT, BOOLEAN, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.job_run_finish(BIGINT, BOOLEAN, JSONB, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.tf_schema_probe(TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tf_schema_probe(TEXT[]) TO service_role;

-- >>>>>>>>>>>>>>>>>>>>>>>>  018_traces.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- 018: traces experience + standards GenAI span ingest.
--
-- Adds the columns the OTLP trace receiver (web/src/app/api/otel/v1/traces)
-- now extracts from OpenTelemetry GenAI / OpenInference / OpenLLMetry spans
-- (lib/otlp/genai.ts), and the per-trace rollup the /dashboard/traces list
-- pages over (keyset on start_time DESC, trace_id DESC).
--
--   spans : status, span kind, service, operation, provider, cache/reasoning
--           tokens, duration, attributed user / email, session (conversation id)
--   traces: service, root span, duration, error count, models, user, session,
--           input/output tokens
--
-- Functions (service role only):
--   trace_usage_parents(org, trace_ids)  spans that parent a token-bearing span
--                                        (aggregates — never mirrored to usage)
--   refresh_traces(org, trace_ids, proj) recompute + upsert the traces rows
--   trace_filter_options(org, since)     distinct services / models for filters
--
-- Idempotent: IF NOT EXISTS everywhere, CREATE OR REPLACE for functions.

-- ── spans ────────────────────────────────────────────────────────────────────
ALTER TABLE spans ADD COLUMN IF NOT EXISTS status_code        SMALLINT NOT NULL DEFAULT 0;  -- 0 unset · 1 ok · 2 error
ALTER TABLE spans ADD COLUMN IF NOT EXISTS status_message     TEXT;
ALTER TABLE spans ADD COLUMN IF NOT EXISTS span_kind          SMALLINT NOT NULL DEFAULT 0;  -- OTLP SpanKind
ALTER TABLE spans ADD COLUMN IF NOT EXISTS service_name       TEXT;
ALTER TABLE spans ADD COLUMN IF NOT EXISTS operation          TEXT;
ALTER TABLE spans ADD COLUMN IF NOT EXISTS provider           TEXT;
ALTER TABLE spans ADD COLUMN IF NOT EXISTS cache_read_tokens  BIGINT NOT NULL DEFAULT 0;
ALTER TABLE spans ADD COLUMN IF NOT EXISTS cache_write_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE spans ADD COLUMN IF NOT EXISTS reasoning_tokens   BIGINT NOT NULL DEFAULT 0;
ALTER TABLE spans ADD COLUMN IF NOT EXISTS duration_ms        DOUBLE PRECISION;
ALTER TABLE spans ADD COLUMN IF NOT EXISTS user_id            UUID;
ALTER TABLE spans ADD COLUMN IF NOT EXISTS user_email         TEXT;
ALTER TABLE spans ADD COLUMN IF NOT EXISTS session_id         TEXT;

-- ── traces ───────────────────────────────────────────────────────────────────
ALTER TABLE traces ADD COLUMN IF NOT EXISTS service_name  TEXT;
ALTER TABLE traces ADD COLUMN IF NOT EXISTS root_span_id  TEXT;
ALTER TABLE traces ADD COLUMN IF NOT EXISTS duration_ms   DOUBLE PRECISION;
ALTER TABLE traces ADD COLUMN IF NOT EXISTS error_count   INT NOT NULL DEFAULT 0;
ALTER TABLE traces ADD COLUMN IF NOT EXISTS models        TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE traces ADD COLUMN IF NOT EXISTS user_id       UUID;
ALTER TABLE traces ADD COLUMN IF NOT EXISTS session_id    TEXT;
ALTER TABLE traces ADD COLUMN IF NOT EXISTS input_tokens  BIGINT NOT NULL DEFAULT 0;
ALTER TABLE traces ADD COLUMN IF NOT EXISTS output_tokens BIGINT NOT NULL DEFAULT 0;

-- The list pages by start_time: never leave it NULL.
UPDATE traces SET start_time = created_at WHERE start_time IS NULL;

CREATE INDEX IF NOT EXISTS idx_traces_org_start   ON traces(org_id, start_time DESC, trace_id DESC);
CREATE INDEX IF NOT EXISTS idx_traces_org_user    ON traces(org_id, user_id, start_time DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spans_org_parent   ON spans(org_id, trace_id, parent_span_id) WHERE total_tokens > 0;

-- ── functions ────────────────────────────────────────────────────────────────

-- Spans that are the parent of a token-bearing span: agent / chain / workflow
-- aggregates whose tokens are already counted by their children.
CREATE OR REPLACE FUNCTION public.trace_usage_parents(p_org UUID, p_trace_ids TEXT[])
RETURNS TABLE(trace_id TEXT, span_id TEXT)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT DISTINCT s.trace_id, s.parent_span_id
  FROM spans s
  WHERE s.org_id = p_org AND s.trace_id = ANY(p_trace_ids)
    AND s.total_tokens > 0 AND s.parent_span_id IS NOT NULL;
$$;

-- Recompute the traces rows for the given trace ids from their stored spans.
-- Tokens / cost sum LEAF usage spans only (a span with a token-bearing child is
-- an aggregate), so nested agent → chat chains are not double counted.
CREATE OR REPLACE FUNCTION public.refresh_traces(p_org UUID, p_trace_ids TEXT[], p_project UUID)
RETURNS INT
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE n INT;
BEGIN
  WITH s AS (
    SELECT sp.*,
           (sp.parent_span_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM spans p WHERE p.org_id = sp.org_id AND p.trace_id = sp.trace_id AND p.span_id = sp.parent_span_id
           )) AS is_root,
           (sp.total_tokens > 0 AND NOT EXISTS (
              SELECT 1 FROM spans c WHERE c.org_id = sp.org_id AND c.trace_id = sp.trace_id
                AND c.parent_span_id = sp.span_id AND c.total_tokens > 0
           )) AS is_leaf
    FROM spans sp
    WHERE sp.org_id = p_org AND sp.trace_id = ANY(p_trace_ids)
  ),
  root AS (
    SELECT DISTINCT ON (trace_id) trace_id, span_id, name, service_name
    FROM s
    ORDER BY trace_id, is_root DESC, start_time ASC NULLS LAST, span_id
  ),
  agg AS (
    SELECT trace_id,
           MIN(start_time) AS start_time,
           MAX(end_time)   AS end_time,
           COUNT(*)::INT   AS span_count,
           COALESCE(SUM(total_tokens)  FILTER (WHERE is_leaf), 0) AS total_tokens,
           COALESCE(SUM(input_tokens)  FILTER (WHERE is_leaf), 0) AS input_tokens,
           COALESCE(SUM(output_tokens) FILTER (WHERE is_leaf), 0) AS output_tokens,
           COALESCE(SUM(cost_usd)      FILTER (WHERE is_leaf), 0) AS cost_usd,
           COUNT(*) FILTER (WHERE status_code = 2)::INT AS error_count,
           COALESCE(ARRAY_AGG(DISTINCT model) FILTER (WHERE model IS NOT NULL AND model <> ''), '{}') AS models,
           (ARRAY_AGG(user_id ORDER BY start_time) FILTER (WHERE user_id IS NOT NULL))[1] AS user_id,
           (ARRAY_AGG(session_id ORDER BY start_time) FILTER (WHERE session_id IS NOT NULL))[1] AS session_id,
           (ARRAY_AGG(service_name ORDER BY start_time) FILTER (WHERE service_name IS NOT NULL))[1] AS any_service
    FROM s GROUP BY trace_id
  )
  INSERT INTO traces AS t (trace_id, org_id, project_id, name, root_span_id, service_name, start_time, end_time,
                           duration_ms, span_count, total_tokens, input_tokens, output_tokens, cost_usd,
                           error_count, models, user_id, session_id)
  SELECT a.trace_id, p_org, p_project, COALESCE(r.name, 'trace'), r.span_id, COALESCE(r.service_name, a.any_service),
         COALESCE(a.start_time, NOW()), a.end_time,
         CASE WHEN a.start_time IS NOT NULL AND a.end_time IS NOT NULL
              THEN GREATEST(0, EXTRACT(EPOCH FROM (a.end_time - a.start_time)) * 1000) END,
         a.span_count, a.total_tokens, a.input_tokens, a.output_tokens, ROUND(a.cost_usd, 8),
         a.error_count, a.models, a.user_id, a.session_id
  FROM agg a LEFT JOIN root r ON r.trace_id = a.trace_id
  ON CONFLICT (org_id, trace_id) DO UPDATE SET
    project_id   = COALESCE(t.project_id, EXCLUDED.project_id),
    name         = EXCLUDED.name,
    root_span_id = EXCLUDED.root_span_id,
    service_name = EXCLUDED.service_name,
    start_time   = LEAST(t.start_time, EXCLUDED.start_time),
    end_time     = EXCLUDED.end_time,
    duration_ms  = EXCLUDED.duration_ms,
    span_count   = EXCLUDED.span_count,
    total_tokens = EXCLUDED.total_tokens,
    input_tokens = EXCLUDED.input_tokens,
    output_tokens = EXCLUDED.output_tokens,
    cost_usd     = EXCLUDED.cost_usd,
    error_count  = EXCLUDED.error_count,
    models       = EXCLUDED.models,
    user_id      = COALESCE(EXCLUDED.user_id, t.user_id),
    session_id   = COALESCE(EXCLUDED.session_id, t.session_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Distinct services / models seen since p_since (filter dropdowns).
CREATE OR REPLACE FUNCTION public.trace_filter_options(p_org UUID, p_since TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'services', COALESCE((SELECT jsonb_agg(x ORDER BY x) FROM (
        SELECT DISTINCT service_name AS x FROM traces
        WHERE org_id = p_org AND start_time >= p_since AND service_name IS NOT NULL LIMIT 200) a), '[]'::jsonb),
    'models', COALESCE((SELECT jsonb_agg(x ORDER BY x) FROM (
        SELECT DISTINCT m AS x FROM traces, UNNEST(models) m
        WHERE org_id = p_org AND start_time >= p_since LIMIT 200) b), '[]'::jsonb)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.trace_usage_parents(UUID, TEXT[])        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_traces(UUID, TEXT[], UUID)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trace_filter_options(UUID, TIMESTAMPTZ)  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.trace_usage_parents(UUID, TEXT[])        TO service_role;
GRANT  EXECUTE ON FUNCTION public.refresh_traces(UUID, TEXT[], UUID)       TO service_role;
GRANT  EXECUTE ON FUNCTION public.trace_filter_options(UUID, TIMESTAMPTZ)  TO service_role;

-- >>>>>>>>>>>>>>>>>>>>>>>>  019_breakdown_prompts.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- 019: dash_breakdown returns a prompt count per key.
--
-- Same signature as 011. Each row gains `prompts` for the dimensions
-- usage_daily_prompts carries: model, project, member, source, agent, repo, day.
-- A prompt is attributed to ONE key (the model/project/… its rollup row holds),
-- so per-key prompts add up to the total with no double counting. For skill,
-- mcp_server and cost_basis `prompts` is null. Replaces the per-row
-- dash_summary calls the Explore view and Overview made. Idempotent.

CREATE OR REPLACE FUNCTION public.dash_breakdown(p_org UUID, p_from DATE, p_to DATE, p_dim TEXT,
  p_filters JSONB DEFAULT '{}'::jsonb, p_limit INT DEFAULT 50)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  f JSONB := COALESCE(p_filters, '{}'::jsonb);
  v_col TEXT;
  v_lim INT := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 1000);
  v_out JSONB;
  v_pcol TEXT;
BEGIN
  IF p_to < p_from OR p_to - p_from > 1100 THEN RAISE EXCEPTION 'invalid date range'; END IF;
  v_col := CASE p_dim
    WHEN 'model' THEN 'model' WHEN 'project' THEN 'project_id::text' WHEN 'member' THEN 'user_key'
    WHEN 'source' THEN 'source' WHEN 'agent' THEN 'agent' WHEN 'skill' THEN 'skill'
    WHEN 'mcp_server' THEN 'mcp_server' WHEN 'repo' THEN 'repo' WHEN 'day' THEN 'day::text'
    WHEN 'cost_basis' THEN 'cost_basis' END;
  IF v_col IS NULL THEN RAISE EXCEPTION 'unknown dimension: %', p_dim; END IF;
  IF p_dim = 'day' THEN v_lim := 1101; END IF;
  -- usage_daily_prompts has no skill / mcp_server / cost_basis → prompts = null there.
  v_pcol := CASE WHEN p_dim IN ('model','project','member','source','agent','repo','day') THEN v_col END;

  EXECUTE format($q$
    WITH g AS (
      SELECT %1$s AS key,
        SUM(requests) AS requests, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
        SUM(cache_read_tokens) AS cache_read_tokens, SUM(cache_write_tokens) AS cache_write_tokens,
        SUM(reasoning_tokens) AS reasoning_tokens, SUM(total_tokens) AS total_tokens,
        SUM(cost_usd) AS cost_usd,
        COALESCE(SUM(cost_usd) FILTER (WHERE cost_basis <> 'notional'), 0) AS metered_cost_usd,
        COALESCE(SUM(cost_usd) FILTER (WHERE cost_basis = 'notional'), 0) AS notional_cost_usd,
        SUM(vendor_cost_usd) AS vendor_cost_usd,
        CASE WHEN SUM(latency_n) > 0 THEN round(SUM(latency_ms_sum)::numeric / SUM(latency_n), 1) END AS avg_latency_ms,
        count(DISTINCT day) AS active_days,
        count(DISTINCT user_key) FILTER (WHERE user_key <> '') AS users
      FROM usage_daily
      WHERE org_id = $1 AND day BETWEEN $2 AND $3
        AND ($4::uuid IS NULL OR project_id = $4)
        AND ($5::text IS NULL OR user_key = $5)
        AND ($6::text IS NULL OR model = $6)
        AND ($7::text IS NULL OR source = $7)
        AND ($8::text IS NULL OR repo = $8)
        AND ($9::text IS NULL OR agent = $9)
      GROUP BY 1
    ), p AS (
      -- DISTINCT in a subquery hashes (faster than count(DISTINCT)). Each prompt
      -- belongs to one rollup key, so per-key counts sum to the total.
      SELECT key, count(*) AS prompts FROM (
        SELECT DISTINCT %3$s AS key, prompt_key
        FROM usage_daily_prompts
        WHERE %4$s AND org_id = $1 AND day BETWEEN $2 AND $3
          AND ($4::uuid IS NULL OR project_id = $4)
          AND ($5::text IS NULL OR user_key = $5)
          AND ($6::text IS NULL OR model = $6)
          AND ($7::text IS NULL OR source = $7)
          AND ($8::text IS NULL OR repo = $8)
          AND ($9::text IS NULL OR agent = $9)) x
      GROUP BY key
    ), ranked AS (
      SELECT g.*, p.prompts, row_number() OVER (ORDER BY %2$s) AS rn, count(*) OVER () AS n
      FROM g LEFT JOIN p ON p.key = g.key
    )
    SELECT jsonb_build_object(
      'rows', COALESCE(jsonb_agg(to_jsonb(r) - 'rn' - 'n' ORDER BY r.rn) FILTER (WHERE r.rn <= $10), '[]'::jsonb),
      'other', CASE WHEN COALESCE(max(r.n), 0) > $10 THEN jsonb_build_object(
        'keys', max(r.n) - $10,
        'requests', SUM(r.requests) FILTER (WHERE r.rn > $10),
        'total_tokens', SUM(r.total_tokens) FILTER (WHERE r.rn > $10),
        'cost_usd', SUM(r.cost_usd) FILTER (WHERE r.rn > $10),
        'metered_cost_usd', SUM(r.metered_cost_usd) FILTER (WHERE r.rn > $10),
        'notional_cost_usd', SUM(r.notional_cost_usd) FILTER (WHERE r.rn > $10)) END,
      'total_keys', COALESCE(max(r.n), 0))
    FROM ranked r$q$, v_col, CASE WHEN p_dim = 'day' THEN 'g.key' ELSE 'g.cost_usd DESC, g.total_tokens DESC, g.key' END,
    COALESCE(v_pcol, 'NULL::text'), CASE WHEN v_pcol IS NULL THEN 'false' ELSE 'true' END)
  INTO v_out
  USING p_org, p_from, p_to,
    NULLIF(f->>'project_id', '')::uuid, NULLIF(f->>'user_key', ''), NULLIF(f->>'model', ''),
    NULLIF(f->>'source', ''), NULLIF(f->>'repo', ''), NULLIF(f->>'agent', ''), v_lim;
  RETURN v_out;
END $$;

REVOKE EXECUTE ON FUNCTION public.dash_breakdown(UUID, DATE, DATE, TEXT, JSONB, INT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.dash_breakdown(UUID, DATE, DATE, TEXT, JSONB, INT) TO service_role;

COMMIT;
