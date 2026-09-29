/**
 * Spike explainer.
 *
 *  detectSpikes  — days whose cost exceeds the trailing mean + 3σ (org-local
 *                  days from dashSummary.series, ≥ 7 days of history).
 *  explainSpike  — decomposes the delta vs the baseline across dimensions with
 *                  dashBreakdown (injected as a fetcher so it is testable) and
 *                  drills member → model → repo → source to name the joint
 *                  top contributor: "+$41 vs usual; 78% from alice@ on opus in repo X".
 */

import { exploreHref, type ExploreFilters } from '@/lib/explore'
import type { DashFilters } from '@/lib/rollups'
import type { Contributor, ExplainedSpike, PathStep, Spike, SpikeDim } from './types'

export interface DayCost { day: string; cost: number }

export interface SpikeOpts {
  /** trailing baseline window in days */
  window?: number
  minHistory?: number
  sigmas?: number
  /** a spike must also be at least this many $ above the mean (σ≈0 noise guard) */
  minDelta?: number
  /** only report spikes on/after this day */
  since?: string
}

const r2 = (n: number) => Math.round(n * 100) / 100
const r4 = (n: number) => Math.round(n * 10_000) / 10_000

export function meanSd(xs: readonly number[]): { mean: number; sd: number } {
  if (!xs.length) return { mean: 0, sd: 0 }
  const mean = xs.reduce((a, x) => a + x, 0) / xs.length
  const variance = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length
  return { mean, sd: Math.sqrt(variance) }
}

/**
 * `series` must be chronological and zero-filled (dashSummary does both).
 * History starts at the first day with any cost — zero days before an org
 * started sending data are not "history".
 */
export function detectSpikes(series: readonly DayCost[], opts: SpikeOpts = {}): Spike[] {
  const { window = 14, minHistory = 7, sigmas = 3, minDelta = 1, since } = opts
  const start = series.findIndex(p => p.cost > 0)
  if (start < 0) return []
  const out: Spike[] = []
  for (let i = start + minHistory; i < series.length; i++) {
    const d = series[i]
    if (since && d.day < since) continue
    const lo = Math.max(start, i - window)
    const hist = series.slice(lo, i)
    if (hist.length < minHistory) continue
    const { mean, sd } = meanSd(hist.map(p => p.cost))
    const threshold = mean + sigmas * sd
    const delta = d.cost - mean
    if (d.cost > threshold && delta >= minDelta) {
      out.push({
        day: d.day, cost: r4(d.cost), baseline_mean: r4(mean), baseline_sd: r4(sd), threshold: r4(threshold),
        delta: r4(delta), history_days: hist.length, baseline_from: hist[0].day, baseline_to: hist[hist.length - 1].day,
      })
    }
  }
  return out
}

export interface BreakRow { key: string; cost_usd: number }

/** Per-key change vs the baseline daily mean, positive contributors only, largest first. */
export function contributors(
  today: readonly BreakRow[], baseline: readonly BreakRow[], baselineDays: number, totalDelta: number,
  label: (key: string) => string = k => k,
): Contributor[] {
  const days = Math.max(1, baselineDays)
  const usual = new Map<string, number>()
  for (const r of baseline) usual.set(r.key, (usual.get(r.key) ?? 0) + r.cost_usd / days)
  const now = new Map<string, number>()
  for (const r of today) now.set(r.key, (now.get(r.key) ?? 0) + r.cost_usd)
  const keys = new Set([...usual.keys(), ...now.keys()])
  const out: Contributor[] = []
  for (const key of keys) {
    const t = now.get(key) ?? 0, u = usual.get(key) ?? 0, delta = t - u
    if (delta <= 0) continue
    out.push({ key, label: label(key), today: r4(t), usual: r4(u), delta: r4(delta), pct: totalDelta > 0 ? Math.min(100, Math.round((delta / totalDelta) * 100)) : 0 })
  }
  return out.sort((a, b) => b.delta - a.delta || a.key.localeCompare(b.key))
}

export type Fetcher = (dim: SpikeDim, from: string, to: string, filters: DashFilters) => Promise<BreakRow[]>

const FILTER_OF: Record<SpikeDim, keyof DashFilters> = {
  member: 'user_key', model: 'model', repo: 'repo', project: 'project_id', source: 'source', agent: 'agent',
}
const EXPLORE_OF: Record<SpikeDim, keyof ExploreFilters> = {
  member: 'member', model: 'model', repo: 'repo', project: 'project', source: 'source', agent: 'agent',
}
const PHRASE: Record<SpikeDim, (l: string) => string> = {
  member: l => `from ${l}`, model: l => `on ${l}`, repo: l => `in repo ${l}`,
  project: l => `in project ${l}`, source: l => `via ${l}`, agent: l => `by agent ${l}`,
}

export const MARGINAL_DIMS: SpikeDim[] = ['model', 'member', 'project', 'source', 'agent', 'repo']
export const DRILL_DIMS: SpikeDim[] = ['member', 'model', 'repo', 'source']
/** a drill step is kept only if its top key explains at least this share of its parent */
export const DRILL_MIN_SHARE = 0.5

/** Memoize a fetcher per (dim, from, to, filters) — the drill re-uses marginal queries. */
export function memoFetcher(f: Fetcher): Fetcher {
  const cache = new Map<string, Promise<BreakRow[]>>()
  return (dim, from, to, filters) => {
    const k = JSON.stringify([dim, from, to, Object.entries(filters).filter(([, v]) => v != null && v !== '').sort()])
    let p = cache.get(k)
    if (!p) { p = f(dim, from, to, filters); cache.set(k, p) }
    return p
  }
}

const isBlank = (k: string) => k === '' || k === '00000000-0000-0000-0000-000000000000'

const usd = (n: number) => (Math.abs(n) >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`)

export function spikeSentence(s: Pick<Spike, 'delta' | 'baseline_mean'>, path: readonly PathStep[]): string {
  const head = `+${usd(s.delta)} vs usual (${usd(s.baseline_mean)}/day)`
  if (!path.length) return `${head}; no single member, model or repo stands out`
  const last = path[path.length - 1]
  return `${head}; ${last.pct}% ${path.map(p => PHRASE[p.dim](p.label)).join(' ')}`
}

export async function explainSpike(
  spike: Spike, fetch: Fetcher,
  opts: { base?: DashFilters; dims?: SpikeDim[]; drill?: SpikeDim[]; label?: (dim: SpikeDim, key: string) => string; top?: number } = {},
): Promise<ExplainedSpike> {
  const base = opts.base ?? {}
  const label = opts.label ?? ((_d, k) => k)
  const top = opts.top ?? 3
  const skip = new Set<SpikeDim>(Object.entries(FILTER_OF).filter(([, f]) => base[f]).map(([d]) => d as SpikeDim))
  const dims = (opts.dims ?? MARGINAL_DIMS).filter(d => !skip.has(d))
  const drill = (opts.drill ?? DRILL_DIMS).filter(d => !skip.has(d))
  const f = memoFetcher(fetch)
  const bFrom = spike.baseline_from, bTo = spike.baseline_to, n = spike.history_days

  const decompose = async (dim: SpikeDim, filters: DashFilters, parentDelta: number) => {
    const [t, b] = await Promise.all([f(dim, spike.day, spike.day, filters), f(dim, bFrom, bTo, filters)])
    return contributors(t, b, n, parentDelta, k => label(dim, k))
  }

  const marginal: ExplainedSpike['contributors'] = {}
  // Unattributed keys ('' / no project) are dropped from the marginal lists — they explain nothing.
  await Promise.all(dims.map(async d => {
    const rows = (await decompose(d, base, spike.delta)).filter(c => !isBlank(c.key)).slice(0, top)
    if (rows.length) marginal[d] = rows
  }))

  const path: PathStep[] = []
  const filters: DashFilters = { ...base }
  let parent = spike.delta
  for (const d of drill) {
    const rows = await decompose(d, filters, spike.delta)
    const hit = rows[0]
    if (!hit || isBlank(hit.key)) continue
    if (hit.delta < parent * DRILL_MIN_SHARE) break
    path.push({ dim: d, key: hit.key, label: hit.label, delta: hit.delta, pct: hit.pct })
    filters[FILTER_OF[d]] = hit.key
    parent = hit.delta
  }

  const exploreFilters: ExploreFilters = {}
  for (const d of Object.keys(FILTER_OF) as SpikeDim[]) {
    const v = filters[FILTER_OF[d]]
    if (v) exploreFilters[EXPLORE_OF[d]] = v
  }
  return {
    ...spike,
    delta: r2(spike.delta),
    sentence: spikeSentence(spike, path),
    path,
    contributors: marginal,
    filters,
    evidence: {
      label: 'Explore the spike day',
      href: exploreHref({ dim: 'model', range: 'custom', from: spike.day, to: spike.day, filters: exploreFilters }),
    },
  }
}
