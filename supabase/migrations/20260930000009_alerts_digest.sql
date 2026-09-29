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
