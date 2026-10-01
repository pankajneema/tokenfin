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
