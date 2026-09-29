/**
 * "Ask your spend" — deterministic intent parser.
 *
 * Maps a free-text question to one of a handful of intents that lib/ask/answer
 * can answer from lib/rollups. Pure (no I/O), so it is unit-tested directly.
 * The optional LLM mapper (lib/ask/llm) only ever produces one of these same
 * intents, validated by `askIntentSchema`.
 */
import { z } from 'zod'
import { shiftDay } from '@/lib/dates'

/* ── Periods ─────────────────────────────────────────────────── */

export const periodSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('today') }),
  z.object({ kind: z.literal('yesterday') }),
  z.object({ kind: z.literal('this_week') }),
  z.object({ kind: z.literal('last_week') }),
  z.object({ kind: z.literal('this_month') }),
  z.object({ kind: z.literal('last_month') }),
  z.object({ kind: z.literal('last_n_days'), n: z.number().int().min(1).max(366) }),
])
export type PeriodSpec = z.infer<typeof periodSchema>

export const DEFAULT_PERIOD: PeriodSpec = { kind: 'last_n_days', n: 30 }

export interface ResolvedPeriod { from: string; to: string; label: string }

/** Monday of the ISO week containing `day` (YYYY-MM-DD). */
function weekStart(day: string): string {
  const dow = new Date(day + 'T00:00:00Z').getUTCDay() // 0 = Sun
  return shiftDay(day, -((dow + 6) % 7))
}
function monthStart(day: string): string { return day.slice(0, 8) + '01' }
export function daysInMonth(day: string): number {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7))
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Resolve a period against the org-local `today` label. `from`/`to` inclusive. */
export function resolvePeriod(p: PeriodSpec, today: string): ResolvedPeriod {
  switch (p.kind) {
    case 'today':      return { from: today, to: today, label: 'today' }
    case 'yesterday':  { const y = shiftDay(today, -1); return { from: y, to: y, label: 'yesterday' } }
    case 'this_week':  return { from: weekStart(today), to: today, label: 'this week' }
    case 'last_week':  { const s = shiftDay(weekStart(today), -7); return { from: s, to: shiftDay(s, 6), label: 'last week' } }
    case 'this_month': return { from: monthStart(today), to: today, label: 'this month' }
    case 'last_month': {
      const end = shiftDay(monthStart(today), -1)
      return { from: monthStart(end), to: end, label: 'last month' }
    }
    case 'last_n_days':
      return { from: shiftDay(today, -(p.n - 1)), to: today, label: p.n === 1 ? 'today' : `in the last ${p.n} days` }
  }
}

/* ── Intents ─────────────────────────────────────────────────── */

export const ASK_DIMS = ['model', 'project', 'member', 'source', 'repo', 'agent', 'day'] as const
export type AskDim = typeof ASK_DIMS[number]
export const TOP_DIMS = ['model', 'project', 'member', 'source', 'repo', 'agent'] as const

export const askIntentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('total'),        period: periodSchema }),
  z.object({ kind: z.literal('spend_by'),     dim: z.enum(ASK_DIMS), period: periodSchema }),
  z.object({ kind: z.literal('top'),          dim: z.enum(TOP_DIMS), n: z.number().int().min(1).max(50), period: periodSchema }),
  z.object({ kind: z.literal('compare'),      unit: z.enum(['week', 'month']) }),
  z.object({ kind: z.literal('member_spend'), member: z.string().min(1).max(120), period: periodSchema }),
  z.object({ kind: z.literal('mtd') }),
])
export type AskIntent = z.infer<typeof askIntentSchema>

const DIM_WORDS: [RegExp, AskDim][] = [
  [/^(models?|llms?)$/, 'model'],
  [/^(projects?|apps?|applications?)$/, 'project'],
  [/^(members?|users?|people|persons?|engineers?|developers?|devs?|teammates?|spenders?)$/, 'member'],
  [/^(sources?|tools?|platforms?|clients?|clis?)$/, 'source'],
  [/^(repos?|repositories|repository)$/, 'repo'],
  [/^(agents?)$/, 'agent'],
  [/^(days?|daily|dates?)$/, 'day'],
]
function dimFromWord(w: string): AskDim | null {
  for (const [re, d] of DIM_WORDS) if (re.test(w)) return d
  return null
}

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  twenty: 20, thirty: 30, ninety: 90,
}
const num = (s: string | undefined): number | null => {
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s)
  return NUM_WORDS[s] ?? null
}

/** Extract a period mentioned anywhere in the question (null when none). */
export function parsePeriod(q: string): PeriodSpec | null {
  if (/\btoday\b/.test(q)) return { kind: 'today' }
  if (/\byesterday\b/.test(q)) return { kind: 'yesterday' }
  if (/\b(this|current)\s+week\b|\bweek[- ]to[- ]date\b|\bwtd\b/.test(q)) return { kind: 'this_week' }
  if (/\b(last|previous|past|prior)\s+week\b/.test(q)) return { kind: 'last_week' }
  if (/\b(this|current)\s+month\b|\bmonth[- ]to[- ]date\b|\bmtd\b/.test(q)) return { kind: 'this_month' }
  if (/\b(last|previous|prior)\s+month\b/.test(q)) return { kind: 'last_month' }
  const m = q.match(/\b(?:last|past|previous|over the last|in the last)\s+(\d+|[a-z]+)\s+(days?|weeks?|months?)\b/)
  if (m) {
    const n = num(m[1])
    if (n) {
      const days = m[2].startsWith('week') ? n * 7 : m[2].startsWith('month') ? n * 30 : n
      return { kind: 'last_n_days', n: Math.min(366, Math.max(1, days)) }
    }
  }
  if (/\b(past|last)\s+quarter\b/.test(q)) return { kind: 'last_n_days', n: 90 }
  if (/\b(past|last)\s+year\b/.test(q)) return { kind: 'last_n_days', n: 365 }
  return null
}

const SELF = new Set(['i', 'me', 'we', 'us', 'you', 'the team', 'our team', 'everyone', 'the org', 'our org', 'it', 'they'])

/** Deterministic parse. Returns null when the question matches no intent. */
export function parseQuestion(raw: string): AskIntent | null {
  const q = raw.toLowerCase().replace(/[?!.]+$/g, '').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()
  if (!q) return null
  const explicit = parsePeriod(q)
  const period = explicit ?? DEFAULT_PERIOD

  // Compare this vs last week/month.
  if (/\b(compare|compared|comparison|vs\.?|versus|change|trend|up or down|increase|decrease)\b/.test(q)) {
    if (/\bweek/.test(q)) return { kind: 'compare', unit: 'week' }
    if (/\bmonth/.test(q)) return { kind: 'compare', unit: 'month' }
  }
  // MTD / projection.
  if (/\b(projected|projection|forecast|on track|run[- ]?rate|end of (the )?month|by month end|month end)\b/.test(q)) {
    return { kind: 'mtd' }
  }

  // Top N <dim>.
  const top = q.match(/\b(?:top|biggest|largest|most expensive|highest)\s+(?:(\d+|[a-z]+)\s+)?([a-z]+)/)
  if (top) {
    const n = num(top[1])
    let word = top[2]
    if (n == null && top[1]) word = top[1]   // "top models this month"
    const dim = dimFromWord(word)
    if (dim && dim !== 'day') return { kind: 'top', dim, n: Math.min(50, n ?? 5), period }
  }
  if (/\bwho (spent|spends|used|uses|is spending|burned) (the )?most\b|\bbiggest spenders?\b/.test(q)) {
    return { kind: 'top', dim: 'member', n: 5, period }
  }
  if (/\bwhich (model|project|repo|tool|agent)s? (cost|costs|spent|used|is|was) (the )?most\b/.test(q)) {
    const dim = dimFromWord(q.match(/\bwhich ([a-z]+)/)![1])!
    return { kind: 'top', dim: dim as typeof TOP_DIMS[number], n: 1, period }
  }

  // "how much did <member> spend", "<member>'s spend".
  const hm = q.match(/\bhow much (?:did|has|have|does|do|is)\s+(.+?)\s+(?:spend|spent|spending|cost|used|use|burn|burned)\b/)
  const poss = q.match(/^(?:what (?:is|was|did)\s+)?([a-z0-9._@+-]+(?:\s[a-z0-9._@+-]+)?)'s\s+(?:spend|spending|cost|usage)\b/)
  const who = (hm?.[1] ?? poss?.[1] ?? '').trim()
  if (who && !SELF.has(who) && !/\b(we|our|the org|the team|total|everyone|all)\b/.test(who)) {
    return { kind: 'member_spend', member: who.replace(/^@/, ''), period }
  }

  // Spend by <dim>.
  const by = q.match(/\b(?:by|per|across|split by|broken down by|breakdown by|grouped by|for each|each)\s+([a-z]+)/)
  if (by) {
    const dim = dimFromWord(by[1])
    if (dim) return { kind: 'spend_by', dim, period }
  }
  const bd = q.match(/\b([a-z]+) (?:breakdown|split)\b/)
  if (bd) {
    const dim = dimFromWord(bd[1])
    if (dim) return { kind: 'spend_by', dim, period }
  }

  // Plain totals (MTD words → the MTD + projection answer).
  if (/\b(mtd|month[- ]to[- ]date)\b/.test(q)) return { kind: 'mtd' }
  if (/\b(how much|total|spend|spent|spending|cost|costs|bill|usage)\b/.test(q)) {
    if (/\b(i|me|my)\b/.test(q) && /\b(did i|have i|my)\b/.test(q)) return { kind: 'member_spend', member: 'me', period }
    return { kind: 'total', period }
  }
  return null
}

/** True if the text reads like a question for "Ask" rather than a page search. */
export function looksLikeQuestion(raw: string): boolean {
  const q = raw.trim().toLowerCase()
  if (q.length < 4) return false
  if (q.endsWith('?')) return true
  if (/^(how|what|who|which|when|why|show|compare|top|list|give)\b/.test(q)) return true
  return parseQuestion(q) != null && q.split(/\s+/).length >= 3
}
