-- One-time data repair: reprice Claude Code usage rows at Anthropic list prices.
--
-- Recomputes usage_events.cost_usd and total_tokens for source = 'claude_code'
-- from the stored token counts. Idempotent: only rows whose cost or total
-- differ from the recomputed values are touched, so a second run updates 0 rows.
-- usage_agg is not touched: Claude Code rows are notional (cost_basis) and never
-- roll into usage_agg.
--
-- HOW TO RUN (production):
--   1. psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/scripts/reprice_claude_code.sql
--      — or paste into the SQL editor.
--   2. Read the PREVIEW output (per-model row counts, old vs new totals, and
--      rows whose model matched no price → left unchanged).
--   3. The script ends with COMMIT. To dry-run instead, change the final
--      COMMIT to ROLLBACK (the UPDATE count and the post-update check still print).
--
-- Prices, USD per 1M tokens. Model match = longest prefix of lower(model).
-- cache read = 0.1 x input unless an absolute rate is given; cache write = 1.25 x input.
-- total_tokens = input + output + cache_read + cache_write (Anthropic reports
-- cache tokens outside input_tokens).

BEGIN;

CREATE TEMP TABLE reprice_prices (
  prefix      text PRIMARY KEY,
  in_per_m    numeric NOT NULL,
  out_per_m   numeric NOT NULL,
  cread_per_m numeric NOT NULL,
  cwrite_per_m numeric NOT NULL
) ON COMMIT DROP;

INSERT INTO reprice_prices (prefix, in_per_m, out_per_m, cread_per_m, cwrite_per_m)
SELECT prefix, i, o, COALESCE(cr, i * 0.1), i * 1.25
FROM (VALUES
  ('claude-opus-4-8',   5::numeric,  25::numeric, NULL::numeric),
  ('claude-opus-4-7',   5,  25, NULL),
  ('claude-opus-4-6',   5,  25, NULL),
  ('claude-opus-5',     5,  25, NULL),
  ('claude-opus-5-5',   4,  20, 0.20),
  ('claude-fable-5',   10,  50, NULL),
  ('claude-fable-5-1', 10,  50, 0.25),
  ('claude-sonnet-5',   2,  10, NULL),
  ('claude-sonnet-4-6', 3,  15, NULL),
  ('claude-haiku-4-5',  1,   5, NULL)
) AS v(prefix, i, o, cr);

CREATE TEMP TABLE reprice_calc ON COMMIT DROP AS
SELECT e.id,
       e.model,
       e.cost_usd     AS old_cost,
       e.total_tokens AS old_total,
       p.prefix,
       CASE WHEN p.prefix IS NULL THEN e.cost_usd ELSE round(
         (  e.input_tokens       * p.in_per_m
          + e.output_tokens      * p.out_per_m
          + e.cache_read_tokens  * p.cread_per_m
          + e.cache_write_tokens * p.cwrite_per_m) / 1e6, 8) END AS new_cost,
       CASE WHEN p.prefix IS NULL THEN e.total_tokens ELSE
         e.input_tokens + e.output_tokens + e.cache_read_tokens + e.cache_write_tokens END AS new_total
FROM usage_events e
LEFT JOIN LATERAL (
  SELECT rp.* FROM reprice_prices rp
  WHERE lower(e.model) LIKE rp.prefix || '%'
  ORDER BY length(rp.prefix) DESC
  LIMIT 1
) p ON true
WHERE e.source = 'claude_code';

-- ── PREVIEW ─────────────────────────────────────────────────────────────────
-- == PREVIEW: per matched price prefix (NULL prefix = unknown model, left unchanged)
SELECT prefix,
       count(*)                                                           AS rows,
       count(*) FILTER (WHERE old_cost IS DISTINCT FROM new_cost
                           OR old_total IS DISTINCT FROM new_total)       AS rows_to_update,
       sum(old_cost)                                                      AS old_cost_usd,
       sum(new_cost)                                                      AS new_cost_usd,
       sum(old_total)                                                     AS old_total_tokens,
       sum(new_total)                                                     AS new_total_tokens
FROM reprice_calc
GROUP BY prefix
ORDER BY prefix NULLS LAST;

-- == PREVIEW: unmatched models
SELECT model, count(*) FROM reprice_calc WHERE prefix IS NULL GROUP BY model ORDER BY 2 DESC;

-- ── UPDATE ──────────────────────────────────────────────────────────────────
UPDATE usage_events e
   SET cost_usd = c.new_cost,
       total_tokens = c.new_total
  FROM reprice_calc c
 WHERE e.id = c.id
   AND c.prefix IS NOT NULL
   AND (e.cost_usd IS DISTINCT FROM c.new_cost OR e.total_tokens IS DISTINCT FROM c.new_total);

-- == CHECK: rows still differing (expect 0)
SELECT count(*) AS still_differing
FROM usage_events e JOIN reprice_calc c ON c.id = e.id
WHERE c.prefix IS NOT NULL
  AND (e.cost_usd IS DISTINCT FROM c.new_cost OR e.total_tokens IS DISTINCT FROM c.new_total);

COMMIT;
