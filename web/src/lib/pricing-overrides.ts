/**
 * Per-org custom model prices (org_model_prices, migration 007).
 *
 * Server-side list pricing (lib/mcp/pricing.ts) stays the default for every
 * cost TokenFin computes. When an org has negotiated / private pricing it can
 * register an override per model PREFIX; the longest matching prefix wins
 * (same rule as the default table), so `claude-opus` and `claude-opus-4-8`
 * can coexist.
 *
 * Reads are cached per process for 60s — the OTLP receivers price every row,
 * and prices change rarely. The models API calls invalidateOrgPrices() on write
 * so the admin's own process sees the change immediately.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { costFromPrice, priceFor, type Price } from '@/lib/mcp/pricing'
import { TtlCache } from '@/lib/cache'

export interface OrgModelPrice {
  model_prefix: string
  input_per_m: number
  output_per_m: number
  cache_read_per_m: number | null
  cache_write_per_m: number | null
}

/** Token counts exactly as they should be billed (already de-duplicated). */
export interface BillableTokens { input: number; output: number; cacheRead: number; cacheWrite: number }

export interface PricedCost {
  cost: number
  /** false only when neither an override nor the default table knew the model ($2/$8 fallback). */
  priceKnown: boolean
  /** the override prefix that priced this row, if any */
  overridePrefix: string | null
}

const priceCache = new TtlCache<string, OrgModelPrice[]>(5_000, 60_000)

export function invalidateOrgPrices(orgId?: string): void {
  if (orgId) priceCache.delete(orgId)
  else priceCache.clear()
}

export async function getOrgPrices(admin: SupabaseClient, orgId: string): Promise<OrgModelPrice[]> {
  // Concurrent requests for the same org share one query.
  return priceCache.getOrLoad(orgId, async () => {
    const { data, error } = await admin.from('org_model_prices')
      .select('model_prefix, input_per_m, output_per_m, cache_read_per_m, cache_write_per_m')
      .eq('org_id', orgId)
    // Table missing (migration 007 not applied) or transient error → no
    // overrides, never block ingest. The empty result is cached too, so we
    // don't hammer the DB.
    if (error) console.warn('[pricing-overrides] lookup failed, using list prices:', error.message)
    return error ? [] : (data ?? []).map((r: any) => ({
      model_prefix: String(r.model_prefix),
      input_per_m: Number(r.input_per_m),
      output_per_m: Number(r.output_per_m),
      cache_read_per_m: r.cache_read_per_m == null ? null : Number(r.cache_read_per_m),
      cache_write_per_m: r.cache_write_per_m == null ? null : Number(r.cache_write_per_m),
    }))
  })
}

/** Longest case-insensitive prefix match, or null. */
export function matchOverride(prices: OrgModelPrice[], model: string): OrgModelPrice | null {
  const m = (model ?? '').toLowerCase()
  let best: OrgModelPrice | null = null
  for (const p of prices) {
    const pre = p.model_prefix.toLowerCase()
    if (pre && m.startsWith(pre) && (!best || pre.length > best.model_prefix.length)) best = p
  }
  return best
}

const toPrice = (o: OrgModelPrice): Price => ({
  in: o.input_per_m, out: o.output_per_m,
  cacheRead: o.cache_read_per_m ?? undefined,
  cacheWrite: o.cache_write_per_m ?? undefined,
})

/** Price billable tokens: org override (if any) else the default list price. */
export function priceWithOverrides(prices: OrgModelPrice[], model: string, t: BillableTokens): PricedCost {
  const o = matchOverride(prices, model)
  if (o) {
    return { cost: costFromPrice(toPrice(o), t.input, t.output, t.cacheRead, t.cacheWrite), priceKnown: true, overridePrefix: o.model_prefix }
  }
  const p = priceFor(model)
  return { cost: costFromPrice(p, t.input, t.output, t.cacheRead, t.cacheWrite), priceKnown: p.known, overridePrefix: null }
}
