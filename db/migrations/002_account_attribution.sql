-- TokenFin additive migration 002
-- Durable external-account/tool attribution and prompt analytics dimensions.
-- Safe to re-run; no usage history is deleted or rewritten.

ALTER TABLE usage_events
  ADD COLUMN IF NOT EXISTS actor_id       TEXT,
  ADD COLUMN IF NOT EXISTS actor_name     TEXT,
  ADD COLUMN IF NOT EXISTS tool_name      TEXT,
  ADD COLUMN IF NOT EXISTS provider       TEXT,
  ADD COLUMN IF NOT EXISTS prompt_hash    TEXT,
  ADD COLUMN IF NOT EXISTS prompt_preview TEXT,
  ADD COLUMN IF NOT EXISTS prompt_chars   INT,
  ADD COLUMN IF NOT EXISTS request_idempotency_key TEXT;

CREATE INDEX IF NOT EXISTS usage_events_org_actor_created
  ON usage_events(org_id, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_org_tool_created
  ON usage_events(org_id, tool_name, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_org_provider_created
  ON usage_events(org_id, provider, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_org_prompt_hash
  ON usage_events(org_id, prompt_hash)
  WHERE prompt_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS usage_events_org_idempotency_uq
  ON usage_events(org_id, request_idempotency_key)
  WHERE request_idempotency_key IS NOT NULL;
