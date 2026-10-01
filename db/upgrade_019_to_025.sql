-- =============================================================================
-- TokenFin — upgrade a live project from migration 019 to 025, in ONE file.
--
-- Generated from db/migrations/020…025 (unchanged, concatenated in order):
--   020 re-price Claude Code / Cowork history at their reported cost
--   021 session names            022 agent configs (Agents page)
--   023 session context + tools  024 per-model limits, alerts, policy
--   025 trace capture level (errors & warnings by default)
-- Run once in the Supabase SQL editor or with
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f <this file>
-- Single transaction: all or nothing. Every migration is idempotent.
-- Prerequisite: 001–019 applied (db/upgrade_006_to_019.sql).
-- =============================================================================

BEGIN;

-- >>>>>>>>>>>>>>>>>>>>>>>>  020_reprice_vendor_cost.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- 020: re-price past Claude Code / Cowork rows at the cost the client reported.
--
-- Claude Code and Cowork report each call's exact cost_usd (kept as
-- vendor_cost_usd). TokenFin used to price those rows itself, assuming every
-- cache write was a 5-minute write (1.25x input); Claude Code mostly writes the
-- 1-hour cache (2x input), so past rows were under-priced. New rows already use
-- the reported figure (lib/otlp/normalize.ts). This applies the same rule to
-- history: only those two sources, only a plausible figure (within 10x of the
-- stored price), and never for orgs with custom model prices (their override
-- stays authoritative). The usage_events UPDATE trigger keeps the rollups in
-- step. These rows are notional, so usage_agg (metered only) is unaffected.
-- Idempotent: a second run matches nothing.

UPDATE public.usage_events e
   SET cost_usd = e.vendor_cost_usd
 WHERE e.source IN ('claude_code', 'cowork')
   AND e.vendor_cost_usd > 0
   AND e.cost_usd > 0
   AND e.cost_usd IS DISTINCT FROM e.vendor_cost_usd
   AND e.vendor_cost_usd BETWEEN e.cost_usd / 10 AND e.cost_usd * 10
   AND NOT EXISTS (SELECT 1 FROM public.org_model_prices p WHERE p.org_id = e.org_id);

-- >>>>>>>>>>>>>>>>>>>>>>>>  021_session_titles.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- 021: session names.
--
-- A session gets a human title instead of a bare id:
--   origin 'explicit' — the agent's own title (OpenCode sends it); always wins.
--   origin 'prompt'   — the first line of the session's first captured prompt;
--                       written once, never overwrites an existing title.
-- tf_set_session_title() applies those rules atomically. A backfill names every
-- existing session from its earliest captured prompt. purge_org_data (last set
-- in 015) also clears titles. Idempotent.

CREATE TABLE IF NOT EXISTS public.session_titles (
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  title      TEXT NOT NULL,
  origin     TEXT NOT NULL DEFAULT 'prompt' CHECK (origin IN ('explicit', 'prompt')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, session_id)
);
ALTER TABLE public.session_titles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.session_titles FROM anon, authenticated;
GRANT  ALL ON public.session_titles TO service_role;

-- First non-empty line, whitespace collapsed, at most 120 characters.
CREATE OR REPLACE FUNCTION public.tf_title_from_text(p_text TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  WITH l AS (
    SELECT btrim(regexp_replace(line, '\s+', ' ', 'g')) AS line, n
    FROM regexp_split_to_table(coalesce(p_text, ''), E'\n') WITH ORDINALITY AS t(line, n)
  ), f AS (SELECT line FROM l WHERE line <> '' ORDER BY n LIMIT 1)
  SELECT CASE WHEN length(line) > 120 THEN left(line, 119) || '…' ELSE line END FROM f
$$;

CREATE OR REPLACE FUNCTION public.tf_set_session_title(p_org UUID, p_session TEXT, p_title TEXT, p_origin TEXT)
RETURNS VOID LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_title TEXT := public.tf_title_from_text(p_title);
BEGIN
  IF p_org IS NULL OR coalesce(p_session, '') = '' OR coalesce(v_title, '') = '' THEN RETURN; END IF;
  IF p_origin = 'explicit' THEN
    INSERT INTO session_titles AS t (org_id, session_id, title, origin)
    VALUES (p_org, p_session, v_title, 'explicit')
    ON CONFLICT (org_id, session_id) DO UPDATE
      SET title = EXCLUDED.title, origin = 'explicit', updated_at = now()
      WHERE t.title IS DISTINCT FROM EXCLUDED.title OR t.origin <> 'explicit';
  ELSE
    INSERT INTO session_titles (org_id, session_id, title, origin)
    VALUES (p_org, p_session, v_title, 'prompt')
    ON CONFLICT (org_id, session_id) DO NOTHING;
  END IF;
END $$;

-- Backfill: each session's earliest captured prompt.
INSERT INTO public.session_titles (org_id, session_id, title, origin)
SELECT DISTINCT ON (e.org_id, e.session_id) e.org_id, e.session_id, public.tf_title_from_text(pc.prompt_text), 'prompt'
FROM public.usage_events e
JOIN public.prompt_captures pc ON pc.org_id = e.org_id AND pc.prompt_hash = e.correlation_id
WHERE e.session_id IS NOT NULL AND coalesce(public.tf_title_from_text(pc.prompt_text), '') <> ''
ORDER BY e.org_id, e.session_id, e.created_at, e.id
ON CONFLICT (org_id, session_id) DO NOTHING;

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
  -- Session names: all of them on a full wipe, otherwise the ones whose
  -- session has no events left (the rollup triggers already removed those).
  IF to_regclass('public.session_titles') IS NOT NULL THEN
    EXECUTE 'DELETE FROM session_titles t WHERE t.org_id = $1 AND ($2::timestamptz IS NULL OR NOT EXISTS (
               SELECT 1 FROM usage_sessions s WHERE s.org_id = t.org_id AND s.session_id = t.session_id))'
      USING p_org, p_before;
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

REVOKE EXECUTE ON FUNCTION public.tf_set_session_title(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tf_set_session_title(UUID, TEXT, TEXT, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.tf_title_from_text(TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tf_title_from_text(TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.purge_org_data(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_org_data(UUID, TIMESTAMPTZ) TO service_role;

-- >>>>>>>>>>>>>>>>>>>>>>>>  022_agent_configs.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- 022: agent_configs — which coding agents each person's machines run, and how
-- they are configured (Dashboard → Agents, docs/AGENTS_CONFIG.md).
--
--   agent_devices         one row per (org, key owner, CLI device_id)
--   agent_configs         latest REDACTED config snapshot per (device, agent)
--   agent_config_history  last 10 distinct snapshots per (device, agent)
--   agent_config_changes  pull-based change requests (allow-listed JSON merge
--                         patches). Never applied server-side: the CLI on the
--                         machine applies them with `tokenfin config pull`.
--
-- Snapshots are redacted on the machine BEFORE upload (cli/lib/agentconfig.js)
-- and again by the API (web/src/lib/agent-configs/redact.ts).
--
-- Config snapshots and patches are JSON, not JSONB, on purpose: JSONB re-sorts
-- object keys, and key order is meaningful (OpenCode permission.bash: the LAST
-- matching pattern wins). Nothing queries inside them.
--
-- Service role only: RLS on, no policies, privileges revoked from anon /
-- authenticated. Every read goes through the API / server components, which
-- enforce role scoping (members see only their own devices).
-- Idempotent; safe to re-run.

CREATE TABLE IF NOT EXISTS public.agent_devices (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id        UUID        REFERENCES auth.users(id) ON DELETE CASCADE,  -- NULL = shared org-level key
  device_id      TEXT        NOT NULL,
  hostname       TEXT,
  os             TEXT,
  cli_version    TEXT,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_devices_device_id_check') THEN
    ALTER TABLE public.agent_devices
      ADD CONSTRAINT agent_devices_device_id_check CHECK (device_id ~ '^[A-Za-z0-9-]{8,64}$');
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS agent_devices_owner_device
  ON public.agent_devices (org_id, (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)), device_id);
CREATE INDEX IF NOT EXISTS agent_devices_org_user ON public.agent_devices (org_id, user_id);

CREATE TABLE IF NOT EXISTS public.agent_configs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_ref  UUID        NOT NULL REFERENCES public.agent_devices(id) ON DELETE CASCADE,
  agent       TEXT        NOT NULL,
  version     TEXT,
  path        TEXT,
  mtime       TIMESTAMPTZ,
  config      JSON        NOT NULL DEFAULT '{}'::json,
  sha256      TEXT,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (device_ref, agent)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_configs_agent_check') THEN
    ALTER TABLE public.agent_configs
      ADD CONSTRAINT agent_configs_agent_check CHECK (agent IN ('claude_code', 'opencode', 'codex_cli', 'gemini_cli'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS agent_configs_org ON public.agent_configs (org_id);
-- Set by the CLI after `config pull` changed the file while an agent process
-- that started BEFORE the change is still running ("Restart <agent> to apply").
-- Cleared by the next push once no such process is left.
ALTER TABLE public.agent_configs ADD COLUMN IF NOT EXISTS needs_restart_since TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.agent_config_history (
  id           BIGSERIAL   PRIMARY KEY,
  org_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_ref   UUID        NOT NULL REFERENCES public.agent_devices(id) ON DELETE CASCADE,
  agent        TEXT        NOT NULL,
  version      TEXT,
  sha256       TEXT,
  config       JSON        NOT NULL DEFAULT '{}'::json,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agent_config_history_dev ON public.agent_config_history (device_ref, agent, captured_at DESC);

CREATE TABLE IF NOT EXISTS public.agent_config_changes (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_ref          UUID        NOT NULL REFERENCES public.agent_devices(id) ON DELETE CASCADE,
  agent               TEXT        NOT NULL,
  patch               JSON        NOT NULL,
  reason              TEXT,
  requested_by        UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_by_email  TEXT,
  status              TEXT        NOT NULL DEFAULT 'pending',
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at          TIMESTAMPTZ
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_config_changes_status_check') THEN
    ALTER TABLE public.agent_config_changes
      ADD CONSTRAINT agent_config_changes_status_check CHECK (status IN ('pending', 'applied', 'failed', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_config_changes_agent_check') THEN
    ALTER TABLE public.agent_config_changes
      ADD CONSTRAINT agent_config_changes_agent_check CHECK (agent IN ('claude_code', 'opencode', 'codex_cli', 'gemini_cli'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS agent_config_changes_dev ON public.agent_config_changes (device_ref, status, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_config_changes_org ON public.agent_config_changes (org_id, created_at DESC);

-- ── Privileges: service role only ─────────────────────────────────────────────
ALTER TABLE public.agent_devices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_configs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_config_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_config_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_devices, public.agent_configs, public.agent_config_history, public.agent_config_changes
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.agent_devices, public.agent_configs, public.agent_config_history, public.agent_config_changes
  TO service_role;
DO $$ BEGIN
  REVOKE ALL ON SEQUENCE public.agent_config_history_id_seq FROM PUBLIC, anon, authenticated;
  GRANT USAGE, SELECT ON SEQUENCE public.agent_config_history_id_seq TO service_role;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ── agent_config_push: one atomic snapshot upload ────────────────────────────
-- p_agents: [{agent, version, path, mtime, config, sha256, needs_restart_since}, …] (already
-- validated + redacted by the API). Upserts the device, the latest snapshot per
-- agent, appends history only when the sha changed, and keeps the last 10
-- history rows and the last 50 finished change requests per device/agent.
-- Returns { device_ref, pending } — pending = open change requests.
CREATE OR REPLACE FUNCTION public.agent_config_push(
  p_org UUID, p_user UUID, p_device TEXT, p_hostname TEXT, p_os TEXT, p_cli TEXT, p_agents JSON
) RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_ref   UUID;
  a       JSON;
  v_agent TEXT;
  v_sha   TEXT;
  v_prev  TEXT;
  v_pending INTEGER;
BEGIN
  SELECT id INTO v_ref FROM agent_devices
   WHERE org_id = p_org AND user_id IS NOT DISTINCT FROM p_user AND device_id = p_device;
  IF v_ref IS NULL THEN
    INSERT INTO agent_devices (org_id, user_id, device_id, hostname, os, cli_version)
    VALUES (p_org, p_user, p_device, left(p_hostname, 255), left(p_os, 100), left(p_cli, 40))
    RETURNING id INTO v_ref;
  ELSE
    UPDATE agent_devices SET hostname = left(p_hostname, 255), os = left(p_os, 100),
           cli_version = left(p_cli, 40), last_synced_at = NOW()
     WHERE id = v_ref;
  END IF;

  FOR a IN SELECT * FROM json_array_elements(coalesce(p_agents, '[]'::json)) LOOP
    v_agent := a->>'agent';
    v_sha   := a->>'sha256';
    SELECT sha256 INTO v_prev FROM agent_configs WHERE device_ref = v_ref AND agent = v_agent;
    INSERT INTO agent_configs (org_id, device_ref, agent, version, path, mtime, config, sha256, synced_at, changed_at, needs_restart_since)
    VALUES (p_org, v_ref, v_agent, left(a->>'version', 80), left(a->>'path', 500),
            NULLIF(a->>'mtime', '')::timestamptz, coalesce(a->'config', '{}'::json), v_sha, NOW(), NOW(),
            NULLIF(a->>'needs_restart_since', '')::timestamptz)
    ON CONFLICT (device_ref, agent) DO UPDATE SET
      version = EXCLUDED.version, path = EXCLUDED.path, mtime = EXCLUDED.mtime,
      config = EXCLUDED.config, sha256 = EXCLUDED.sha256, synced_at = NOW(),
      needs_restart_since = EXCLUDED.needs_restart_since,
      changed_at = CASE WHEN agent_configs.sha256 IS DISTINCT FROM EXCLUDED.sha256 THEN NOW() ELSE agent_configs.changed_at END;
    IF v_prev IS DISTINCT FROM v_sha THEN
      INSERT INTO agent_config_history (org_id, device_ref, agent, version, sha256, config)
      VALUES (p_org, v_ref, v_agent, left(a->>'version', 80), v_sha, coalesce(a->'config', '{}'::json));
      DELETE FROM agent_config_history WHERE id IN (
        SELECT id FROM agent_config_history WHERE device_ref = v_ref AND agent = v_agent
         ORDER BY captured_at DESC, id DESC OFFSET 10);
    END IF;
    DELETE FROM agent_config_changes WHERE id IN (
      SELECT id FROM agent_config_changes WHERE device_ref = v_ref AND agent = v_agent AND status <> 'pending'
       ORDER BY created_at DESC OFFSET 50);
  END LOOP;

  SELECT count(*) INTO v_pending FROM agent_config_changes WHERE device_ref = v_ref AND status = 'pending';
  RETURN jsonb_build_object('device_ref', v_ref, 'pending', v_pending);
END $$;

REVOKE EXECUTE ON FUNCTION public.agent_config_push(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSON) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.agent_config_push(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSON) TO service_role;

-- >>>>>>>>>>>>>>>>>>>>>>>>  023_session_context.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- 023: session context and tool calls.
--
-- session_meta: where and how a session ran — working directory, git branch,
-- repo, host, agent + version, start / end time and how it ended. Filled by
-- the Claude Code SessionStart/SessionEnd hooks (POST /api/v1/sessions/meta),
-- the TokenFin OpenCode plugin, and resource attributes on OTLP logs. Every
-- write only fills blanks or widens the time range, so sources can arrive in
-- any order and replays are harmless (tf_session_meta_upsert).
--
-- session_tool_calls: one row per tool call (Claude Code / Cowork tool_result
-- events, OpenCode tool parts), keyed by a deterministic event_key so replays
-- never double count. Tool INPUTS are not stored — only name, MCP server,
-- success, duration and the permission decision.
--
-- Both are service-role only; purge_org_data (last set in 021) clears them.
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.session_meta (
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id    TEXT NOT NULL,
  agent         TEXT,
  agent_version TEXT,
  cwd           TEXT,
  git_branch    TEXT,
  repo          TEXT,
  hostname      TEXT,
  user_email    TEXT,
  start_source  TEXT,          -- startup | resume | clear | compact
  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  end_reason    TEXT,          -- clear | logout | prompt_input_exit | other
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, session_id)
);

CREATE TABLE IF NOT EXISTS public.session_tool_calls (
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_key   TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  prompt_id   TEXT,
  tool        TEXT NOT NULL,
  mcp_server  TEXT,
  success     BOOLEAN,
  duration_ms INTEGER,
  decision    TEXT,            -- accept | reject
  error       TEXT,
  at          TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (org_id, event_key)
);
CREATE INDEX IF NOT EXISTS session_tool_calls_session ON public.session_tool_calls (org_id, session_id, at);

ALTER TABLE public.session_meta       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_tool_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.session_meta, public.session_tool_calls FROM anon, authenticated;
GRANT  ALL ON public.session_meta, public.session_tool_calls TO service_role;

-- Fill blanks / widen the range; p_event 'end' also records how it ended.
CREATE OR REPLACE FUNCTION public.tf_session_meta_upsert(p_org UUID, p_session TEXT, p_event TEXT, p JSONB)
RETURNS VOID LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_at TIMESTAMPTZ := COALESCE(NULLIF(p->>'at', '')::timestamptz, now());
  t    TEXT[] := ARRAY['agent','agent_version','cwd','git_branch','repo','hostname','user_email','start_source'];
BEGIN
  IF p_org IS NULL OR COALESCE(p_session, '') = '' THEN RETURN; END IF;
  INSERT INTO session_meta AS m (org_id, session_id, agent, agent_version, cwd, git_branch, repo, hostname, user_email,
                                 start_source, started_at, ended_at, end_reason)
  VALUES (p_org, p_session,
          left(NULLIF(p->>'agent',''), 64), left(NULLIF(p->>'agent_version',''), 64), left(NULLIF(p->>'cwd',''), 1000),
          left(NULLIF(p->>'git_branch',''), 300), left(NULLIF(p->>'repo',''), 300), left(NULLIF(p->>'hostname',''), 255),
          left(NULLIF(lower(p->>'user_email'),''), 320), left(NULLIF(p->>'start_source',''), 32),
          CASE WHEN p_event IN ('start','seen') THEN v_at END,
          CASE WHEN p_event = 'end' THEN v_at END,
          CASE WHEN p_event = 'end' THEN left(NULLIF(p->>'end_reason',''), 64) END)
  ON CONFLICT (org_id, session_id) DO UPDATE SET
    agent         = COALESCE(m.agent, EXCLUDED.agent),
    agent_version = COALESCE(EXCLUDED.agent_version, m.agent_version),
    cwd           = COALESCE(m.cwd, EXCLUDED.cwd),
    git_branch    = COALESCE(EXCLUDED.git_branch, m.git_branch),
    repo          = COALESCE(m.repo, EXCLUDED.repo),
    hostname      = COALESCE(m.hostname, EXCLUDED.hostname),
    user_email    = COALESCE(m.user_email, EXCLUDED.user_email),
    start_source  = COALESCE(m.start_source, EXCLUDED.start_source),
    started_at    = LEAST(m.started_at, EXCLUDED.started_at),
    ended_at      = GREATEST(m.ended_at, EXCLUDED.ended_at),
    end_reason    = COALESCE(EXCLUDED.end_reason, m.end_reason),
    updated_at    = now();
END $$;

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
  -- Session names: all of them on a full wipe, otherwise the ones whose
  -- session has no events left (the rollup triggers already removed those).
  IF to_regclass('public.session_titles') IS NOT NULL THEN
    EXECUTE 'DELETE FROM session_titles t WHERE t.org_id = $1 AND ($2::timestamptz IS NULL OR NOT EXISTS (
               SELECT 1 FROM usage_sessions s WHERE s.org_id = t.org_id AND s.session_id = t.session_id))'
      USING p_org, p_before;
  END IF;
  -- Session context + tool calls (023).
  IF to_regclass('public.session_tool_calls') IS NOT NULL THEN
    EXECUTE 'DELETE FROM session_tool_calls WHERE org_id = $1 AND ($2::timestamptz IS NULL OR at < $2)' USING p_org, p_before;
  END IF;
  IF to_regclass('public.session_meta') IS NOT NULL THEN
    EXECUTE 'DELETE FROM session_meta m WHERE m.org_id = $1 AND ($2::timestamptz IS NULL OR NOT EXISTS (
               SELECT 1 FROM usage_sessions s WHERE s.org_id = m.org_id AND s.session_id = m.session_id))'
      USING p_org, p_before;
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

REVOKE EXECUTE ON FUNCTION public.tf_session_meta_upsert(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tf_session_meta_upsert(UUID, TEXT, TEXT, JSONB) TO service_role;
REVOKE EXECUTE ON FUNCTION public.purge_org_data(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_org_data(UUID, TIMESTAMPTZ) TO service_role;

-- >>>>>>>>>>>>>>>>>>>>>>>>  024_model_limits.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- 024: per-model limits, 90% notifications, optional automatic model switching.
--
-- Design: `limits.model` is a FILTER (a model id or prefix, case-insensitive,
-- null = every model) that combines with the existing scopes
-- (org / project / team / member) instead of a separate scope='model'. So
-- "claude-opus for team Platform" and "claude-opus for the whole org" are the
-- same kind of row, evaluated by the same code (lib/alerts/model-limits.ts).
--
--   limits.metric           cost_usd | tokens | requests   (existing column)
--   limits.value            the limit amount in `metric` units (existing column,
--                           widened). New-style limits always set it.
--   limits.budget_usd       legacy whole-scope dollar budget. Kept > 0 ONLY for
--                           model-less cost_usd limits; 0 otherwise, so the legacy
--                           ingest spend gate (monthly org budget_usd → throttle /
--                           block) and the legacy alert engine never read a
--                           per-model or token/request limit as a dollar budget.
--   limits.user_id          member-scoped limits: whose usage (was missing, so
--                           member limits could never be measured)
--   limits.basis            all | metered | notional
--   limits.notify_at        % that sends the one-per-period notification (null = off)
--   limits.notify_channels  {"inapp":bool,"email":bool}
--   limits.auto_action      none | switch_model | block_sdk (default none)
--   limits.switch_to        target model for switch_model
--   limits.auto_action_at   % that triggers the action (default 100)
--
--   limit_events            one row per (limit, period, level) — the claim that
--                           makes each threshold fire once per period
--   model_routes            + match (exact|prefix), origin (manual|auto), limit_id,
--                           reason, activated_at, created_by, deactivated_at
--   model_blocks            models an SDK with enforcePolicy must refuse (block_sdk)
--   policy_fetches          per-key SDK policy fetch counter ("picked up?")
--   limit_usage_rows()      usage_daily grouped for limit evaluation (one JSON value,
--                           so PostgREST's row cap never truncates it)
--
-- RLS: limit_events / model_blocks readable by org members (like limits and
-- model_routes); every write goes through the service role. policy_fetches is
-- service-role only. Idempotent; safe to re-run.

-- ── limits ────────────────────────────────────────────────────────────────────
ALTER TABLE public.limits ADD COLUMN IF NOT EXISTS model           TEXT;
ALTER TABLE public.limits ADD COLUMN IF NOT EXISTS user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.limits ADD COLUMN IF NOT EXISTS basis           TEXT NOT NULL DEFAULT 'all';
ALTER TABLE public.limits ADD COLUMN IF NOT EXISTS notify_at       INT DEFAULT 90;
ALTER TABLE public.limits ADD COLUMN IF NOT EXISTS notify_channels JSONB NOT NULL DEFAULT '{"inapp": true, "email": true}'::jsonb;
ALTER TABLE public.limits ADD COLUMN IF NOT EXISTS auto_action     TEXT NOT NULL DEFAULT 'none';
ALTER TABLE public.limits ADD COLUMN IF NOT EXISTS switch_to       TEXT;
ALTER TABLE public.limits ADD COLUMN IF NOT EXISTS auto_action_at  INT NOT NULL DEFAULT 100;
ALTER TABLE public.limits ADD COLUMN IF NOT EXISTS created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL;
-- token limits can exceed NUMERIC(14,4) (10^10); widening is a no-op on re-run
ALTER TABLE public.limits ALTER COLUMN value TYPE NUMERIC;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'limits_basis_check') THEN
    ALTER TABLE public.limits ADD CONSTRAINT limits_basis_check CHECK (basis IN ('all', 'metered', 'notional'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'limits_auto_action_check') THEN
    ALTER TABLE public.limits ADD CONSTRAINT limits_auto_action_check CHECK (auto_action IN ('none', 'switch_model', 'block_sdk'));
  END IF;
  -- NOT VALID: enforced for new/updated rows without failing on odd legacy rows.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'limits_metric_check') THEN
    ALTER TABLE public.limits ADD CONSTRAINT limits_metric_check CHECK (metric IN ('cost_usd', 'tokens', 'requests')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'limits_pct_check') THEN
    ALTER TABLE public.limits ADD CONSTRAINT limits_pct_check CHECK (
      (notify_at IS NULL OR notify_at BETWEEN 1 AND 1000) AND auto_action_at BETWEEN 1 AND 1000) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'limits_action_check') THEN
    ALTER TABLE public.limits ADD CONSTRAINT limits_action_check CHECK (
      auto_action = 'none'
      OR (model IS NOT NULL AND (auto_action <> 'switch_model' OR (switch_to IS NOT NULL AND lower(switch_to) <> lower(model))))) NOT VALID;
  END IF;
  -- The legacy spend gate reads budget_usd of monthly org limits as a dollar
  -- budget for ALL metered spend. A per-model / token / request limit must
  -- never look like one.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'limits_legacy_budget_check') THEN
    ALTER TABLE public.limits ADD CONSTRAINT limits_legacy_budget_check CHECK (
      (model IS NULL AND metric = 'cost_usd') OR budget_usd = 0) NOT VALID;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS limits_org_active ON public.limits (org_id) WHERE is_active;

-- ── limit_events ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.limit_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL,   -- no FK: see "PostgREST embeds" below
  limit_id    UUID        NOT NULL REFERENCES public.limits(id) ON DELETE CASCADE,
  period_key  TEXT        NOT NULL,
  level       TEXT        NOT NULL,
  fired_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  details     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (limit_id, period_key, level)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'limit_events_level_check') THEN
    ALTER TABLE public.limit_events ADD CONSTRAINT limit_events_level_check CHECK (level IN ('notify', 'action'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS limit_events_org ON public.limit_events (org_id, fired_at DESC);

-- ── model_routes: why a route exists ─────────────────────────────────────────
ALTER TABLE public.model_routes ADD COLUMN IF NOT EXISTS match          TEXT NOT NULL DEFAULT 'exact';
ALTER TABLE public.model_routes ADD COLUMN IF NOT EXISTS origin         TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE public.model_routes ADD COLUMN IF NOT EXISTS limit_id       UUID;   -- no FK: see below
ALTER TABLE public.model_routes ADD COLUMN IF NOT EXISTS reason         TEXT;
ALTER TABLE public.model_routes ADD COLUMN IF NOT EXISTS activated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.model_routes ADD COLUMN IF NOT EXISTS created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.model_routes ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'model_routes_match_check') THEN
    ALTER TABLE public.model_routes ADD CONSTRAINT model_routes_match_check CHECK (match IN ('exact', 'prefix'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'model_routes_origin_check') THEN
    ALTER TABLE public.model_routes ADD CONSTRAINT model_routes_origin_check CHECK (origin IN ('manual', 'auto'));
  END IF;
END $$;

-- ── model_blocks ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.model_blocks (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  model          TEXT        NOT NULL,           -- id or prefix (prefix match)
  limit_id       UUID,                        -- no FK: see below
  reason         TEXT,
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deactivated_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_model_blocks_active ON public.model_blocks (org_id, lower(model)) WHERE is_active;

-- ── policy_fetches ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.policy_fetches (
  org_id           UUID        NOT NULL,   -- no FK: see below
  key_id           UUID        NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  fetch_count      BIGINT      NOT NULL DEFAULT 0,
  first_fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_version     TEXT,
  user_agent       TEXT,
  PRIMARY KEY (org_id, key_id)
);

CREATE OR REPLACE FUNCTION public.policy_fetch_touch(p_org UUID, p_key UUID, p_version TEXT, p_ua TEXT)
RETURNS VOID LANGUAGE sql SET search_path = public, pg_temp AS $$
  INSERT INTO policy_fetches (org_id, key_id, fetch_count, last_version, user_agent)
  VALUES (p_org, p_key, 1, left(p_version, 64), left(p_ua, 200))
  ON CONFLICT (org_id, key_id) DO UPDATE SET
    fetch_count = policy_fetches.fetch_count + 1, last_fetched_at = NOW(),
    last_version = EXCLUDED.last_version, user_agent = EXCLUDED.user_agent;
$$;

-- ── limit_usage_rows ──────────────────────────────────────────────────────────
-- usage_daily since p_from (org-local day labels), grouped by the dimensions a
-- limit can filter on. p_prefixes (lower-case) narrows to matching models when
-- every limit being evaluated has a model; null = all models.
CREATE OR REPLACE FUNCTION public.limit_usage_rows(p_org UUID, p_from DATE, p_prefixes TEXT[] DEFAULT NULL)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'day', day, 'model', model, 'project_id', project_id, 'user_key', user_key,
           'cost_basis', cost_basis, 'requests', requests, 'total_tokens', total_tokens, 'cost_usd', cost_usd)), '[]'::jsonb)
  FROM (
    SELECT day, model, project_id, user_key, cost_basis,
           SUM(requests) AS requests, SUM(total_tokens) AS total_tokens, SUM(cost_usd) AS cost_usd
    FROM usage_daily
    WHERE org_id = p_org AND day >= p_from
      AND (p_prefixes IS NULL OR EXISTS (
            SELECT 1 FROM unnest(p_prefixes) px
             WHERE strpos(lower(model), px) > 0))   -- coarse filter; exact prefix rules run in lib/alerts
    GROUP BY 1, 2, 3, 4, 5
  ) g;
$$;

-- ── PostgREST embeds ─────────────────────────────────────────────────────────
-- A table with FKs to TWO of organizations / limits / api_keys is a junction
-- to PostgREST, which makes existing embeds such as api_keys → organizations
-- ambiguous (PGRST201) and breaks every key lookup. So each new table keeps
-- at most one of those FKs; the org / limit ids above are plain columns
-- (limit_events rows go with their limit; the others are purged with the org
-- by the ON DELETE CASCADE they keep, or are harmless history).
ALTER TABLE public.limit_events   DROP CONSTRAINT IF EXISTS limit_events_org_id_fkey;
ALTER TABLE public.model_routes   DROP CONSTRAINT IF EXISTS model_routes_limit_id_fkey;
ALTER TABLE public.model_blocks   DROP CONSTRAINT IF EXISTS model_blocks_limit_id_fkey;
ALTER TABLE public.policy_fetches DROP CONSTRAINT IF EXISTS policy_fetches_org_id_fkey;

-- ── RLS + privileges ─────────────────────────────────────────────────────────
ALTER TABLE public.limit_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_blocks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_fetches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS limit_events_select ON public.limit_events;
CREATE POLICY limit_events_select ON public.limit_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.members m WHERE m.org_id = limit_events.org_id AND m.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS model_blocks_select ON public.model_blocks;
CREATE POLICY model_blocks_select ON public.model_blocks FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.members m WHERE m.org_id = model_blocks.org_id AND m.user_id = (SELECT auth.uid())));

REVOKE ALL ON public.policy_fetches FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.limit_events, public.model_blocks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.limit_events, public.model_blocks TO authenticated;
GRANT ALL ON public.limit_events, public.model_blocks, public.policy_fetches TO service_role;

REVOKE EXECUTE ON FUNCTION public.policy_fetch_touch(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.policy_fetch_touch(UUID, UUID, TEXT, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.limit_usage_rows(UUID, DATE, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.limit_usage_rows(UUID, DATE, TEXT[]) TO service_role;

-- >>>>>>>>>>>>>>>>>>>>>>>>  025_trace_capture.sql  >>>>>>>>>>>>>>>>>>>>>>>>
-- 025: trace capture level.
--
-- organizations.trace_capture:
--   'errors' (default) — keep full span detail only for traces that contain an
--                        error or warning; for every other trace keep a cost-only
--                        skeleton of its token-bearing spans (no attributes, no
--                        content) so cost tracking and leaf detection stay exact.
--   'all'              — keep every span in full (opt-in, Settings → Workspace).
-- spans.detail / traces.detail say whether full detail was kept; the Traces page
-- lists only detailed traces. tf_mark_trace_detail() refreshes traces.detail
-- after refresh_traces. Idempotent.

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS trace_capture TEXT NOT NULL DEFAULT 'errors';
DO $$ BEGIN
  ALTER TABLE public.organizations ADD CONSTRAINT organizations_trace_capture_chk CHECK (trace_capture IN ('errors', 'all'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.spans  ADD COLUMN IF NOT EXISTS detail BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.traces ADD COLUMN IF NOT EXISTS detail BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_traces_org_detail_start ON public.traces (org_id, start_time DESC, trace_id DESC) WHERE detail;

CREATE OR REPLACE FUNCTION public.tf_mark_trace_detail(p_org UUID, p_trace_ids TEXT[])
RETURNS VOID LANGUAGE sql SET search_path = public, pg_temp AS $$
  UPDATE traces t
     SET detail = EXISTS (SELECT 1 FROM spans s WHERE s.org_id = t.org_id AND s.trace_id = t.trace_id AND s.detail)
   WHERE t.org_id = p_org AND t.trace_id = ANY (p_trace_ids)
$$;

REVOKE EXECUTE ON FUNCTION public.tf_mark_trace_detail(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tf_mark_trace_detail(UUID, TEXT[]) TO service_role;

COMMIT;
