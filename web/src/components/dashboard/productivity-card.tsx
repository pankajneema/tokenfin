// Engineering-impact helpers + a compact card. Pure (no hooks, no 'use client'),
// so server pages can aggregate with it and client pages can render it.
import Link from 'next/link'
import { GitCommit, GitPullRequest, Code2 } from 'lucide-react'

/** One productivity_daily row (migration 007). */
export type ProductivityRow = {
  user_key: string
  user_id: string | null
  repo: string | null
  day: string
  lines_added: number | string | null
  lines_removed: number | string | null
  commits: number | string | null
  pull_requests: number | string | null
  edits_accepted: number | string | null
  edits_rejected: number | string | null
  active_seconds: number | string | null
  sessions: number | string | null
}

export const PRODUCTIVITY_COLUMNS =
  'user_key,user_id,repo,day,lines_added,lines_removed,commits,pull_requests,edits_accepted,edits_rejected,active_seconds,sessions'

export interface ProductivityTotals {
  linesAdded: number
  linesRemoved: number
  commits: number
  prs: number
  editsAccepted: number
  editsRejected: number
  activeSeconds: number
  sessions: number
}

export const emptyTotals = (): ProductivityTotals => ({
  linesAdded: 0, linesRemoved: 0, commits: 0, prs: 0,
  editsAccepted: 0, editsRejected: 0, activeSeconds: 0, sessions: 0,
})

const n = (v: number | string | null | undefined) => Number(v ?? 0) || 0

export function addRow(t: ProductivityTotals, r: ProductivityRow): ProductivityTotals {
  t.linesAdded    += n(r.lines_added)
  t.linesRemoved  += n(r.lines_removed)
  t.commits       += n(r.commits)
  t.prs           += n(r.pull_requests)
  t.editsAccepted += n(r.edits_accepted)
  t.editsRejected += n(r.edits_rejected)
  t.activeSeconds += n(r.active_seconds)
  t.sessions      += n(r.sessions)
  return t
}

export const sumProductivity = (rows: readonly ProductivityRow[]): ProductivityTotals =>
  rows.reduce((t, r) => addRow(t, r), emptyTotals())

/** Accept rate in %, or null when no edit decisions were recorded. */
export const acceptRate = (t: ProductivityTotals): number | null => {
  const d = t.editsAccepted + t.editsRejected
  return d > 0 ? +((t.editsAccepted / d) * 100).toFixed(1) : null
}

/** Cost per unit, or null when there is no unit to divide by. */
export const costPer = (cost: number, units: number, scale = 1): number | null =>
  units > 0 ? cost / (units / scale) : null

export const fmtUsd = (v: number | null) => v == null ? '—' : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`
export const fmtNum = (v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}K` : v.toLocaleString()

/** Compact personal / scoped productivity card. */
export function ProductivityCard({ totals, cost, title = 'Engineering impact', href = '/dashboard/productivity' }: {
  totals: ProductivityTotals; cost: number; title?: string; href?: string
}) {
  const items = [
    { icon: Code2,          label: 'Lines added',   value: `+${fmtNum(totals.linesAdded)}`, sub: `−${fmtNum(totals.linesRemoved)} removed` },
    { icon: GitCommit,      label: 'Commits',       value: fmtNum(totals.commits),          sub: `${fmtUsd(costPer(cost, totals.commits))} / commit` },
    { icon: GitPullRequest, label: 'Pull requests', value: fmtNum(totals.prs),              sub: `${fmtUsd(costPer(cost, totals.prs))} / PR` },
    { icon: Code2,          label: 'Cost / 1k lines', value: fmtUsd(costPer(cost, totals.linesAdded, 1000)), sub: 'AI spend ÷ lines added' },
  ]
  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[13px] font-bold text-[var(--fg)]">{title}</p>
        <Link href={href} className="text-[11.5px] font-semibold text-coral hover:underline">Details →</Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {items.map(i => (
          <div key={i.label} className="bg-[var(--bg-secondary)] rounded-xl px-3 py-2.5">
            <p className="flex items-center gap-1 text-[10px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wide"><i.icon size={11} />{i.label}</p>
            <p className="text-[17px] font-bold tabular-nums text-[var(--fg)] mt-0.5">{i.value}</p>
            <p className="text-[10.5px] text-[var(--fg-tertiary)]">{i.sub}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
