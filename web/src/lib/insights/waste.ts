/**
 * Waste finder — deterministic rules over the rollups (lib/rollups.ts) plus a
 * few bounded usage_events reads. Every function here is PURE: the loader
 * (lib/insights/load.ts) fetches the inputs, these turn them into findings.
 *
 * Savings are monthly run-rates estimated from the last 30 days. Each finding
 * splits its saving into `bill` (metered API spend or seat fees — real money)
 * and `notional` (subscription usage priced at API rates — never a bill).
 */
import { exploreHref, type ExploreFilters } from '@/lib/explore'
import type { DashSession } from '@/lib/rollups'
import { cheaperTier, isExpensive, type Pricer, type TokenMix } from './pricer'
import type { Confidence, Finding } from './types'

/** 30-day window → monthly run-rate. */
export const MONTH_FACTOR = 30.44 / 30

export const SHORT_OUTPUT_TOKENS = 200
export const MIN_SAMPLE = 20
export const CACHE_MIN_REQUESTS = 50
export const CACHE_MIN_CONTEXT = 4_000
export const CACHE_LOW_HIT = 0.3
export const CACHE_TARGET_HIT = 0.6
/** assumed cache writes per token moved to cache reads (a prefix is written once, read ~10×) */
export const CACHE_WRITE_PER_READ = 0.1
export const STORM_PEAK_DAY = 20
export const STORM_TOTAL = 50
export const RUNAWAY_FACTOR = 3
export const RUNAWAY_MIN_SESSIONS = 20
export const IDLE_KEY_DAYS = 30
export const IDLE_SEAT_MAX_REQUESTS = 10
export const IDLE_SEAT_MAX_COST = 1
/** Assumed monthly seat price when the org hasn't told us (lowest common paid seat). */
export const DEFAULT_SEAT_USD = 20

export interface Window { from: string; to: string }

export interface ModelUsage extends TokenMix {
  model: string
  requests: number
  cost_usd: number
  metered_cost_usd: number
  notional_cost_usd: number
}

export interface CallSample { output_tokens: number; cost_usd: number }

const r2 = (n: number) => Math.round(n * 100) / 100
const usd = (n: number) => (Math.abs(n) >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`)
const pctStr = (x: number) => `${Math.round(x * 100)}%`

export function median(xs: readonly number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Nearest-rank percentile (p in 0..1) of an ASCENDING or unsorted list. */
export function percentile(xs: readonly number[], p: number): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const rank = Math.min(s.length, Math.max(1, Math.ceil(p * s.length)))
  return s[rank - 1]
}

/** Split a saving by the cost basis mix of what it applies to. */
export function splitSaving(saving: number, meteredCost: number, notionalCost: number): { bill: number; notional: number } {
  const total = meteredCost + notionalCost
  const s = Math.max(0, saving)
  if (total <= 0) return { bill: r2(s), notional: 0 }
  const bill = s * (meteredCost / total)
  return { bill: r2(bill), notional: r2(s - bill) }
}

function finding(f: Omit<Finding, 'monthly_saving_usd'>): Finding {
  return { ...f, monthly_saving_usd: r2(f.bill_saving_usd + f.notional_saving_usd) }
}

const explore = (w: Window, filters: ExploreFilters, dim: 'model' | 'member' | 'day' = 'day') =>
  exploreHref({ dim, range: 'custom', from: w.from, to: w.to, filters })

/* ── Rule 1: expensive model on short, low-output calls ─────────────────── */

export function expensiveShortCalls(
  models: readonly ModelUsage[], samples: ReadonlyMap<string, readonly CallSample[]>, pricer: Pricer, w: Window,
): Finding[] {
  const out: Finding[] = []
  for (const m of models) {
    if (m.requests <= 0 || m.cost_usd <= 0) continue
    if (!isExpensive(pricer.price(m.model))) continue
    const target = cheaperTier(m.model)
    if (!target) continue
    const sample = samples.get(m.model) ?? []
    if (sample.length < MIN_SAMPLE) continue
    const med = median(sample.map(s => s.output_tokens))
    if (med >= SHORT_OUTPUT_TOKENS) continue

    const now = pricer.cost(m.model, m)
    const then = pricer.cost(target, m)
    if (now <= 0 || then >= now) continue
    const ratio = then / now

    // Share of the model's spend that comes from short calls (by cost in the sample).
    const short = sample.filter(s => s.output_tokens < SHORT_OUTPUT_TOKENS)
    const sampleCost = sample.reduce((a, s) => a + s.cost_usd, 0)
    const shortShare = sampleCost > 0
      ? short.reduce((a, s) => a + s.cost_usd, 0) / sampleCost
      : short.length / sample.length

    const saving = m.cost_usd * shortShare * (1 - ratio) * MONTH_FACTOR
    if (saving <= 0) continue
    const conf: Confidence = sample.length >= 200 && med < SHORT_OUTPUT_TOKENS / 2 ? 'high' : sample.length >= 50 ? 'medium' : 'low'
    const split = splitSaving(saving, m.metered_cost_usd, m.notional_cost_usd)
    out.push(finding({
      id: `expensive_model_short_output:${m.model}`,
      rule: 'expensive_model_short_output',
      title: `${m.model} is answering short questions`,
      detail: `Median output is ${Math.round(med)} tokens over ${sample.length} recent calls; ${pctStr(shortShare)} of its ${usd(m.cost_usd)} spend is calls under ${SHORT_OUTPUT_TOKENS} output tokens. ${target} would cost ${pctStr(1 - ratio)} less for the same tokens.`,
      recommendation: `Route short / low-output calls to ${target} (keep ${m.model} for long reasoning).`,
      bill_saving_usd: split.bill, notional_saving_usd: split.notional,
      confidence: conf,
      evidence: { label: `Explore ${m.model}`, href: explore(w, { model: m.model }, 'member') },
      metrics: { model: m.model, target, median_output_tokens: Math.round(med), sample: sample.length, short_share_pct: Math.round(shortShare * 100), requests: m.requests },
    }))
  }
  return out
}

/* ── Rule 2: low cache-read ratio on repeated large prompts ─────────────── */

export function cacheHitRate(t: TokenMix): number {
  const denom = t.input_tokens + t.cache_read_tokens
  return denom > 0 ? t.cache_read_tokens / denom : 0
}

/** Tokens after raising the cache-hit rate to `target` (moved input → cache read, +writes). */
export function withCacheHit(t: TokenMix, target: number, writePerRead = CACHE_WRITE_PER_READ): TokenMix {
  const pool = t.input_tokens + t.cache_read_tokens
  const wantRead = Math.max(0, Math.min(1, target)) * pool
  let moved = Math.max(0, wantRead - t.cache_read_tokens)
  // moved tokens + the writes that seed them must come out of plain input.
  moved = Math.min(moved, t.input_tokens / (1 + writePerRead))
  const writes = moved * writePerRead
  return {
    input_tokens: t.input_tokens - moved - writes,
    output_tokens: t.output_tokens,
    cache_read_tokens: t.cache_read_tokens + moved,
    cache_write_tokens: t.cache_write_tokens + writes,
  }
}

export function lowCacheReuse(models: readonly ModelUsage[], pricer: Pricer, w: Window): Finding[] {
  const out: Finding[] = []
  for (const m of models) {
    if (m.requests < CACHE_MIN_REQUESTS || m.cost_usd <= 0) continue
    const ctx = (m.input_tokens + m.cache_read_tokens + m.cache_write_tokens) / m.requests
    if (ctx < CACHE_MIN_CONTEXT) continue
    const hit = cacheHitRate(m)
    if (hit >= CACHE_LOW_HIT) continue
    const now = pricer.cost(m.model, m)
    const after = pricer.cost(m.model, withCacheHit(m, CACHE_TARGET_HIT))
    if (now <= 0 || after >= now) continue
    // Scale the token-priced delta onto recorded spend (keeps overrides + basis honest).
    const saving = m.cost_usd * ((now - after) / now) * MONTH_FACTOR
    const split = splitSaving(saving, m.metered_cost_usd, m.notional_cost_usd)
    out.push(finding({
      id: `low_cache_reuse:${m.model}`,
      rule: 'low_cache_reuse',
      title: `Prompt caching barely used on ${m.model}`,
      detail: `Calls average ${Math.round(ctx).toLocaleString('en-US')} context tokens but only ${pctStr(hit)} are cache reads. Raising that to ${pctStr(CACHE_TARGET_HIT)} would cut this model's cost by ${pctStr((now - after) / now)}.`,
      recommendation: 'Put stable system prompts, tool definitions and documents first and mark them cacheable; avoid timestamps or random ids early in the prompt.',
      bill_saving_usd: split.bill, notional_saving_usd: split.notional,
      confidence: m.requests >= 500 ? 'medium' : 'low',
      evidence: { label: `Explore ${m.model}`, href: explore(w, { model: m.model }) },
      metrics: { model: m.model, cache_hit_pct: Math.round(hit * 100), avg_context_tokens: Math.round(ctx), requests: m.requests },
    }))
  }
  return out
}

/* ── Rule 3: retry / error storms ───────────────────────────────────────── */

export interface ErrorRow { user_key: string; model: string; day: string; errors: number }

export function errorStorms(
  rows: readonly ErrorRow[], models: readonly ModelUsage[], w: Window,
): Finding[] {
  const avgCost = new Map<string, { perReq: number; metered: number; notional: number }>()
  for (const m of models) {
    if (m.requests > 0) avgCost.set(m.model, { perReq: m.cost_usd / m.requests, metered: m.metered_cost_usd, notional: m.notional_cost_usd })
  }
  const groups = new Map<string, { user_key: string; model: string; total: number; peak: number; peakDay: string; days: number }>()
  for (const r of rows) {
    if (r.errors <= 0) continue
    const k = `${r.user_key}\u0000${r.model}`
    const g = groups.get(k) ?? { user_key: r.user_key, model: r.model, total: 0, peak: 0, peakDay: r.day, days: 0 }
    g.total += r.errors
    g.days += 1
    if (r.errors > g.peak) { g.peak = r.errors; g.peakDay = r.day }
    groups.set(k, g)
  }
  const out: Finding[] = []
  for (const g of groups.values()) {
    if (g.peak < STORM_PEAK_DAY && g.total < STORM_TOTAL) continue
    const a = avgCost.get(g.model)
    // Each failed call is typically retried with the full context re-sent.
    const saving = (a?.perReq ?? 0) * g.total * MONTH_FACTOR
    const split = a ? splitSaving(saving, a.metered, a.notional) : { bill: 0, notional: 0 }
    const who = g.user_key || 'unattributed calls'
    out.push(finding({
      id: `error_storm:${g.user_key}:${g.model}`,
      rule: 'error_storm',
      title: `Error storm: ${g.total.toLocaleString('en-US')} failed ${g.model || 'API'} calls (${who})`,
      detail: `${g.total} errors over ${g.days} day(s), peaking at ${g.peak} on ${g.peakDay}. Retries re-send the whole context${a ? ` (~${usd(a.perReq)} per call on this model)` : ''}.`,
      recommendation: 'Check rate limits / overloaded errors and add exponential backoff with a retry cap; fix malformed requests at the source.',
      bill_saving_usd: split.bill, notional_saving_usd: split.notional,
      confidence: g.total >= 200 ? 'medium' : 'low',
      evidence: {
        label: 'Explore that day',
        href: exploreHref({ dim: 'model', range: 'custom', from: g.peakDay, to: g.peakDay, filters: { ...(g.user_key ? { member: g.user_key } : {}), ...(g.model ? { model: g.model } : {}) } }),
      },
      metrics: { user_key: g.user_key, model: g.model, errors: g.total, peak_day: g.peakDay, peak_errors: g.peak },
    }))
  }
  return out
}

/* ── Rule 4: runaway sessions ───────────────────────────────────────────── */

/**
 * `models` gives each session's metered/notional mix via its main model
 * (sessions carry no cost basis); `notionalShare` is the org-wide fallback.
 */
export function runawaySessions(
  sessions: readonly DashSession[], p95: number, totalSessions: number, notionalShare: number, max = 5,
  models: readonly ModelUsage[] = [],
): Finding[] {
  if (totalSessions < RUNAWAY_MIN_SESSIONS || p95 <= 0) return []
  const cap = p95 * RUNAWAY_FACTOR
  const byModel = new Map(models.filter(m => m.cost_usd > 0).map(m => [m.model, m.notional_cost_usd / m.cost_usd]))
  return sessions
    .filter(s => s.cost_usd > cap)
    .sort((a, b) => b.cost_usd - a.cost_usd)
    .slice(0, max)
    .map(s => {
      const excess = (s.cost_usd - cap) * MONTH_FACTOR
      const share = Math.max(0, Math.min(1, byModel.get(s.model) ?? notionalShare))
      const split = splitSaving(excess, 1 - share, share)
      return finding({
        id: `runaway_session:${s.session_id}`,
        rule: 'runaway_session',
        title: `Runaway session: ${usd(s.cost_usd)} (${(s.cost_usd / p95).toFixed(1)}× the P95 session)`,
        detail: `${s.requests} calls, ${s.total_tokens.toLocaleString('en-US')} tokens on ${s.model || 'mixed models'}${s.user_key ? ` by ${s.user_key}` : ''}${s.repo ? ` in ${s.repo}` : ''}. A typical expensive session (P95) costs ${usd(p95)}.`,
        recommendation: `Set a per-session budget (e.g. ${usd(cap)}) or alert, and look for loops: repeated tool calls, huge files re-read, or /compact never run.`,
        bill_saving_usd: split.bill, notional_saving_usd: split.notional,
        confidence: 'medium',
        evidence: { label: 'Open session', href: `/dashboard/sessions/${encodeURIComponent(s.session_id)}` },
        metrics: { session_id: s.session_id, cost_usd: r2(s.cost_usd), p95_usd: r2(p95), requests: s.requests },
      })
    })
}

/* ── Rule 5: idle or duplicate API keys ─────────────────────────────────── */

export interface KeyRow {
  id: string; name: string; key_prefix: string
  project_id: string | null; user_id: string | null; created_by: string | null
  kind: string | null; device_id: string | null
  last_used_at: string | null; created_at: string
}

export function keyHygiene(keys: readonly KeyRow[], now: number = Date.now()): Finding[] {
  const out: Finding[] = []
  const cutoff = now - IDLE_KEY_DAYS * 86_400_000
  const idle = keys.filter(k => Date.parse(k.created_at) < cutoff && (!k.last_used_at || Date.parse(k.last_used_at) < cutoff))
  if (idle.length) {
    out.push(finding({
      id: 'idle_key:all',
      rule: 'idle_key',
      title: `${idle.length} active API key${idle.length === 1 ? '' : 's'} unused for ${IDLE_KEY_DAYS}+ days`,
      detail: `${idle.slice(0, 5).map(k => `${k.name} (${k.key_prefix})`).join(', ')}${idle.length > 5 ? `, +${idle.length - 5} more` : ''}. Idle keys cost nothing today but are leak risk and hide who is spending.`,
      recommendation: 'Revoke keys nobody uses; issue per-person keys so spend stays attributable.',
      bill_saving_usd: 0, notional_saving_usd: 0,
      confidence: 'high',
      evidence: { label: 'Manage keys', href: '/dashboard/keys' },
      metrics: { keys: idle.length },
    }))
  }
  const groups = new Map<string, KeyRow[]>()
  for (const k of keys) {
    const owner = k.user_id ?? k.created_by ?? ''
    const g = `${k.project_id ?? ''}|${owner}|${k.kind ?? ''}|${k.device_id ?? ''}`
    groups.set(g, [...(groups.get(g) ?? []), k])
  }
  const dups = [...groups.values()].filter(g => g.length > 1)
  if (dups.length) {
    const extra = dups.reduce((a, g) => a + g.length - 1, 0)
    out.push(finding({
      id: 'duplicate_keys:all',
      rule: 'duplicate_keys',
      title: `${extra} duplicate API key${extra === 1 ? '' : 's'} (same owner, project and kind)`,
      detail: `${dups.slice(0, 3).map(g => {
        const names = [...new Set(g.map(k => k.name))]
        return `${names.slice(0, 3).join(' / ')}${names.length > 3 ? ' / …' : ''} (${g.length} keys)`
      }).join('; ')}${dups.length > 3 ? `; +${dups.length - 3} more group(s)` : ''}.`,
      recommendation: 'Keep one key per owner, project and purpose; revoke the extras.',
      bill_saving_usd: 0, notional_saving_usd: 0,
      confidence: 'high',
      evidence: { label: 'Manage keys', href: '/dashboard/keys' },
      metrics: { groups: dups.length, extra_keys: extra },
    }))
  }
  return out
}

/* ── Rule 6: notional (subscription) seats with near-zero use ───────────── */

export interface SeatUsage {
  user_key: string
  /** last 30 days */
  requests: number
  notional_cost_usd: number
  /** the 60 days before — proves the person has a seat */
  prev_notional_cost_usd: number
}

export function idleSeats(seats: readonly SeatUsage[], seatUsd = DEFAULT_SEAT_USD, w: Window): Finding[] {
  const hadSeat = seats.filter(s => s.user_key && (s.notional_cost_usd > 0 || s.prev_notional_cost_usd > 0))
  const idle = hadSeat.filter(s => s.requests < IDLE_SEAT_MAX_REQUESTS && s.notional_cost_usd < IDLE_SEAT_MAX_COST)
  if (!idle.length) return []
  const saving = idle.length * seatUsd
  return [finding({
    id: 'idle_seat:all',
    rule: 'idle_seat',
    title: `${idle.length} subscription seat${idle.length === 1 ? '' : 's'} with near-zero use`,
    detail: `${idle.slice(0, 5).map(s => s.user_key).join(', ')}${idle.length > 5 ? `, +${idle.length - 5} more` : ''} used a coding-agent subscription before but made fewer than ${IDLE_SEAT_MAX_REQUESTS} calls in the last 30 days. Saving assumes ~$${seatUsd}/seat/month — we can't see your actual plan.`,
    recommendation: 'Downgrade or reclaim these seats, or move light users to pay-as-you-go API keys (see What-if).',
    bill_saving_usd: r2(saving), notional_saving_usd: 0,
    confidence: 'low',
    evidence: { label: 'Explore members', href: explore(w, {}, 'member') },
    metrics: { seats: idle.length, seat_usd: seatUsd, seats_seen: hadSeat.length },
  })]
}

/* ── Ordering + totals ──────────────────────────────────────────────────── */

const CONF_RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 }

export function sortFindings(fs: readonly Finding[]): Finding[] {
  return [...fs].sort((a, b) =>
    b.monthly_saving_usd - a.monthly_saving_usd || CONF_RANK[a.confidence] - CONF_RANK[b.confidence] || a.id.localeCompare(b.id))
}

export function totalsOf(fs: readonly Finding[]) {
  const bill = fs.reduce((a, f) => a + f.bill_saving_usd, 0)
  const notional = fs.reduce((a, f) => a + f.notional_saving_usd, 0)
  return { monthly_saving_usd: r2(bill + notional), bill_saving_usd: r2(bill), notional_saving_usd: r2(notional), findings: fs.length }
}
