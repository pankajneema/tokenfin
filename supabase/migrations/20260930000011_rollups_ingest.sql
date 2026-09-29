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
