/**
 * Derive per-turn usage rows from OTLP METRICS (Codex, Gemini).
 *
 * These agents report tokens only as metric counters — usually CUMULATIVE
 * (monotonically growing totals). Persisting a cumulative value as-is would
 * count the running total as one turn; persisting every export would count the
 * same tokens repeatedly. So we diff each series against its last-seen value:
 *
 *   - first time we see a series → store the baseline, emit NOTHING (we can't
 *     know how much of the total is "new")
 *   - later → delta = current − last-seen; emit only the delta; a drop (counter
 *     reset) emits nothing
 *   - DELTA temporality → the value IS the interval, emit directly
 *
 * This is safe-by-construction: it never double-counts and never invents tokens.
 * It may miss the first interval after a fresh connect (baseline), which is
 * acceptable and preferable to over-billing.
 *
 * Claude Code metrics are NOT processed here (its logs already own those rows).
 */
import crypto from 'crypto'
import { attrsToMap, num, repoFrom, allocationTagsFrom, userKeyFrom, istDay } from './attrs'
import { tokenFieldFor, deriveSourceFor, detectSource, costBasisFor, isDeltaTemporality, PRODUCTIVITY_METRICS, type TokenField } from './mapping'
import { computeCost, priceFor } from '@/lib/mcp/pricing'
import type { KeyCtx } from './auth'
import type { UsageRow } from './normalize'

// Last-seen cumulative value per metric series. DB-backed in the route
// (otlp_state_advance RPC); in memory in tests. Scoped per-org by the caller,
// so keys need not include the org.
export interface MetricState {
  /**
   * Atomically advance every series to max(stored, value) and return the value
   * each held before (null / absent = first seen). One call per export.
   */
  advance(entries: Array<{ key: string; value: number }>): Promise<Map<string, number | null>>
}

/** A series this export advanced — undo it if the derived rows fail to persist. */
export interface MetricClaim { key: string; value: number; prev: number | null }

/** In-memory MetricState (tests, and a fallback when the DB state is unavailable). */
export function memoryMetricState(m: Map<string, number> = new Map()): MetricState & { m: Map<string, number> } {
  return {
    m,
    async advance(entries) {
      const out = new Map<string, number | null>()
      for (const { key, value } of entries) {
        if (!out.has(key)) out.set(key, m.has(key) ? m.get(key)! : null)
        m.set(key, Math.max(m.get(key) ?? -Infinity, value))
      }
      return out
    },
  }
}

/**
 * Resolve previous values for a batch of cumulative points with ONE advance
 * call, then replay them in payload order so a series seen twice in the same
 * export diffs against its own earlier point.
 */
async function advanceAll(state: MetricState, points: Array<{ key: string; value: number }>) {
  const uniq = new Map<string, number>()
  for (const p of points) uniq.set(p.key, Math.max(uniq.get(p.key) ?? -Infinity, p.value))
  const stored = uniq.size ? await state.advance(Array.from(uniq, ([key, value]) => ({ key, value }))) : new Map<string, number | null>()
  const last = new Map<string, number | null>()
  const claims: MetricClaim[] = []
  for (const [key, value] of Array.from(uniq)) {
    const prev = stored.get(key) ?? null
    if (prev == null || value > prev) claims.push({ key, value, prev })
  }
  /** previous value for the next point of `key` (and record this one). */
  const prevFor = (key: string, value: number): number | null => {
    const prev = last.has(key) ? last.get(key)! : (stored.get(key) ?? null)
    last.set(key, prev == null ? value : Math.max(prev, value))
    return prev
  }
  return { prevFor, claims }
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const zeroTokens = (): Record<TokenField, number> => ({
  input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0,
})

interface Group { source: string; model: string; correlation: string | null; timeNano: string; tokens: Record<TokenField, number>; repo: string; tags: Record<string, string>; email: string | null }

export interface DeriveResult { rows: UsageRow[]; skippedFirstSeen: number; claims: MetricClaim[] }

export async function deriveMetricEvents(body: any, ctx: KeyCtx, state: MetricState): Promise<DeriveResult> {
  const groups = new Map<string, Group>()
  let skippedFirstSeen = 0

  interface Pt { source: string; field: TokenField; value: number; model: string; correlation: string | null; timeNano: string; seriesKey: string | null; ident: Record<string, unknown> }
  const points: Pt[] = []
  for (const rm of body?.resourceMetrics ?? []) {
    const resAttrs = attrsToMap(rm?.resource?.attributes ?? [])
    for (const sm of rm?.scopeMetrics ?? []) {
      for (const m of sm?.metrics ?? []) {
        const name = String(m?.name ?? '')
        // Source is resource-aware: OpenCode derives the SAME gen_ai semconv
        // metric names as Gemini, so the service.name attribute (not the metric
        // name) decides which agent it belongs to.
        let source = deriveSourceFor(name)
        if (source === 'gemini_cli') {
          const resSource = detectSource(resAttrs, name)
          if (resSource === 'opencode') source = 'opencode'
        }
        if (!source) continue                    // claude_code + non-token metrics: not derived here

        const sum = m?.sum
        const histogram = m?.histogram
        const dps: any[] = sum?.dataPoints ?? m?.gauge?.dataPoints ?? histogram?.dataPoints ?? []
        // Histograms have no cumulative-counter concept — each data point IS
        // one fresh observation (e.g. Codex's codex.turn.token_usage: one
        // data point per token_type per turn, confirmed on a real session
        // 2026-08-10), so always treat them as delta, regardless of the
        // aggregationTemporality they report.
        const isDelta = !!histogram || (!!sum && isDeltaTemporality(sum.aggregationTemporality))

        for (const dp of dps) {
          const a = attrsToMap(dp?.attributes ?? [])
          const type = a['token_type'] ?? a['type'] ?? a['gen_ai.token.type']
          const field = tokenFieldFor(type)
          if (!field) continue                   // unknown token type
          const value = num(histogram ? dp?.sum : (dp?.asInt ?? dp?.asDouble))
          const model = String(a['model'] ?? a['gen_ai.request.model'] ?? resAttrs['gen_ai.request.model'] ?? 'unknown')
          const correlation = (a['conversation.id'] ?? a['gen_ai.conversation.id'] ?? a['session.id'] ?? null) as string | null
          points.push({
            source, field, value, model, correlation, timeNano: String(dp?.timeUnixNano ?? ''),
            seriesKey: isDelta ? null : `${name}|${model}|${correlation ?? ''}|${String(type)}`,
            ident: { ...resAttrs, ...a },
          })
        }
      }
    }
  }

  // One atomic state round trip for every cumulative series in the export.
  const { prevFor, claims } = await advanceAll(state, points.filter(p => p.seriesKey).map(p => ({ key: p.seriesKey!, value: p.value })))

  for (const p of points) {
    let contribution: number
    if (!p.seriesKey) {
      contribution = p.value
    } else {
      const prev = prevFor(p.seriesKey, p.value)
      if (prev == null) { skippedFirstSeen++; continue }   // baseline only
      contribution = p.value - prev
    }
    if (contribution <= 0) continue                        // no growth / counter reset

    const gk = `${p.source}|${p.model}|${p.correlation ?? ''}|${p.timeNano}`
    let g = groups.get(gk)
    if (!g) {
      g = { source: p.source, model: p.model, correlation: p.correlation, timeNano: p.timeNano, tokens: zeroTokens(), repo: repoFrom(p.ident), tags: allocationTagsFrom(p.ident), email: String(p.ident['user.email'] ?? p.ident['user_email'] ?? '').trim() || null }
      groups.set(gk, g)
    }
    g.tokens[p.field] += contribution
  }

  const rows: UsageRow[] = []
  for (const g of Array.from(groups.values())) {
    const t = g.tokens
    const total = t.input_tokens + t.output_tokens + t.cache_read_tokens + t.cache_write_tokens + t.reasoning_tokens
    if (total <= 0) continue
    const ts = g.timeNano ? new Date(Number(g.timeNano) / 1e6).toISOString() : new Date().toISOString()
    // input_tokens + output_tokens == the "total" token_type exactly, confirmed on a
    // real Codex session (2026-08-10: 13699 + 5 == 13704) — cache_read/cache_write/
    // reasoning are breakdowns OF input/output (OpenAI's usual *_details convention),
    // not additive on top. Pricing them again here would double-count the cached
    // portion, so only input_tokens/output_tokens go into the cost calc; cache/
    // reasoning columns are still stored for an accurate breakdown display.
    // Cached input is a subset of input_tokens: bill that part at the cached rate.
    const cached = Math.min(t.cache_read_tokens, t.input_tokens)
    const cost = computeCost(g.model, t.input_tokens - cached, t.output_tokens, cached)
    rows.push({
      event_id: sha(`${g.source}|${g.correlation ?? ''}|${g.model}|${g.timeNano}`),
      ts, source: g.source, provider_request_id: null, correlation_id: g.correlation, model: g.model,
      input_tokens: t.input_tokens, output_tokens: t.output_tokens,
      cache_read_tokens: t.cache_read_tokens, cache_write_tokens: t.cache_write_tokens, reasoning_tokens: t.reasoning_tokens,
      cost_usd: +cost.toFixed(8), cost_basis: costBasisFor(g.source),
      user_email: g.email, session_id: g.correlation,
      repo: g.repo || null, extra_tags: g.tags,
      billable: { input: t.input_tokens - cached, output: t.output_tokens, cacheRead: cached, cacheWrite: 0 },
      price_known: priceFor(g.model).known,
    })
  }
  return { rows, skippedFirstSeen, claims }
}

// ── Productivity (Claude Code) ───────────────────────────────────────────────

export interface ProductivityDelta {
  user_key: string
  user_id: string | null
  repo: string
  day: string
  lines_added: number
  lines_removed: number
  commits: number
  pull_requests: number
  edits_accepted: number
  edits_rejected: number
  active_seconds: number
  sessions: number
}

export interface ProductivityResult { deltas: ProductivityDelta[]; skippedFirstSeen: number; claims: MetricClaim[] }

// A cumulative series we have never seen is counted in full (rather than only
// baselined) when it is provably new: its process was already observed on an
// earlier export (e.g. a /clear → new session.id series), or the series itself
// started recently. Otherwise (TokenFin connected mid-process, state purged) we
// baseline — never invent history.
const FRESH_SERIES_WINDOW_NS = 5 * 60 * 1e9

const stableJson = (o: Record<string, unknown>) =>
  JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]))

const zeroProd = (user_key: string, user_id: string | null, repo: string, day: string): ProductivityDelta => ({
  user_key, user_id, repo, day,
  lines_added: 0, lines_removed: 0, commits: 0, pull_requests: 0,
  edits_accepted: 0, edits_rejected: 0, active_seconds: 0, sessions: 0,
})

/**
 * Derive per-user·repo·day productivity increments from Claude Code metrics.
 * Delta temporality → the value IS the increment. Cumulative → diffed against
 * otlp_metric_state (same store as token derivation, `prod|` key namespace).
 */
export async function deriveProductivity(body: any, ctx: KeyCtx, state: MetricState): Promise<ProductivityResult> {
  const out = new Map<string, ProductivityDelta>()
  let skippedFirstSeen = 0

  interface Pt { kind: string; value: number; a: Record<string, unknown>; ident: Record<string, unknown>; timeNano: any; startNano: any; seriesKey: string | null; procKey: string | null }
  const points: Pt[] = []
  for (const rm of body?.resourceMetrics ?? []) {
    const resAttrs = attrsToMap(rm?.resource?.attributes ?? [])
    const resJson = stableJson(resAttrs)
    for (const sm of rm?.scopeMetrics ?? []) {
      for (const m of sm?.metrics ?? []) {
        const name = String(m?.name ?? '')
        const kind = PRODUCTIVITY_METRICS[name]
        if (!kind) continue
        const sum = m?.sum
        const dps: any[] = sum?.dataPoints ?? m?.gauge?.dataPoints ?? []
        const isDelta = !!sum && isDeltaTemporality(sum.aggregationTemporality)
        for (const dp of dps) {
          const a = attrsToMap(dp?.attributes ?? [])
          const startNano = dp?.startTimeUnixNano ?? ''
          points.push({
            kind, a, ident: { ...resAttrs, ...a },
            value: num(dp?.asDouble ?? dp?.asInt),
            timeNano: dp?.timeUnixNano ?? '', startNano,
            seriesKey: isDelta ? null : `prod|${name}|${sha(resJson + '|' + stableJson(a))}`,
            procKey: isDelta ? null : `prodproc|${sha(resJson + '|' + String(startNano))}`,
          })
        }
      }
    }
  }

  // One atomic state round trip: every cumulative series, plus a marker per
  // process (value 1) whose previous value says "seen on an earlier export".
  const entries: Array<{ key: string; value: number }> = []
  for (const p of points) {
    if (!p.seriesKey) continue
    entries.push({ key: p.seriesKey, value: p.value }, { key: p.procKey!, value: 1 })
  }
  const { prevFor, claims } = await advanceAll(state, entries)
  const procPrev = new Map<string, number | null>()
  for (const p of points) if (p.procKey && !procPrev.has(p.procKey)) procPrev.set(p.procKey, prevFor(p.procKey, 1))

  for (const p of points) {
    let inc: number
    if (!p.seriesKey) {
      inc = p.value
    } else {
      const prev = prevFor(p.seriesKey, p.value)
      if (prev == null) {
        const recent = !!p.startNano && !!p.timeNano && Number(p.timeNano) - Number(p.startNano) <= FRESH_SERIES_WINDOW_NS
        const procSeen = procPrev.get(p.procKey!) != null
        if (!recent && !procSeen) { skippedFirstSeen++; continue }
        inc = p.value
      } else {
        inc = p.value - prev
      }
    }
    if (!(inc > 0)) continue                // no growth / counter reset / junk

    const a = p.a
    const user_key = userKeyFrom(p.ident)
    const repo = repoFrom(p.ident)
    const day = istDay(p.timeNano, ctx.timezone)
    const gk = `${user_key}|${repo}|${day}`
    let g = out.get(gk)
    if (!g) { g = zeroProd(user_key, ctx.userId, repo, day); out.set(gk, g) }

    switch (p.kind) {
      case 'lines': {
        const t = String(a['type'] ?? '').toLowerCase()
        if (t === 'added') g.lines_added += inc
        else if (t === 'removed') g.lines_removed += inc
        break
      }
      case 'commits':       g.commits += inc; break
      case 'pull_requests': g.pull_requests += inc; break
      case 'edit_decision': {
        const d = String(a['decision'] ?? '').toLowerCase()
        if (d === 'accept') g.edits_accepted += inc
        else if (d === 'reject') g.edits_rejected += inc
        break
      }
      case 'active_time':   g.active_seconds += inc; break
      case 'sessions':      g.sessions += inc; break
    }
  }

  const deltas = Array.from(out.values()).filter(d =>
    d.lines_added || d.lines_removed || d.commits || d.pull_requests ||
    d.edits_accepted || d.edits_rejected || d.active_seconds || d.sessions)
  return { deltas, skippedFirstSeen, claims }
}
