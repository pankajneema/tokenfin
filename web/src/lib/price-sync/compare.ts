/**
 * Price catalog sync — pure comparison of TokenFin's pricing table
 * (lib/mcp/pricing.ts, via priceFor) against LiteLLM's public
 * model_prices_and_context_window.json. All prices are USD per 1M tokens.
 */
import type { Price } from '@/lib/mcp/pricing'

export const LITELLM_PRICES_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

/** Providers whose LiteLLM entries map 1:1 to the model ids TokenFin sees. */
const PROVIDERS = new Set(['anthropic', 'openai', 'gemini'])

export interface UpstreamPrice {
  in: number; out: number; cacheRead: number | null; cacheWrite: number | null; provider: string
}

type LiteEntry = {
  litellm_provider?: string; mode?: string
  input_cost_per_token?: number; output_cost_per_token?: number
  cache_read_input_token_cost?: number; cache_creation_input_token_cost?: number
}

const perM = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6 * 1e6) / 1e6 : null)

/** Parse LiteLLM's JSON into model → per-1M prices (chat/completion models of known providers). */
export function parseLiteLLM(json: unknown): Map<string, UpstreamPrice> {
  const out = new Map<string, UpstreamPrice>()
  if (!json || typeof json !== 'object') return out
  for (const [rawKey, v] of Object.entries(json as Record<string, LiteEntry>)) {
    if (rawKey === 'sample_spec' || !v || typeof v !== 'object') continue
    const provider = String(v.litellm_provider ?? '')
    if (!PROVIDERS.has(provider)) continue
    if (v.mode && !['chat', 'completion', 'responses'].includes(v.mode)) continue
    const inp = perM(v.input_cost_per_token)
    const outp = perM(v.output_cost_per_token)
    if (inp == null || outp == null) continue
    // "gemini/gemini-2.5-pro" → "gemini-2.5-pro"; leave other slash ids (fine-tunes, regions) out.
    let key = rawKey.toLowerCase()
    if (key.startsWith(provider + '/')) key = key.slice(provider.length + 1)
    if (key.includes('/') || key.startsWith('ft:')) continue
    out.set(key, { in: inp, out: outp, cacheRead: perM(v.cache_read_input_token_cost), cacheWrite: perM(v.cache_creation_input_token_cost), provider })
  }
  return out
}

export interface OurPrice { in: number; out: number; cacheRead: number; cacheWrite: number }

export function effective(p: Price): OurPrice {
  return { in: p.in, out: p.out, cacheRead: p.cacheRead ?? p.in * 0.1, cacheWrite: p.cacheWrite ?? p.in * 1.25 }
}

const differs = (a: number, b: number) => Math.abs(a - b) > Math.max(1e-6, 0.01 * Math.max(Math.abs(a), Math.abs(b)))

export interface PriceMismatch {
  model: string
  fields: ('in' | 'out' | 'cacheRead' | 'cacheWrite')[]
  ours: OurPrice
  theirs: UpstreamPrice
}

/**
 * For every upstream model TokenFin prices (priceFor(...).known), list fields
 * that differ by more than 1%. Cache fields are compared only when upstream
 * publishes them.
 */
export function comparePrices(
  upstream: Map<string, UpstreamPrice>,
  priceFor: (model: string) => Price & { known: boolean },
  only?: Set<string>,
): PriceMismatch[] {
  const out: PriceMismatch[] = []
  for (const [model, theirs] of Array.from(upstream.entries())) {
    if (only && !only.has(model)) continue
    const p = priceFor(model)
    if (!p.known) continue
    const ours = effective(p)
    const fields: PriceMismatch['fields'] = []
    if (differs(ours.in, theirs.in)) fields.push('in')
    if (differs(ours.out, theirs.out)) fields.push('out')
    if (theirs.cacheRead != null && differs(ours.cacheRead, theirs.cacheRead)) fields.push('cacheRead')
    if (theirs.cacheWrite != null && differs(ours.cacheWrite, theirs.cacheWrite)) fields.push('cacheWrite')
    if (fields.length) out.push({ model, fields, ours, theirs })
  }
  return out.sort((a, b) => a.model.localeCompare(b.model))
}

/** Upstream price for a model id, trying exact then longest-prefix of upstream keys. */
export function lookupUpstream(upstream: Map<string, UpstreamPrice>, model: string): { key: string; price: UpstreamPrice } | null {
  const m = model.toLowerCase()
  const exact = upstream.get(m)
  if (exact) return { key: m, price: exact }
  let best: string | null = null
  for (const k of Array.from(upstream.keys())) if (m.startsWith(k) && (!best || k.length > best.length)) best = k
  return best ? { key: best, price: upstream.get(best)! } : null
}
