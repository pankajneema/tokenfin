/**
 * "Ask your spend" — turns an AskIntent into a short answer, a small table and
 * a deep link into /dashboard/explore. Data comes from lib/rollups through an
 * injected `AskData` (so this file is pure and unit-testable with fakes).
 *
 * Cost wording: `cost_usd` is everything captured; metered (a real bill) and
 * notional (subscription usage priced at API rates) are always shown apart and
 * never summed into a "bill".
 */
import type { DashBreakdown, DashFilters, DashDimension } from '@/lib/rollups'
import { formatCost, formatNumber, formatTokens } from '@/lib/utils'
import { shiftDay } from '@/lib/dates'
import { resolvePeriod, daysInMonth, type AskIntent, type ResolvedPeriod } from './intents'

export interface AskTotals {
  cost_usd: number
  metered_cost_usd: number
  notional_cost_usd: number
  requests: number
  total_tokens: number
}

export interface AskData {
  summary(from: string, to: string, filters: DashFilters): Promise<AskTotals>
  breakdown(from: string, to: string, dim: DashDimension, filters: DashFilters, limit: number): Promise<DashBreakdown>
  /** Display name for a project id (falls back to the id). */
  projectName(id: string): string
}

export interface AskContext {
  /** Org-local "YYYY-MM-DD". */
  today: string
  /** Non-null for members/viewers: every query is limited to this user_key. */
  scopeUserKey: string | null
}

export interface AskTable { columns: string[]; rows: (string | number)[][] }

export interface AskAnswer {
  intent: AskIntent
  answer: string
  table: AskTable | null
  link: string
  source: 'rules' | 'llm'
}

const DIM_LABEL: Record<string, string> = {
  model: 'Model', project: 'Project', member: 'Member', source: 'Source', repo: 'Repo', agent: 'Agent', day: 'Day',
}

/** rollups filter → Explore URL param (lib/explore FILTER_TO_DASH, inverted). */
const EXPLORE_PARAM: Partial<Record<keyof DashFilters, string>> = {
  project_id: 'project', user_key: 'member', model: 'model', source: 'source', repo: 'repo', agent: 'agent',
}

/** Deep link into Explore (lib/explore parseExploreParams format) with the matching filters. */
export function exploreLink(p: { from: string; to: string; dim?: string; filters?: DashFilters }): string {
  const sp = new URLSearchParams()
  if (p.dim) sp.set('dim', p.dim)
  sp.set('range', 'custom'); sp.set('from', p.from); sp.set('to', p.to)
  for (const [k, v] of Object.entries(p.filters ?? {})) {
    const key = EXPLORE_PARAM[k as keyof DashFilters]
    if (v && key) sp.set(key, String(v))
  }
  return `/dashboard/explore?${sp.toString()}`
}

function costLine(t: AskTotals): string {
  const parts: string[] = []
  if (t.metered_cost_usd > 0) parts.push(`${formatCost(t.metered_cost_usd)} metered`)
  if (t.notional_cost_usd > 0) parts.push(`${formatCost(t.notional_cost_usd)} notional (subscription usage at API rates, not a bill)`)
  return parts.length > 1 ? ` (${parts.join(' + ')})` : parts.length === 1 && t.notional_cost_usd > 0 ? ' — all notional (subscription usage at API rates, not a bill)' : ''
}

function pctChange(curr: number, prev: number): string {
  if (prev <= 0) return curr > 0 ? 'new spend (nothing in the previous period)' : 'no change'
  const p = ((curr - prev) / prev) * 100
  return `${p >= 0 ? 'up' : 'down'} ${Math.abs(p).toFixed(1)}%`
}

function keyLabel(dim: string, key: string, data: AskData): string {
  if (dim === 'project') return key === '00000000-0000-0000-0000-000000000000' || !key ? '(no project)' : data.projectName(key)
  return key || '(unknown)'
}

function scoped(ctx: AskContext, extra?: DashFilters): DashFilters {
  return { ...(extra ?? {}), ...(ctx.scopeUserKey ? { user_key: ctx.scopeUserKey } : {}) }
}

const scopeNote = (ctx: AskContext) => ctx.scopeUserKey ? ' (your own usage — members only see their own spend)' : ''

async function breakdownAnswer(
  intent: AskIntent, dim: DashDimension, n: number, per: ResolvedPeriod, data: AskData, ctx: AskContext, title: (rows: number) => string,
): Promise<Omit<AskAnswer, 'source'>> {
  const filters = scoped(ctx)
  const bd = await data.breakdown(per.from, per.to, dim, filters, dim === 'day' ? 400 : n)
  const rows = dim === 'day' ? bd.rows : bd.rows.slice(0, n)
  const link = exploreLink({ from: per.from, to: per.to, dim, filters })
  if (rows.length === 0) {
    return { intent, answer: `No usage recorded ${per.label}${scopeNote(ctx)}.`, table: null, link }
  }
  const lead = rows[0]
  const answer = dim === 'day'
    ? `${title(rows.length)}: ${formatCost(rows.reduce((s, r) => s + r.cost_usd, 0))} over ${rows.length} day${rows.length === 1 ? '' : 's'}${scopeNote(ctx)}.`
    : `${title(rows.length)} ${per.label}: ${keyLabel(dim, lead.key, data)} leads with ${formatCost(lead.cost_usd)}${scopeNote(ctx)}.`
  return {
    intent, answer, link,
    table: {
      columns: [DIM_LABEL[dim] ?? dim, 'Cost', 'Metered', 'Notional', 'Requests', 'Tokens'],
      rows: rows.map(r => [keyLabel(dim, r.key, data), formatCost(r.cost_usd), formatCost(r.metered_cost_usd), formatCost(r.notional_cost_usd), formatNumber(r.requests), formatTokens(r.total_tokens)]),
    },
  }
}

/** Answer one intent. Throws only if the data layer throws. */
export async function answerIntent(intent: AskIntent, data: AskData, ctx: AskContext): Promise<Omit<AskAnswer, 'source'>> {
  switch (intent.kind) {
    case 'total': {
      const per = resolvePeriod(intent.period, ctx.today)
      const filters = scoped(ctx)
      const t = await data.summary(per.from, per.to, filters)
      return {
        intent,
        answer: `${ctx.scopeUserKey ? 'You' : 'Your org'} spent ${formatCost(t.cost_usd)} ${per.label}${costLine(t)} across ${formatNumber(t.requests)} requests.`,
        table: { columns: ['Period', 'Cost', 'Metered', 'Notional', 'Requests', 'Tokens'],
          rows: [[`${per.from} → ${per.to}`, formatCost(t.cost_usd), formatCost(t.metered_cost_usd), formatCost(t.notional_cost_usd), formatNumber(t.requests), formatTokens(t.total_tokens)]] },
        link: exploreLink({ from: per.from, to: per.to, dim: 'day', filters }),
      }
    }

    case 'spend_by': {
      const per = resolvePeriod(intent.period, ctx.today)
      return breakdownAnswer(intent, intent.dim, 10, per, data, ctx,
        () => intent.dim === 'day' ? `Daily spend ${per.label}` : `Spend by ${intent.dim}`)
    }

    case 'top': {
      const per = resolvePeriod(intent.period, ctx.today)
      return breakdownAnswer(intent, intent.dim, intent.n, per, data, ctx,
        rows => `Top ${Math.min(rows, intent.n)} ${intent.dim}${intent.n === 1 ? '' : 's'}`)
    }

    case 'compare': {
      const today = ctx.today
      let curr: ResolvedPeriod, prev: ResolvedPeriod
      if (intent.unit === 'week') {
        curr = resolvePeriod({ kind: 'this_week' }, today)
        const span = Math.round((Date.parse(curr.to) - Date.parse(curr.from)) / 86_400_000)
        const pFrom = shiftDay(curr.from, -7)
        prev = { from: pFrom, to: shiftDay(pFrom, span), label: 'the same days last week' }
      } else {
        curr = resolvePeriod({ kind: 'this_month' }, today)
        const lm = resolvePeriod({ kind: 'last_month' }, today)
        const dayOfMonth = Number(today.slice(8, 10))
        const lastDay = Math.min(dayOfMonth, daysInMonth(lm.from))
        prev = { from: lm.from, to: lm.from.slice(0, 8) + String(lastDay).padStart(2, '0'), label: 'the same days last month' }
      }
      const filters = scoped(ctx)
      const [a, b] = await Promise.all([data.summary(curr.from, curr.to, filters), data.summary(prev.from, prev.to, filters)])
      return {
        intent,
        answer: `${intent.unit === 'week' ? 'This week' : 'This month'} so far: ${formatCost(a.cost_usd)} vs ${formatCost(b.cost_usd)} over ${prev.label} — ${pctChange(a.cost_usd, b.cost_usd)}${scopeNote(ctx)}.`,
        table: {
          columns: ['Period', 'Cost', 'Metered', 'Notional', 'Requests', 'Tokens'],
          rows: [
            [`${curr.from} → ${curr.to}`, formatCost(a.cost_usd), formatCost(a.metered_cost_usd), formatCost(a.notional_cost_usd), formatNumber(a.requests), formatTokens(a.total_tokens)],
            [`${prev.from} → ${prev.to}`, formatCost(b.cost_usd), formatCost(b.metered_cost_usd), formatCost(b.notional_cost_usd), formatNumber(b.requests), formatTokens(b.total_tokens)],
          ],
        },
        link: exploreLink({ from: prev.from, to: curr.to, dim: 'day', filters }),
      }
    }

    case 'mtd': {
      const per = resolvePeriod({ kind: 'this_month' }, ctx.today)
      const filters = scoped(ctx)
      const t = await data.summary(per.from, per.to, filters)
      const elapsed = Number(ctx.today.slice(8, 10))
      const total = daysInMonth(ctx.today)
      const proj = (v: number) => elapsed > 0 ? (v / elapsed) * total : 0
      return {
        intent,
        answer: `Month to date: ${formatCost(t.cost_usd)}${costLine(t)}. At this pace the month ends near ${formatCost(proj(t.cost_usd))}` +
          `${t.metered_cost_usd > 0 ? ` (${formatCost(proj(t.metered_cost_usd))} metered)` : ''} — a straight-line projection over ${elapsed} of ${total} days${scopeNote(ctx)}.`,
        table: {
          columns: ['', 'Cost', 'Metered', 'Notional'],
          rows: [
            ['Month to date', formatCost(t.cost_usd), formatCost(t.metered_cost_usd), formatCost(t.notional_cost_usd)],
            ['Projected month', formatCost(proj(t.cost_usd)), formatCost(proj(t.metered_cost_usd)), formatCost(proj(t.notional_cost_usd))],
          ],
        },
        link: exploreLink({ from: per.from, to: per.to, dim: 'day', filters }),
      }
    }

    case 'member_spend': {
      const per = resolvePeriod(intent.period, ctx.today)
      const wantSelf = intent.member === 'me'
      // Members may only ask about themselves.
      if (ctx.scopeUserKey || wantSelf) {
        if (!ctx.scopeUserKey && wantSelf) {
          return { intent, answer: 'Ask about a teammate by name or email, e.g. “how much did alice spend last week?”', table: null, link: exploreLink({ from: per.from, to: per.to, dim: 'member' }) }
        }
        const selfKey = ctx.scopeUserKey!
        const asksOther = !wantSelf && !selfKey.includes(intent.member.toLowerCase())
        const t = await data.summary(per.from, per.to, { user_key: selfKey })
        return {
          intent,
          answer: (asksOther ? 'You can only see your own spend. ' : '') + `You spent ${formatCost(t.cost_usd)} ${per.label}${costLine(t)}.`,
          table: null,
          link: exploreLink({ from: per.from, to: per.to, dim: 'day', filters: { user_key: selfKey } }),
        }
      }
      const needle = intent.member.toLowerCase()
      const bd = await data.breakdown(per.from, per.to, 'member', {}, 500)
      const tokens = needle.split(/\s+/).filter(Boolean)
      const hits = bd.rows.filter(r => {
        const k = r.key.toLowerCase()
        return k === needle || tokens.every(t => k.includes(t))
      })
      if (hits.length === 0) {
        return { intent, answer: `No spend found for “${intent.member}” ${per.label}.`, table: null, link: exploreLink({ from: per.from, to: per.to, dim: 'member' }) }
      }
      if (hits.length > 1) {
        return {
          intent,
          answer: `${hits.length} members match “${intent.member}” ${per.label}; together ${formatCost(hits.reduce((s, r) => s + r.cost_usd, 0))}.`,
          table: { columns: ['Member', 'Cost', 'Metered', 'Notional', 'Requests'], rows: hits.slice(0, 10).map(r => [r.key, formatCost(r.cost_usd), formatCost(r.metered_cost_usd), formatCost(r.notional_cost_usd), formatNumber(r.requests)]) },
          link: exploreLink({ from: per.from, to: per.to, dim: 'member' }),
        }
      }
      const h = hits[0]
      return {
        intent,
        answer: `${h.key} spent ${formatCost(h.cost_usd)} ${per.label}${costLine(h)} across ${formatNumber(h.requests)} requests.`,
        table: { columns: ['Member', 'Cost', 'Metered', 'Notional', 'Requests', 'Tokens'], rows: [[h.key, formatCost(h.cost_usd), formatCost(h.metered_cost_usd), formatCost(h.notional_cost_usd), formatNumber(h.requests), formatTokens(h.total_tokens)]] },
        link: exploreLink({ from: per.from, to: per.to, dim: 'model', filters: { user_key: h.key } }),
      }
    }
  }
}

/** Shown when neither the parser nor the LLM mapper found an intent. */
export const ASK_EXAMPLES = [
  'How much did we spend last week?',
  'Spend by model this month',
  'Top 5 projects last 30 days',
  'Compare this week vs last week',
  'How much did alice spend?',
  'MTD and projected',
]
