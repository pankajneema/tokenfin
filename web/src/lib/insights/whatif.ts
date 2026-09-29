/**
 * What-if simulator — pure computation, client-safe.
 *
 * Input: last-30-day usage per (model, cost basis) with exact token counts from
 * the rollups, plus per-member notional spend for the seat scenario. Costs are
 * RE-PRICED from tokens (org overrides, else list price) both before and after,
 * so the delta isolates the scenario, not pricing drift in stored rows.
 *
 * Scenarios, applied in this order:
 *  1. switch   — move `share` (0..1) of model A's tokens to model B
 *  2. cache    — raise every model's cache-hit rate to `hitRate` (never lowers it)
 *  3. outputCap — cap output at `maxOutput` tokens per call (conservative:
 *                 uses each group's average, so real savings are ≥ this)
 *  4. seats    — move light notional users (API cost < seat price) to metered API
 */
import type { Pricer, TokenMix } from './pricer'
import { withCacheHit } from './waste'

export type Basis = 'metered' | 'notional'

export interface UsageGroup extends TokenMix {
  model: string
  basis: Basis
  requests: number
}

export interface SeatRow { user_key: string; notional_cost_usd: number }

export interface Scenario {
  switch?: { from: string; to: string; share: number } | null
  cache?: { hitRate: number } | null
  outputCap?: { maxOutput: number } | null
  seats?: { seatUsd: number } | null
}

export interface CostSide {
  metered_usd: number
  notional_usd: number
  seat_fees_usd: number
  /** what you actually pay: metered API + seat fees (notional is never a bill) */
  bill_usd: number
}

export interface ModelLine { model: string; basis: Basis; requests: number; requests_after: number; before_usd: number; after_usd: number; tokens_before: TokenMix; tokens_after: TokenMix }

export interface WhatIfResult {
  before: CostSide
  after: CostSide
  delta: { metered_usd: number; notional_usd: number; seat_fees_usd: number; bill_usd: number }
  lines: ModelLine[]
  seats: { total: number; moved: number; moved_keys: string[]; moved_api_usd: number }
  notes: string[]
}

const r2 = (n: number) => Math.round(n * 100) / 100
const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0))
const tok = (t: TokenMix): TokenMix => ({ input_tokens: t.input_tokens, output_tokens: t.output_tokens, cache_read_tokens: t.cache_read_tokens, cache_write_tokens: t.cache_write_tokens })
const scale = (t: TokenMix, f: number): TokenMix => ({
  input_tokens: t.input_tokens * f, output_tokens: t.output_tokens * f,
  cache_read_tokens: t.cache_read_tokens * f, cache_write_tokens: t.cache_write_tokens * f,
})

interface Work { model: string; basis: Basis; requests: number; t: TokenMix; origin: number }

export function simulate(groups: readonly UsageGroup[], seats: readonly SeatRow[], sc: Scenario, pricer: Pricer): WhatIfResult {
  const notes: string[] = []
  const before = groups.map(g => pricer.cost(g.model, g))

  // 1. switch A → B
  let work: Work[] = groups.map((g, i) => ({ model: g.model, basis: g.basis, requests: g.requests, t: tok(g), origin: i }))
  if (sc.switch && sc.switch.from && sc.switch.to && sc.switch.from !== sc.switch.to) {
    const share = clamp01(sc.switch.share)
    const next: Work[] = []
    for (const w of work) {
      if (w.model !== sc.switch.from || share === 0) { next.push(w); continue }
      if (share < 1) next.push({ ...w, requests: w.requests * (1 - share), t: scale(w.t, 1 - share) })
      next.push({ ...w, model: sc.switch.to, requests: w.requests * share, t: scale(w.t, share) })
    }
    work = next
    notes.push(`Moved ${Math.round(share * 100)}% of ${sc.switch.from} tokens to ${sc.switch.to} (same token counts; quality not modelled).`)
  }

  // 2. cache-hit rate
  if (sc.cache && sc.cache.hitRate > 0) {
    const target = clamp01(sc.cache.hitRate)
    work = work.map(w => ({ ...w, t: withCacheHit(w.t, target) }))
    notes.push(`Cache-hit raised to ${Math.round(target * 100)}% where lower (adds ~1 cache write per 10 reads).`)
  }

  // 3. output cap
  if (sc.outputCap && sc.outputCap.maxOutput > 0) {
    const cap = sc.outputCap.maxOutput
    work = work.map(w => ({ ...w, t: { ...w.t, output_tokens: Math.min(w.t.output_tokens, w.requests * cap) } }))
    notes.push(`Output capped at ${cap.toLocaleString('en-US')} tokens/call (from averages — a lower bound on the real saving).`)
  }

  const afterCost = work.map(w => pricer.cost(w.model, w.t))
  const sumBy = (costs: number[], rows: readonly { basis: Basis }[], b: Basis) => costs.reduce((a, c, i) => a + (rows[i].basis === b ? c : 0), 0)
  const meteredBefore = sumBy(before, groups, 'metered')
  const notionalBefore = sumBy(before, groups, 'notional')
  let meteredAfter = sumBy(afterCost, work, 'metered')
  let notionalAfter = sumBy(afterCost, work, 'notional')

  // 4. seats → API
  const seatUsd = sc.seats ? Math.max(0, sc.seats.seatUsd) : 0
  const seatKeys = seats.filter(s => s.user_key && s.notional_cost_usd > 0)
  const seatFeesBefore = seatUsd * seatKeys.length
  let seatFeesAfter = seatFeesBefore
  const moved: string[] = []
  let movedApi = 0
  if (sc.seats && seatUsd > 0 && notionalBefore > 0) {
    // scale each seat's notional by what scenarios 1-3 did to notional overall
    const f = notionalAfter / notionalBefore
    for (const s of seatKeys) {
      const api = s.notional_cost_usd * f
      if (api < seatUsd) { moved.push(s.user_key); movedApi += api }
    }
    seatFeesAfter = seatUsd * (seatKeys.length - moved.length)
    meteredAfter += movedApi
    notionalAfter -= movedApi
    notes.push(`${moved.length} of ${seatKeys.length} seat(s) cost less than $${seatUsd}/mo at API rates and move to metered API.`)
  }

  const side = (m: number, n: number, s: number): CostSide => ({ metered_usd: r2(m), notional_usd: r2(Math.max(0, n)), seat_fees_usd: r2(s), bill_usd: r2(m + s) })
  const b = side(meteredBefore, notionalBefore, seatFeesBefore)
  const a = side(meteredAfter, notionalAfter, seatFeesAfter)

  // Per-line view keyed by final (model, basis).
  const lineMap = new Map<string, ModelLine>()
  const zero = (): TokenMix => ({ input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 })
  const add = (x: TokenMix, y: TokenMix) => { x.input_tokens += y.input_tokens; x.output_tokens += y.output_tokens; x.cache_read_tokens += y.cache_read_tokens; x.cache_write_tokens += y.cache_write_tokens }
  const line = (model: string, basis: Basis) => {
    const k = `${model}|${basis}`
    let l = lineMap.get(k)
    if (!l) { l = { model, basis, requests: 0, requests_after: 0, before_usd: 0, after_usd: 0, tokens_before: zero(), tokens_after: zero() }; lineMap.set(k, l) }
    return l
  }
  groups.forEach((g, i) => { const l = line(g.model, g.basis); l.before_usd += before[i]; l.requests += g.requests; add(l.tokens_before, g) })
  work.forEach((w, i) => { const l = line(w.model, w.basis); l.after_usd += afterCost[i]; l.requests_after += w.requests; add(l.tokens_after, w.t) })
  const lines = [...lineMap.values()]
    .map(l => ({ ...l, before_usd: r2(l.before_usd), after_usd: r2(l.after_usd), requests: Math.round(l.requests), requests_after: Math.round(l.requests_after) }))
    .sort((x, y) => y.before_usd - x.before_usd || y.after_usd - x.after_usd)

  return {
    before: b, after: a,
    delta: {
      metered_usd: r2(a.metered_usd - b.metered_usd), notional_usd: r2(a.notional_usd - b.notional_usd),
      seat_fees_usd: r2(a.seat_fees_usd - b.seat_fees_usd), bill_usd: r2(a.bill_usd - b.bill_usd),
    },
    lines,
    seats: { total: seatKeys.length, moved: moved.length, moved_keys: moved, moved_api_usd: r2(movedApi) },
    notes,
  }
}
