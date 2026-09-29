'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, Compass, Download, ExternalLink, AlertTriangle, ChevronRight } from 'lucide-react'
import { cn, formatCost, formatNumber, formatTokens } from '@/lib/utils'
import {
  EXPLORE_DIMS, DIM_LABELS, dimFilterKey, rowsToCsv, sortRows,
  type ExploreDim, type ExploreRow, type ExploreSortKey,
} from '@/lib/explore'
import { FilterBar, RangePicker, useUrlState } from '@/components/filters'
import { DailyStackChart } from './_chart'
import type { ExploreData } from './_types'

const CARD = 'rounded-2xl border border-[var(--border)] bg-white p-5 dark:bg-[#141428]'

/** Where each dimension lives elsewhere in the app. */
const DIM_PAGES: Partial<Record<ExploreDim, { href: string; label: string }>> = {
  model: { href: '/dashboard/analytics/models', label: 'Model analytics' },
  project: { href: '/dashboard/analytics/projects', label: 'Project analytics' },
  member: { href: '/dashboard/teams', label: 'Teams' },
  day: { href: '/dashboard/analytics/costs', label: 'Daily costs' },
  cost_basis: { href: '/dashboard/analytics/reconciliation', label: 'Bill check' },
}

const COLS: { k: ExploreSortKey; label: string; title?: string }[] = [
  { k: 'metered_cost_usd', label: 'Metered cost', title: 'Billed usage (API keys, vendor-reported)' },
  { k: 'notional_cost_usd', label: 'Notional cost', title: 'Subscription usage priced at API rates — not a bill' },
  { k: 'total_tokens', label: 'Tokens' },
  { k: 'requests', label: 'Requests' },
  { k: 'prompts', label: 'Prompts', title: 'Distinct prompts (top 20 rows of filterable dimensions)' },
  { k: 'share_pct', label: 'Share', title: 'Share of total cost (metered + notional) in this view' },
]

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={cn(CARD, 'p-4')}>
      <p className="text-[11.5px] font-medium text-[var(--fg-secondary)]">{label}</p>
      <p className="mt-1 text-[20px] font-bold tracking-tight text-[var(--fg)]">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">{hint}</p>}
    </div>
  )
}

export function ExploreClient({ data }: { data: ExploreData }) {
  const { state, totals, rows, from, to } = data
  const { update, pending } = useUrlState()
  const [sort, setSort] = useState<{ k: ExploreSortKey; asc: boolean }>(
    state.dim === 'day' ? { k: 'label', asc: true } : { k: 'metered_cost_usd', asc: false })

  const sorted = useMemo(() => sortRows(rows, sort.k, sort.asc), [rows, sort])
  const fk = dimFilterKey(state.dim)
  const hasData = totals.requests > 0

  const canOpenMember = (key: string) =>
    !!key && (data.memberLinkKeys === null || data.memberLinkKeys.includes(key))

  const drill = (r: ExploreRow) => {
    if (state.dim === 'day') return update({ range: 'custom', from: r.key, to: r.key, dim: null })
    if (!fk || !r.key) return
    update({ [fk]: r.key, dim: state.dim === 'model' ? 'project' : null })
  }
  const drillable = (r: ExploreRow) => state.dim === 'day' || (!!fk && !!r.key)

  const downloadCsv = () => {
    const blob = new Blob([rowsToCsv(state.dim, sorted)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tokenfin-explore-${state.dim}-${from}_${to}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const toggleSort = (k: ExploreSortKey) =>
    setSort(s => s.k === k ? { k, asc: !s.asc } : { k, asc: k === 'label' })

  const dimPage = DIM_PAGES[state.dim]

  return (
    <div className="space-y-5" aria-busy={pending || undefined}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold tracking-tight text-[var(--fg)]">Explore</h2>
          <p className="mt-0.5 text-[13px] text-[var(--fg-secondary)]">
            Slice spend by any dimension · {from} → {to} ({data.timezone})
          </p>
        </div>
        <nav aria-label="Related pages" className="flex flex-wrap gap-3 text-[12.5px]">
          <Link href="/dashboard/analytics/costs" className="text-teal hover:underline">Daily costs</Link>
          <Link href="/dashboard/sessions" className="text-teal hover:underline">Sessions</Link>
          <Link href="/dashboard/analytics/prompts" className="text-teal hover:underline">Prompts</Link>
        </nav>
      </div>

      {data.errors.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-[var(--amber)] bg-[var(--amber-bg)] px-3 py-2 text-[12.5px] text-[var(--fg)]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--amber)]" aria-hidden />
          <ul>{data.errors.map(e => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[12.5px] text-[var(--fg-secondary)]">
          Group by
          <select
            value={state.dim}
            onChange={e => update({ dim: e.target.value === 'model' ? null : e.target.value })}
            className="h-8 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-[12.5px] font-medium text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue)]"
          >
            {EXPLORE_DIMS.map(d => <option key={d} value={d}>{DIM_LABELS[d]}</option>)}
          </select>
        </label>
        <RangePicker range={state.range} from={from} to={to} />
      </div>

      <FilterBar fields={data.filterFields} />

      {!hasData ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-12 text-center">
          <Compass size={24} className="mx-auto mb-3 text-[var(--fg-tertiary)]" aria-hidden />
          <p className="text-[14px] font-semibold text-[var(--fg)]">No usage in this view</p>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-[var(--fg-secondary)]">
            Widen the date range or clear filters. New workspaces: run{' '}
            <code className="rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 font-mono text-[11.5px]">npx tokenfin@latest setup</code>{' '}
            or send events via POST /api/v1/ingest to see data here.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Metered cost" value={formatCost(totals.metered_cost_usd)} hint="billed usage" />
            <Kpi label="Notional cost" value={formatCost(totals.notional_cost_usd)} hint="subscription, at API rates" />
            <Kpi label="Tokens" value={formatTokens(totals.total_tokens)} />
            <Kpi label="Requests" value={formatNumber(totals.requests)} />
            <Kpi label="Prompts" value={formatNumber(totals.prompts)} />
            <Kpi label="Sessions" value={formatNumber(totals.sessions)} hint={`${formatNumber(totals.active_users)} active users`} />
          </div>

          <section className={CARD} aria-labelledby="explore-chart-h">
            <h2 id="explore-chart-h" className="mb-3 text-[14px] font-semibold text-[var(--fg)]">
              Daily {data.stacks ? `by ${DIM_LABELS[state.dim].toLowerCase()}` : 'spend (metered vs notional)'}
            </h2>
            <DailyStackChart total={data.total} stacks={data.stacks} />
          </section>

          <section className={CARD} aria-labelledby="explore-table-h">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="explore-table-h" className="text-[14px] font-semibold text-[var(--fg)]">
                By {DIM_LABELS[state.dim].toLowerCase()}
                <span className="ml-2 text-[12px] font-normal text-[var(--fg-tertiary)]">
                  {rows.length}{data.other ? ` of ${rows.length + data.other.keys}` : ''} rows
                  {state.dim === 'day' || fk ? ' · click a row to drill in' : ''}
                </span>
              </h2>
              <div className="flex items-center gap-3">
                {dimPage && (
                  <Link href={dimPage.href} className="inline-flex items-center gap-1 text-[12px] text-teal hover:underline">
                    {dimPage.label} <ExternalLink size={11} aria-hidden />
                  </Link>
                )}
                <button type="button" onClick={downloadCsv}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-[12px] font-medium text-[var(--fg)] outline-none hover:bg-[var(--bg-secondary)] focus-visible:ring-2 focus-visible:ring-[var(--blue)]">
                  <Download size={12} aria-hidden /> CSV
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[11.5px] text-[var(--fg-secondary)]">
                    {[{ k: 'label' as ExploreSortKey, label: DIM_LABELS[state.dim] }, ...COLS].map(c => (
                      <th key={c.k} scope="col" className={cn('py-2 pr-3 font-medium', c.k !== 'label' && 'text-right')}
                        aria-sort={sort.k === c.k ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" onClick={() => toggleSort(c.k)} title={'title' in c ? c.title : undefined}
                          className="inline-flex items-center gap-1 rounded outline-none hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--blue)]">
                          {c.label}
                          {sort.k === c.k && (sort.asc ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />)}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(r => (
                    <tr key={r.key || '__none'} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-secondary)]">
                      <td className="max-w-[340px] py-2 pr-3">
                        <RowLabel r={r} dim={state.dim} canDrill={drillable(r)} onDrill={() => drill(r)}
                          memberHref={state.dim === 'member' && canOpenMember(r.key) ? `/dashboard/members/${encodeURIComponent(r.key)}` : null} />
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">{formatCost(r.metered_cost_usd)}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-[var(--fg-secondary)]">{formatCost(r.notional_cost_usd)}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">{formatTokens(r.total_tokens)}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">{formatNumber(r.requests)}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">{r.prompts == null ? '—' : formatNumber(r.prompts)}</td>
                      <td className="py-2 text-right">
                        <span className="inline-flex items-center justify-end gap-2">
                          <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-[var(--bg-tertiary)] sm:inline-block" aria-hidden>
                            <span className="block h-full bg-coral" style={{ width: `${Math.min(100, r.share_pct)}%` }} />
                          </span>
                          <span className="w-11 font-mono tabular-nums">{r.share_pct}%</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                  {data.other && (
                    <tr className="text-[var(--fg-tertiary)]">
                      <td className="py-2 pr-3 italic">{formatNumber(data.other.keys)} more</td>
                      <td className="py-2 pr-3 text-right font-mono">{formatCost(data.other.metered_cost_usd)}</td>
                      <td className="py-2 pr-3 text-right font-mono">{formatCost(data.other.notional_cost_usd)}</td>
                      <td className="py-2 pr-3 text-right font-mono">{formatTokens(data.other.total_tokens)}</td>
                      <td className="py-2 pr-3 text-right font-mono">{formatNumber(data.other.requests)}</td>
                      <td className="py-2 pr-3 text-right">—</td>
                      <td className="py-2 text-right">—</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {(state.dim === 'skill' || state.dim === 'mcp_server' || state.dim === 'cost_basis') && (
              <p className="mt-3 text-[11.5px] text-[var(--fg-tertiary)]">
                {DIM_LABELS[state.dim]} can&apos;t be used as a filter, so rows aren&apos;t drillable and prompts aren&apos;t attributed per row.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function RowLabel({ r, dim, canDrill, onDrill, memberHref }: {
  r: ExploreRow; dim: ExploreDim; canDrill: boolean; onDrill: () => void; memberHref: string | null
}) {
  const text = <span className={cn('truncate', dim === 'day' || dim === 'model' || dim === 'repo' ? 'font-mono text-[12px]' : '')} title={r.key || undefined}>{r.label}</span>
  if (memberHref) {
    return (
      <Link href={memberHref} className="inline-flex max-w-full items-center gap-1 rounded font-medium text-[var(--fg)] outline-none hover:text-teal focus-visible:ring-2 focus-visible:ring-[var(--blue)]">
        {text}<ChevronRight size={12} className="shrink-0 text-[var(--fg-tertiary)]" aria-hidden />
      </Link>
    )
  }
  if (canDrill) {
    return (
      <button type="button" onClick={onDrill}
        aria-label={dim === 'day' ? `Show ${r.label} by model` : `Filter by ${DIM_LABELS[dim].toLowerCase()} ${r.label}`}
        className="inline-flex max-w-full items-center gap-1 rounded text-left font-medium text-[var(--fg)] outline-none hover:text-teal focus-visible:ring-2 focus-visible:ring-[var(--blue)]">
        {text}
      </button>
    )
  }
  return <span className="inline-flex max-w-full text-[var(--fg)]">{text}</span>
}
