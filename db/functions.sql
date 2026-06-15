-- TokenFin SQL Functions
-- Run AFTER schema.sql

-- ── Aggregate upsert (called fire-and-forget from ingest) ────
CREATE OR REPLACE FUNCTION upsert_usage_agg(
  p_bucket     TIMESTAMPTZ,
  p_project_id UUID,
  p_org_id     UUID,
  p_model      TEXT,
  p_tokens     BIGINT,
  p_cost       NUMERIC,
  p_requests   INT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO usage_agg (bucket, project_id, org_id, model, total_tokens, cost_usd, request_count)
  VALUES (p_bucket, p_project_id, p_org_id, p_model, p_tokens, p_cost, p_requests)
  ON CONFLICT (bucket, project_id, model) DO UPDATE SET
    total_tokens  = usage_agg.total_tokens  + EXCLUDED.total_tokens,
    cost_usd      = usage_agg.cost_usd      + EXCLUDED.cost_usd,
    request_count = usage_agg.request_count + EXCLUDED.request_count;
END;
$$;

-- ── Cost summary for a project ───────────────────────────────
CREATE OR REPLACE FUNCTION project_cost_summary(
  p_project_id UUID,
  p_since      TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days'
)
RETURNS TABLE (
  model         TEXT,
  total_tokens  BIGINT,
  cost_usd      NUMERIC,
  request_count BIGINT
) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT model,
         SUM(total_tokens)::BIGINT as total_tokens,
         SUM(cost_usd) as cost_usd,
         COUNT(*) as request_count
  FROM usage_events
  WHERE project_id = p_project_id AND created_at >= p_since
  GROUP BY model
  ORDER BY SUM(cost_usd) DESC;
$$;

-- ── Check if project is over limit ───────────────────────────
CREATE OR REPLACE FUNCTION check_project_limit(p_project_id UUID)
RETURNS TABLE (
  scope      TEXT,
  budget_usd NUMERIC,
  spent_usd  NUMERIC,
  pct_used   INT,
  status     TEXT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_limit limits%ROWTYPE;
  v_spent NUMERIC;
  v_pct   INT;
BEGIN
  FOR v_limit IN
    SELECT * FROM limits WHERE project_id = p_project_id AND is_active = true
  LOOP
    SELECT COALESCE(SUM(cost_usd), 0) INTO v_spent
    FROM usage_events
    WHERE project_id = p_project_id
      AND created_at >= (
        CASE v_limit.period
          WHEN 'daily'   THEN date_trunc('day', NOW())
          WHEN 'weekly'  THEN date_trunc('week', NOW())
          WHEN 'monthly' THEN date_trunc('month', NOW())
        END
      );

    v_pct := LEAST(ROUND((v_spent / v_limit.budget_usd) * 100)::INT, 100);

    RETURN QUERY SELECT
      v_limit.scope,
      v_limit.budget_usd,
      v_spent,
      v_pct,
      CASE
        WHEN v_pct >= v_limit.block_at    THEN 'blocked'
        WHEN v_pct >= v_limit.throttle_at THEN 'throttled'
        WHEN v_pct >= v_limit.warn_at     THEN 'warning'
        ELSE 'ok'
      END;
  END LOOP;
END;
$$;
