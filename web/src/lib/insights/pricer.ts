/**
 * Token-accurate pricing for insights / what-if: org overrides (org_model_prices)
 * first, else the list price in lib/mcp/pricing.ts. Pure + client-safe.
 */
import { priceFor, type Price } from '@/lib/mcp/pricing'
import { matchOverride, priceWithOverrides, type OrgModelPrice } from '@/lib/pricing-overrides'

export interface TokenMix {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
}

export interface Pricer {
  /** effective per-1M prices (cache rates filled with the list defaults) */
  price(model: string): Required<Price>
  cost(model: string, t: TokenMix): number
}

export function makePricer(overrides: readonly OrgModelPrice[] = []): Pricer {
  const list = [...overrides]
  return {
    price(model) {
      const o = matchOverride(list, model)
      const p: Price = o
        ? { in: o.input_per_m, out: o.output_per_m, cacheRead: o.cache_read_per_m ?? undefined, cacheWrite: o.cache_write_per_m ?? undefined }
        : priceFor(model)
      return { in: p.in, out: p.out, cacheRead: p.cacheRead ?? p.in * 0.1, cacheWrite: p.cacheWrite ?? p.in * 1.25 }
    },
    cost(model, t) {
      return priceWithOverrides(list, model, {
        input: Math.max(0, t.input_tokens), output: Math.max(0, t.output_tokens),
        cacheRead: Math.max(0, t.cache_read_tokens), cacheWrite: Math.max(0, t.cache_write_tokens),
      }).cost
    },
  }
}

/** Opus/Fable/Mythos-class models: output list price ≥ $20 per 1M tokens. */
export const EXPENSIVE_OUTPUT_PER_M = 20

/**
 * The next-cheaper tier we suggest for short, low-output calls, or null when we
 * have no confident suggestion (unknown family, already cheap).
 */
export function cheaperTier(model: string): string | null {
  const m = (model ?? '').toLowerCase()
  if (/^claude-(opus|fable|mythos)/.test(m)) return 'claude-sonnet-5'
  if (/^claude-sonnet/.test(m)) return 'claude-haiku-4-5'
  if (/^gpt-5(\.\d+)?-pro|^gpt-5\.6-sol|^gpt-5\.5$|^gpt-5\.5-|^gpt-4-turbo/.test(m)) return 'gpt-5.4-mini'
  if (/^gemini-[\d.]+-pro/.test(m)) return 'gemini-3.5-flash'
  if (/^o3(?!-mini)/.test(m)) return 'o4-mini'
  return null
}

export function isExpensive(p: Price): boolean {
  return p.out >= EXPENSIVE_OUTPUT_PER_M
}
