-- Keep explicitly captured prompts available for historical analysis.
-- No rows are deleted by this migration.
ALTER TABLE prompt_captures
  ALTER COLUMN expires_at SET DEFAULT NOW() + INTERVAL '3650 days';
