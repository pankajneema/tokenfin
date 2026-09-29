'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Code2, GitCommit, GitPullRequest, CheckCircle2, Clock, Activity,
  DollarSign, ArrowUpDown, Terminal,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { acceptRate, costPer, fmtNum, fmtUsd } from '@/components/dashboard/productivity-card'
import { MergedPrs } from '@/components/dashboard/merged-prs'
import type { MergedPrData } from '@/lib/connectors/merged-prs'
import type { ImpactData, ImpactRow, ImpactDay } from './page'

type SortKey = 'label' | 'linesAdded' | 'linesRemoved' | 'commits' | 'prs' | 'accept' | 'hours' | 'cost' | 'costPerPr'

const sortVal = (r: ImpactRow, k: SortKey): number | string => {
  switch (k) {
    case 'label':     return r.label.toLowerCase()
    case 'accept':    return acceptRate(r) ?? -1
    case 'hours':     return r.activeSeconds
    case 'costPerPr': return costPer(r.cost, r.prs) ?? Number.POSITIVE_INFINITY
    default:          return r[k]
  }
}

export function ProductivityClient({ data, prs }: { data: ImpactData; prs: MergedPrData }) {
  const { totals: t, cost } = data
  const hasData = data.members.length > 0 || data.repos.length > 0
  const rate = acceptRate(t)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Engineering impact</h2>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">What AI-assisted coding produced over the last {data.days} days — and what it cost.</p>
        </div>
        <div className="flex items-center gap-1 bg-[var(--bg-secondary)] rounded-xl p-1">
          {[7, 30, 90].map(d => (
            <Link key={d} href={`/dashboard/productivity?days=${d}`}
              className={cn('px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors',
                data.days === d ? 'bg-white dark:bg-[#141428] text-[var(--fg)] shadow-sm' : 'text-[var(--fg-tertiary)] hover:text-[var(--fg)]')}>
              {d}D
            </Link>
          ))}
        </div>
      </div>

      {!hasData ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-12 text-center">
          <Terminal size={24} className="mx-auto mb-3 text-[var(--fg-tertiary)]" />
          <p className="text-[14px] font-semibold text-[var(--fg)]">No productivity data in the last {data.days} days</p>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-[var(--fg-secondary)]">
            Productivity data comes from Claude Code telemetry — run <code className="rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 font-mono text-[11.5px]">npx tokenfin@latest setup</code> and use Claude Code.
            Lines of code, commits, pull requests and edit decisions appear here as they are reported.
          </p>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <Kpi icon={Code2}          label="Lines added"   value={`+${fmtNum(t.linesAdded)}`} tone="green" />
            <Kpi icon={Code2}          label="Lines removed" value={`−${fmtNum(t.linesRemoved)}`} tone="red" />
            <Kpi icon={GitCommit}      label="Commits"       value={fmtNum(t.commits)} />
            <Kpi icon={GitPullRequest} label="Pull requests" value={fmtNum(t.prs)} />
            <Kpi icon={CheckCircle2}   label="Edit accept rate" value={rate == null ? '—' : `${rate.toFixed(1)}%`}
              sub={`${fmtNum(t.editsAccepted)} of ${fmtNum(t.editsAccepted + t.editsRejected)}`} />
            <Kpi icon={Clock}          label="Active hours"  value={(t.activeSeconds / 3600).toFixed(1)} />
            <Kpi icon={Activity}       label="Sessions"      value={fmtNum(t.sessions)} />
          </div>

          {/* ROI */}
          <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign size={14} className="text-coral" />
              <p className="text-[13px] font-bold text-[var(--fg)]">Return on AI spend</p>
            </div>
            <p className="text-[11px] text-[var(--fg-tertiary)] mb-4">
              AI spend = all usage events in the window ({fmtUsd(cost)}), including notional subscription usage priced at API rates.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <Roi label="AI spend" value={fmtUsd(cost)} />
              <Roi label="Cost per PR" value={fmtUsd(costPer(cost, t.prs))} />
              <Roi label="Cost per commit" value={fmtUsd(costPer(cost, t.commits))} />
              <Roi label="Cost per 1k lines added" value={fmtUsd(costPer(cost, t.linesAdded, 1000))} />
            </div>
          </div>

          <DailyChart days={data.daily} />

          <ImpactTable title="By member" firstCol="Member" rows={data.members} />
          <ImpactTable title="By repository" firstCol="Repository" rows={data.repos} />
        </>
      )}
      <MergedPrs data={prs} />
    </div>
  )
}

function Kpi({ icon: Icon, label, value, sub, tone }: { icon: React.ElementType; label: string; value: string; sub?: string; tone?: 'green' | 'red' }) {
  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--fg-tertiary)] mb-2"><Icon size={13} />{label}</div>
      <div className={cn('text-[20px] font-bold tabular-nums',
        tone === 'green' ? 'text-[var(--green)]' : tone === 'red' ? 'text-[var(--red)]' : 'text-[var(--fg)]')}>{value}</div>
      {sub && <div className="text-[10.5px] text-[var(--fg-tertiary)] mt-0.5">{sub}</div>}
    </div>
  )
}

function Roi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--bg-secondary)] rounded-xl px-4 py-3">
      <p className="text-[10.5px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wide">{label}</p>
      <p className="text-[18px] font-bold tabular-nums text-[var(--fg)] mt-0.5">{value}</p>
    </div>
  )
}

/* ── Daily chart: lines added (up) / removed (down) bars + commit dots ── */
function DailyChart({ days }: { days: ImpactDay[] }) {
  const [hov, setHov] = useState<number | null>(null)
  const W = 900, H = 200, PL = 44, PR = 12, PT = 12, PB = 26
  const pw = W - PL - PR, ph = H - PT - PB
  const maxUp   = Math.max(1, ...days.map(d => d.linesAdded))
  const maxDown = Math.max(1, ...days.map(d => d.linesRemoved))
  const scale   = ph / (maxUp + maxDown)
  const zeroY   = PT + maxUp * scale
  const bw      = pw / Math.max(1, days.length)
  const h       = hov != null ? days[hov] : null
  const labelEvery = Math.ceil(days.length / 10)

  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="text-[13px] font-bold text-[var(--fg)]">Daily lines changed</p>
        <p className="text-[11.5px] text-[var(--fg-tertiary)] tabular-nums">
          {h ? <>{h.day} · <span className="text-[var(--green)]">+{h.linesAdded.toLocaleString()}</span> / <span className="text-[var(--red)]">−{h.linesRemoved.toLocaleString()}</span> · {h.commits} commits · {h.prs} PRs · {fmtUsd(h.cost)}</>
            : 'Hover a day for details'}
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" onMouseLeave={() => setHov(null)}>
        <line x1={PL} x2={W - PR} y1={zeroY} y2={zeroY} stroke="var(--border-strong)" strokeWidth={1} />
        <text x={PL - 6} y={PT + 8} textAnchor="end" fontSize={10} fill="var(--fg-tertiary)">+{fmtNum(maxUp)}</text>
        <text x={PL - 6} y={H - PB} textAnchor="end" fontSize={10} fill="var(--fg-tertiary)">−{fmtNum(maxDown)}</text>
        {days.map((d, i) => {
          const x = PL + i * bw
          const upH = d.linesAdded * scale, downH = d.linesRemoved * scale
          return (
            <g key={d.day} onMouseEnter={() => setHov(i)}>
              <rect x={x} y={PT} width={bw} height={ph} fill={hov === i ? 'var(--bg-secondary)' : 'transparent'} />
              <rect x={x + bw * 0.15} y={zeroY - upH} width={bw * 0.7} height={upH} rx={2} fill="var(--green)" opacity={0.8} />
              <rect x={x + bw * 0.15} y={zeroY} width={bw * 0.7} height={downH} rx={2} fill="var(--red)" opacity={0.6} />
              {d.commits > 0 && <circle cx={x + bw / 2} cy={zeroY - upH - 5} r={2.5} fill="var(--blue)" />}
              {i % labelEvery === 0 && (
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--fg-tertiary)">{d.day.slice(5)}</text>
              )}
            </g>
          )
        })}
      </svg>
      <div className="flex gap-4 mt-2 text-[11px] text-[var(--fg-tertiary)]">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--green)]" />Added</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--red)] opacity-60" />Removed</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[var(--blue)]" />Commit day</span>
      </div>
    </div>
  )
}

/* ── Sortable impact table ── */
function ImpactTable({ title, firstCol, rows }: { title: string; firstCol: string; rows: ImpactRow[] }) {
  const [sort, setSort] = useState<{ k: SortKey; asc: boolean }>({ k: 'linesAdded', asc: false })
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const va = sortVal(a, sort.k), vb = sortVal(b, sort.k)
    const c = va < vb ? -1 : va > vb ? 1 : 0
    return sort.asc ? c : -c
  }), [rows, sort])

  const cols: { k: SortKey; label: string; right?: boolean }[] = [
    { k: 'label', label: firstCol },
    { k: 'linesAdded', label: 'Added', right: true },
    { k: 'linesRemoved', label: 'Removed', right: true },
    { k: 'commits', label: 'Commits', right: true },
    { k: 'prs', label: 'PRs', right: true },
    { k: 'accept', label: 'Accept %', right: true },
    { k: 'hours', label: 'Active h', right: true },
    { k: 'cost', label: 'AI spend', right: true },
    { k: 'costPerPr', label: '$ / PR', right: true },
  ]

  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5">
      <p className="text-[13px] font-bold text-[var(--fg)] mb-3">{title}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {cols.map(c => (
                <th key={c.k} className={cn('py-2 px-2 first:pl-0 last:pr-0 text-[10.5px] uppercase tracking-wide font-semibold text-[var(--fg-tertiary)]', c.right ? 'text-right' : 'text-left')}>
                  <button onClick={() => setSort(s => ({ k: c.k, asc: s.k === c.k ? !s.asc : c.k === 'label' }))}
                    className={cn('inline-flex items-center gap-1 hover:text-[var(--fg)]', sort.k === c.k && 'text-[var(--fg)]')}>
                    {c.label}<ArrowUpDown size={10} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => {
              const ar = acceptRate(r)
              return (
                <tr key={r.key} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-secondary)]">
                  <td className="py-2 pr-2">
                    <p className="font-semibold text-[var(--fg)] truncate max-w-[220px]">{r.label}</p>
                    {r.sub && <p className="text-[10.5px] text-[var(--fg-tertiary)] truncate max-w-[220px]">{r.sub}</p>}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-[var(--green)]">+{r.linesAdded.toLocaleString()}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-[var(--red)]">−{r.linesRemoved.toLocaleString()}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{r.commits.toLocaleString()}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{r.prs.toLocaleString()}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{ar == null ? '—' : `${ar.toFixed(1)}%`}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{(r.activeSeconds / 3600).toFixed(1)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(r.cost)}</td>
                  <td className="py-2 pl-2 text-right tabular-nums font-semibold">{fmtUsd(costPer(r.cost, r.prs))}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
