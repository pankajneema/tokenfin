/**
 * Weekly digest — pure summary + formatting (no I/O). The covered week is the
 * last complete ISO week (Mon 00:00 UTC → next Mon 00:00 UTC) before `now`,
 * compared with the ISO week before it.
 */
import { countPrompts } from '@/lib/prompts'

const DAY = 86400_000

export interface DigestEvent {
  id: string; correlation_id?: string | null
  user_id?: string | null; user_email?: string | null
  project_id: string | null; model?: string | null
  cost_basis?: string | null; cost_usd: number | string; created_at: string
}

export interface DigestBudget {
  label: string; period: string; spent: number; budget: number; pct: number
  projectedPct: number; exceedDate: string | null
}

export interface Ranked { label: string; cost: number; prevCost: number }
export interface Mover extends Ranked { kind: 'member' | 'model' | 'project'; delta: number; pct: number | null }

export interface DigestSummary {
  weekKey: string
  from: string; to: string                   // inclusive UTC dates of the covered week
  cost: number; metered: number; notional: number
  prevCost: number; costPct: number | null
  prompts: number; prevPrompts: number
  calls: number; prevCalls: number
  topMembers: Ranked[]; topModels: Ranked[]; topProjects: Ranked[]
  movers: Mover[]
  budgets: DigestBudget[]
}

/** ISO-8601 week key (e.g. 2026-W39) for the week containing `d` (UTC). */
export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dow = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - dow)            // Thursday decides the year
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((t.getTime() - yearStart) / DAY + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** Bounds of the last complete ISO week before `now` and the one before it. */
export function digestWindow(now: Date = new Date()) {
  const d0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const dow = new Date(d0).getUTCDay() || 7
  const thisMonday = d0 - (dow - 1) * DAY
  const start = thisMonday - 7 * DAY
  const prevStart = start - 7 * DAY
  const iso = (ms: number) => new Date(ms).toISOString()
  return {
    weekKey: isoWeekKey(new Date(start)),
    startTs: iso(start), endTs: iso(thisMonday), prevStartTs: iso(prevStart),
    from: iso(start).slice(0, 10), to: iso(thisMonday - DAY).slice(0, 10),
  }
}

const round = (n: number) => +n.toFixed(4)
const pctChange = (cur: number, prev: number) => prev > 0 ? +(((cur - prev) / prev) * 100).toFixed(1) : null

function sumBy(evs: DigestEvent[], key: (e: DigestEvent) => string | null): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of evs) {
    const k = key(e)
    if (!k) continue
    m.set(k, (m.get(k) ?? 0) + Number(e.cost_usd))
  }
  return m
}

export function buildDigest(
  events: readonly DigestEvent[],
  opts: {
    now?: Date
    projectName?: ReadonlyMap<string, string>
    emailByUser?: ReadonlyMap<string, string>
    budgets?: DigestBudget[]
    top?: number
  } = {},
): DigestSummary {
  const w = digestWindow(opts.now)
  const top = opts.top ?? 5
  const cur  = events.filter(e => e.created_at >= w.startTs && e.created_at < w.endTs) as DigestEvent[]
  const prev = events.filter(e => e.created_at >= w.prevStartTs && e.created_at < w.startTs) as DigestEvent[]

  const cost = cur.reduce((s, e) => s + Number(e.cost_usd), 0)
  const notional = cur.filter(e => e.cost_basis === 'notional').reduce((s, e) => s + Number(e.cost_usd), 0)
  const prevCost = prev.reduce((s, e) => s + Number(e.cost_usd), 0)

  const memberKey = (e: DigestEvent) =>
    (e.user_email && e.user_email.toLowerCase()) || (e.user_id ? (opts.emailByUser?.get(e.user_id)?.toLowerCase() ?? e.user_id) : null)
  const dims: { kind: Mover['kind']; key: (e: DigestEvent) => string | null; label: (k: string) => string }[] = [
    { kind: 'member',  key: memberKey,                label: k => k },
    { kind: 'model',   key: e => e.model ?? null,     label: k => k },
    { kind: 'project', key: e => e.project_id,        label: k => opts.projectName?.get(k) ?? 'Unknown project' },
  ]

  const ranked: Record<Mover['kind'], Ranked[]> = { member: [], model: [], project: [] }
  const movers: Mover[] = []
  for (const d of dims) {
    const c = sumBy(cur, d.key), p = sumBy(prev, d.key)
    ranked[d.kind] = Array.from(c.entries())
      .map(([k, v]) => ({ label: d.label(k), cost: round(v), prevCost: round(p.get(k) ?? 0) }))
      .sort((a, b) => b.cost - a.cost).slice(0, top)
    const keys = new Set([...Array.from(c.keys()), ...Array.from(p.keys())])
    for (const k of Array.from(keys)) {
      const cv = c.get(k) ?? 0, pv = p.get(k) ?? 0
      const delta = cv - pv
      // Ignore noise: sub-cent changes and moves under 5% of last week.
      if (Math.abs(delta) < 0.01 || (pv > 0 && Math.abs(delta) / pv < 0.05)) continue
      movers.push({ kind: d.kind, label: d.label(k), cost: round(cv), prevCost: round(pv), delta: round(delta), pct: pctChange(cv, pv) })
    }
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  return {
    weekKey: w.weekKey, from: w.from, to: w.to,
    cost: round(cost), metered: round(cost - notional), notional: round(notional),
    prevCost: round(prevCost), costPct: pctChange(cost, prevCost),
    prompts: countPrompts(cur), prevPrompts: countPrompts(prev),
    calls: cur.length, prevCalls: prev.length,
    topMembers: ranked.member, topModels: ranked.model, topProjects: ranked.project,
    movers: movers.slice(0, top),
    budgets: opts.budgets ?? [],
  }
}

/** Nothing worth sending: no spend either week and no budget concerns. */
export function isEmptyDigest(s: DigestSummary): boolean {
  return s.calls === 0 && s.prevCalls === 0 && s.budgets.length === 0
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const $ = (n: number) => `$${n.toFixed(2)}`
const chg = (p: number | null) => p == null ? 'new' : Math.abs(p) < 0.5 ? 'flat' : `${p > 0 ? '+' : ''}${p.toFixed(0)}%`
const list = (rows: Ranked[]) => rows.length
  ? rows.map((r, i) => `  ${i + 1}. ${r.label} — ${$(r.cost)}${r.prevCost > 0 ? ` (${chg(pctChange(r.cost, r.prevCost))})` : ''}`).join('\n')
  : '  (none)'

export function digestTitle(s: DigestSummary): string {
  return `Weekly digest · ${s.weekKey}`
}

/** Plain-text body — used for email, in-app and Slack. */
export function digestText(s: DigestSummary, appUrl?: string): string {
  const lines = [
    `Week ${s.from} → ${s.to} (UTC), vs the week before.`,
    '',
    `Spend: ${$(s.cost)} (${chg(s.costPct)} vs ${$(s.prevCost)})`,
    `  metered ${$(s.metered)} · notional ${$(s.notional)} (subscription usage at API rates, not a bill)`,
    `Prompts: ${s.prompts.toLocaleString()} (prev ${s.prevPrompts.toLocaleString()}) · LLM calls: ${s.calls.toLocaleString()} (prev ${s.prevCalls.toLocaleString()})`,
    '',
    'Top members:', list(s.topMembers),
    'Top models:',  list(s.topModels),
    'Top projects:', list(s.topProjects),
  ]
  if (s.movers.length) {
    lines.push('Biggest movers:')
    for (const m of s.movers) lines.push(`  ${m.delta >= 0 ? '▲' : '▼'} ${m.kind} ${m.label}: ${$(m.prevCost)} → ${$(m.cost)} (${chg(m.pct)})`)
  }
  if (s.budgets.length) {
    lines.push('Budgets near limit:')
    for (const b of s.budgets) {
      lines.push(`  • ${b.label} (${b.period}): ${$(b.spent)} of ${$(b.budget)} (${b.pct.toFixed(0)}%), projected ${b.projectedPct.toFixed(0)}%` +
        (b.spent >= b.budget ? ' — over budget' : b.exceedDate ? ` — runs out ${b.exceedDate}` : ''))
    }
  }
  if (appUrl) lines.push('', `Open TokenFin: ${appUrl.replace(/\/$/, '')}/dashboard/analytics`)
  lines.push('', 'Manage this email in Settings → Notifications.')
  return lines.join('\n')
}
