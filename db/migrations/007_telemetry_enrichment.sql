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
