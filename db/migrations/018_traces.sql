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
