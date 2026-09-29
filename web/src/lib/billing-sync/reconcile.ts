/**
 * Reconciliation math — provider-reported cost vs TokenFin metered cost, per
 * UTC day and provider. Pure (no I/O) so it is unit-tested directly.
 */
import type { BillingProvider } from './types'

export const VARIANCE_FLAG_PCT = 10

/** Provider that bills a usage_events row directly, or null (notional or billed elsewhere). Mirrors SQL reconciliation_metered_daily. */
export function billingProviderFor(model: string, provider?: string | null, costBasis?: string | null): BillingProvider | null {
  if (costBasis === 'notional') return null
  const p = (provider ?? '').toLowerCase()
  if (p === 'anthropic' || p === 'openai') return p
  if (p) return null
  const m = model.toLowerCase().replace(/^(anthropic|openai)\//, '')
  if (m.startsWith('claude')) return 'anthropic'
  if (/^(gpt|o1|o3|o4|chatgpt|text-embedding|codex)/.test(m)) return 'openai'
  return null
}

export interface ReconRow {
  day: string; provider: BillingProvider
  providerCost: number; tokenfinCost: number
  variance: number            // providerCost − tokenfinCost (positive = spend TokenFin didn't see)
  variancePct: number | null  // variance / providerCost × 100; null when the provider reports $0
  flagged: boolean
}

export function variance(providerCost: number, tokenfinCost: number): Pick<ReconRow, 'variance' | 'variancePct' | 'flagged'> {
  const v = +(providerCost - tokenfinCost).toFixed(6)
  const pct = providerCost > 0 ? +((v / providerCost) * 100).toFixed(1) : null
  // $0 billed but TokenFin metered spend (> 1¢) is also a mismatch worth a look.
  const flagged = pct !== null ? Math.abs(pct) > VARIANCE_FLAG_PCT : tokenfinCost > 0.01
  return { variance: v, variancePct: pct, flagged }
}

/** Join provider + TokenFin daily totals into one row per (day, provider), newest first.
 *  Only providers in `providers` (the connected ones) are included. */
export function reconcile(
  providerDaily: { day: string; provider: string; cost_usd: number | string }[],
  tokenfinDaily: { day: string; provider: string; cost_usd: number | string }[],
  providers: readonly string[],
): ReconRow[] {
  const keep = new Set(providers)
  const m = new Map<string, { day: string; provider: BillingProvider; p: number; t: number }>()
  const add = (r: { day: string; provider: string; cost_usd: number | string }, field: 'p' | 't') => {
    if (!keep.has(r.provider)) return
    const k = `${r.day}|${r.provider}`
    const cur = m.get(k) ?? { day: r.day, provider: r.provider as BillingProvider, p: 0, t: 0 }
    cur[field] += Number(r.cost_usd) || 0
    m.set(k, cur)
  }
  providerDaily.forEach(r => add(r, 'p'))
  tokenfinDaily.forEach(r => add(r, 't'))
  return Array.from(m.values())
    .map(x => ({ day: x.day, provider: x.provider, providerCost: +x.p.toFixed(6), tokenfinCost: +x.t.toFixed(6), ...variance(x.p, x.t) }))
    .sort((a, b) => b.day.localeCompare(a.day) || a.provider.localeCompare(b.provider))
}

export function totals(rows: ReconRow[]) {
  const providerCost = rows.reduce((s, r) => s + r.providerCost, 0)
  const tokenfinCost = rows.reduce((s, r) => s + r.tokenfinCost, 0)
  return { providerCost, tokenfinCost, ...variance(providerCost, tokenfinCost), flaggedDays: rows.filter(r => r.flagged).length }
}

const csvCell = (v: string | number | null) => {
  const s = v === null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export function toCsv(rows: ReconRow[]): string {
  const head = ['day', 'provider', 'provider_cost_usd', 'tokenfin_metered_usd', 'variance_usd', 'variance_pct', 'flagged']
  return [head.join(','), ...rows.map(r => [r.day, r.provider, r.providerCost.toFixed(4), r.tokenfinCost.toFixed(4), r.variance.toFixed(4), r.variancePct, r.flagged ? 'yes' : ''].map(csvCell).join(','))].join('\n') + '\n'
}
