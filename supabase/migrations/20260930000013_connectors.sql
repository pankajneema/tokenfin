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
