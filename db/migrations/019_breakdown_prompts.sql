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
