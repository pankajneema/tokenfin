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
