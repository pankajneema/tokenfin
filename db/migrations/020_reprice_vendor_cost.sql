-- 020: re-price past Claude Code / Cowork rows at the cost the client reported.
--
-- Claude Code and Cowork report each call's exact cost_usd (kept as
-- vendor_cost_usd). TokenFin used to price those rows itself, assuming every
-- cache write was a 5-minute write (1.25x input); Claude Code mostly writes the
-- 1-hour cache (2x input), so past rows were under-priced. New rows already use
-- the reported figure (lib/otlp/normalize.ts). This applies the same rule to
-- history: only those two sources, only a plausible figure (within 10x of the
-- stored price), and never for orgs with custom model prices (their override
-- stays authoritative). The usage_events UPDATE trigger keeps the rollups in
-- step. These rows are notional, so usage_agg (metered only) is unaffected.
-- Idempotent: a second run matches nothing.

UPDATE public.usage_events e
   SET cost_usd = e.vendor_cost_usd
 WHERE e.source IN ('claude_code', 'cowork')
   AND e.vendor_cost_usd > 0
   AND e.cost_usd > 0
   AND e.cost_usd IS DISTINCT FROM e.vendor_cost_usd
   AND e.vendor_cost_usd BETWEEN e.cost_usd / 10 AND e.cost_usd * 10
   AND NOT EXISTS (SELECT 1 FROM public.org_model_prices p WHERE p.org_id = e.org_id);
