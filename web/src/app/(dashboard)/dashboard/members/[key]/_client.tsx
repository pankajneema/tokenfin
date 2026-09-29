'use client'
import Link from 'next/link'
import { ArrowLeft, Compass, Terminal } from 'lucide-react'
import { cn, formatCost, formatNumber, formatTokens } from '@/lib/utils'
import { exploreHref } from '@/lib/explore'
import { DailyStackChart } from '../../explore/_chart'
import type { ChartTotalPoint } from '../../explore/_types'

interface Slice { key: string; label: string; metered_cost_usd: number; notional_cost_usd: number; total_tokens: number; requests: number; share_pct: number }

export interface MemberData {
  key: string
  label: string
  isSelf: boolean
  timezone: string
  from30: string
  today: string
  mtdFrom: string
  mtd: { metered_cost_usd: number; notional_cost_usd: number; total_tokens: number; requests: number }
  d30: { metered_cost_usd: number; notional_cost_usd: number; total_tokens: number; requests: number; prompts: number; sessions: number; active_days: number }
  series: ChartTotalPoint[]
  models: Slice[]
  projects: Slice[]
  sessions: {
    total: number
    rows: { session_id: string; first_at: string; last_at: string; model: string; source: string; repo: string; project: string; requests: number; total_tokens: number; cost_usd: number }[]
  }
}

const CARD = 'rounded-2xl border border-[var(--border)] bg-white p-5 dark:bg-[#141428]'
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={cn(CARD, 'p-4')}>
      <p className="text-[11.5px] font-medium text-[var(--fg-secondary)]">{label}</p>
      <p className="mt-1 text-[20px] font-bold tracking-tight text-[var(--fg)]">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">{hint}</p>}
    </div>
  )
}

function SliceTable({ title, rows, dim, memberKey }: { title: string; rows: Slice[]; dim: 'model' | 'project'; memberKey: string }) {
  return (
    <section className={CARD} aria-label={title}>
      <h2 className="mb-3 text-[14px] font-semibold text-[var(--fg)]">{title}</h2>
      {rows.length === 0 ? <p className="text-[12.5px] text-[var(--fg-tertiary)]">No usage in the last 30 days.</p> : (
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-[11.5px] text-[var(--fg-secondary)]">
              <th scope="col" className="py-2 pr-3 font-medium">{dim === 'model' ? 'Model' : 'Project'}</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Metered</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Notional</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Tokens</th>
              <th scope="col" className="py-2 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key || '__none'} className="border-b border-[var(--border)] last:border-0">
                <td className="max-w-[220px] truncate py-2 pr-3">
                  {r.key ? (
                    <Link className="hover:text-teal" href={exploreHref({ dim: dim === 'model' ? 'project' : 'model', range: 30, filters: { member: memberKey, [dim]: r.key } })}>
                      {r.label}
                    </Link>
                  ) : r.label}
                </td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">{formatCost(r.metered_cost_usd)}</td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums text-[var(--fg-secondary)]">{formatCost(r.notional_cost_usd)}</td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">{formatTokens(r.total_tokens)}</td>
                <td className="py-2 text-right font-mono tabular-nums">{r.share_pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

export function MemberClient({ data }: { data: MemberData }) {
  const hasData = data.d30.requests > 0 || data.mtd.requests > 0
  return (
    <div className="space-y-5">
      <div>
        <Link href={data.isSelf ? '/dashboard/my-usage' : '/dashboard/explore?dim=member'} className="inline-flex items-center gap-1 text-[12.5px] text-teal">
          <ArrowLeft size={13} aria-hidden /> {data.isSelf ? 'My usage' : 'All members'}
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[22px] font-bold tracking-tight text-[var(--fg)]">{data.label}</h2>
            <p className="mt-0.5 text-[13px] text-[var(--fg-secondary)]">Last 30 days · {data.from30} → {data.today} ({data.timezone})</p>
          </div>
          <Link href={exploreHref({ dim: 'model', range: 30, filters: { member: data.key } })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--fg)] hover:bg-[var(--bg-secondary)]">
            <Compass size={12} aria-hidden /> Open in Explore
          </Link>
        </div>
      </div>

      {!hasData ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-12 text-center">
          <p className="text-[14px] font-semibold text-[var(--fg)]">No usage for this member in the last 30 days</p>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] text-[var(--fg-secondary)]">
            Usage is attributed by the email (or user id) on each event. Connect with <code className="font-mono">npx tokenfin@latest setup</code>.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Metered · MTD" value={formatCost(data.mtd.metered_cost_usd)} hint={`since ${data.mtdFrom}`} />
            <Kpi label="Notional · MTD" value={formatCost(data.mtd.notional_cost_usd)} hint="subscription, at API rates" />
            <Kpi label="Metered · 30d" value={formatCost(data.d30.metered_cost_usd)} />
            <Kpi label="Notional · 30d" value={formatCost(data.d30.notional_cost_usd)} />
            <Kpi label="Tokens · 30d" value={formatTokens(data.d30.total_tokens)} hint={`${formatNumber(data.d30.requests)} requests`} />
            <Kpi label="Prompts · 30d" value={formatNumber(data.d30.prompts)} hint={`${formatNumber(data.d30.sessions)} sessions · ${data.d30.active_days} active days`} />
          </div>

          <section className={CARD} aria-labelledby="member-chart-h">
            <h2 id="member-chart-h" className="mb-3 text-[14px] font-semibold text-[var(--fg)]">Daily spend</h2>
            <DailyStackChart total={data.series} stacks={null} height={220} />
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <SliceTable title="Models" rows={data.models} dim="model" memberKey={data.key} />
            <SliceTable title="Projects" rows={data.projects} dim="project" memberKey={data.key} />
          </div>

          <section className={CARD} aria-labelledby="member-sessions-h">
            <h2 id="member-sessions-h" className="mb-3 text-[14px] font-semibold text-[var(--fg)]">
              Recent sessions <span className="ml-1 text-[12px] font-normal text-[var(--fg-tertiary)]">{formatNumber(data.sessions.total)} in 30 days</span>
            </h2>
            {data.sessions.rows.length === 0 ? (
              <p className="flex items-center gap-2 text-[12.5px] text-[var(--fg-tertiary)]"><Terminal size={13} aria-hidden /> No agent sessions (sessions come from CLI-agent telemetry).</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-[11.5px] text-[var(--fg-secondary)]">
                      <th scope="col" className="py-2 pr-3 font-medium">Last active</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Model</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Source · repo</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Project</th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">Requests</th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">Tokens</th>
                      <th scope="col" className="py-2 text-right font-medium" title="All cost bases (metered + notional)">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sessions.rows.map(s => (
                      <tr key={s.session_id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-secondary)]">
                        <td className="py-2 pr-3">
                          <Link href={`/dashboard/sessions/${encodeURIComponent(s.session_id)}`} className="font-medium text-[var(--fg)] hover:text-teal">{fmtWhen(s.last_at)}</Link>
                        </td>
                        <td className="py-2 pr-3 font-mono text-[12px]">{s.model || '—'}</td>
                        <td className="max-w-[220px] truncate py-2 pr-3 text-[var(--fg-secondary)]">{[s.source, s.repo].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="py-2 pr-3 text-[var(--fg-secondary)]">{s.project}</td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">{formatNumber(s.requests)}</td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">{formatTokens(s.total_tokens)}</td>
                        <td className="py-2 text-right font-mono tabular-nums">{formatCost(s.cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
