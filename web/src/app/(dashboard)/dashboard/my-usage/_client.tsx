'use client'

import { DollarSign, Hash, Activity, Sparkles, MessageSquare, CalendarDays, AlertTriangle } from 'lucide-react'
import type { ModelSlice, DayPoint, PromptRow, CostTotals } from './_types'
import { SavingsCard } from '@/components/dashboard/savings-card'
import { CacheEfficiency, type CacheStats } from '@/components/dashboard/cache-efficiency'
import { ProductivityCard, type ProductivityTotals } from '@/components/dashboard/productivity-card'
import { basisLine } from '@/components/dashboard/cost-basis'
import { formatCost, formatTokens, formatNumber } from '@/lib/utils'

type Props =
  | { error: string; name: string }
  | {
    error?: undefined
    name: string; timezone: string
    last30: CostTotals; mtd: CostTotals; projected: number | null; costTrend: number | null
    totalTokens: number; requests: number; promptCount: number
    models: ModelSlice[]; days: DayPoint[]; prompts: PromptRow[]
    costSaved: number; tokensSaved: number; savingsRate: number; savingsMeasured: boolean
    cache: CacheStats; productivity: ProductivityTotals | null
  }

export function MyUsageClient(props: Props) {
  if (props.error !== undefined) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="mb-1 text-[19px] font-bold text-[var(--fg)]">My usage</div>
        <div className="mt-5 rounded-2xl border border-[var(--red)]/30 bg-[var(--red-bg)] p-5">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--red)]"><AlertTriangle size={14} /> Couldn’t load your usage</p>
          <p className="mt-1 text-[12px] text-[var(--fg-secondary)]">The usage rollups did not respond ({props.error}). Reload in a moment.</p>
        </div>
      </div>
    )
  }

  const { name, timezone, last30, mtd, projected, costTrend, totalTokens, requests, promptCount, models, days, prompts,
    costSaved, tokensSaved, savingsRate, savingsMeasured, cache, productivity } = props
  const empty = requests === 0 && mtd.cost === 0
  const topModel = models[0]
  const maxDay = Math.max(...days.map(d => d.cost), 0.0001)

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-1 text-[19px] font-bold text-[var(--fg)]">My usage</div>
      <p className="mb-6 text-[13px] text-[var(--fg-secondary)]">Your personal AI spend · days in {timezone}.</p>

      {empty ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-10 text-center">
          <Sparkles size={22} className="mx-auto mb-3 text-[var(--fg-tertiary)]" />
          <p className="text-[14px] font-semibold text-[var(--fg)]">No usage attributed to you in the last 30 days</p>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] text-[var(--fg-secondary)]">
            Usage is matched to you by your sign-in email (or your user id). Run{' '}
            <code className="font-mono">npx tokenfin setup</code> on your machine, or send requests with your personal API key,
            and your spend, models and prompts show up here.
          </p>
        </div>
      ) : (
        <>
          {/* Plain-English summary */}
          <div className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--green-bg)] p-4 text-[13.5px] text-[var(--fg)]">
            Hi {name} — in the last 30 days you’ve used <span className="font-bold">{formatCost(last30.cost)}</span> across{' '}
            <span className="font-bold">{formatTokens(totalTokens)}</span> tokens, {formatNumber(promptCount)} prompts and {formatNumber(requests)} LLM calls
            {topModel && <>, mostly on <span className="font-bold">{topModel.model}</span> ({formatCost(topModel.cost)})</>}.
            {last30.notional > 0 && <> Subscription usage is shown <span className="font-semibold">notional (at API rates)</span> — it is not a bill.</>}
          </div>

          {/* KPI cards — dollars first */}
          <div className="mb-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Kpi icon={CalendarDays} label="Month to date" value={formatCost(mtd.cost)}
              sub={projected != null ? `Projected end of month ${formatCost(projected)}` : 'Projection after 3 days of data'}
              sub2={basisLine(mtd.metered, mtd.notional)} />
            <Kpi icon={DollarSign} label="Last 30 days" value={formatCost(last30.cost)}
              sub={costTrend != null ? `${costTrend >= 0 ? '+' : ''}${costTrend}% vs the 30 days before` : 'No earlier 30 days to compare'}
              sub2={basisLine(last30.metered, last30.notional)} />
            <Kpi icon={Hash} label="Tokens · 30d" value={formatTokens(totalTokens)} sub={`${formatNumber(totalTokens)} total`} />
            <Kpi icon={MessageSquare} label="Prompts · 30d" value={formatNumber(promptCount)} sub={promptCount > 0 ? `${formatCost(last30.cost / promptCount)} per prompt` : undefined} />
            <Kpi icon={Activity} label="LLM calls · 30d" value={formatNumber(requests)} sub={promptCount > 0 ? `${(requests / promptCount).toFixed(1)} calls per prompt` : undefined} />
          </div>

          {costSaved > 0 && (
            <div className="mb-5">
              <SavingsCard costSaved={costSaved} tokensSaved={tokensSaved} savingsRate={savingsRate} measured={savingsMeasured} />
            </div>
          )}

          {productivity && (
            <div className="mb-5">
              <ProductivityCard totals={productivity} cost={last30.cost} title="Your engineering impact (30d)" />
            </div>
          )}

          <div className="mb-5">
            <CacheEfficiency stats={cache} title="Your cache efficiency" />
          </div>

          {/* Daily trend */}
          <Panel title="Daily spend · last 30 days">
            <div className="flex h-28 items-end gap-[3px]">
              {days.map(d => (
                <div key={d.day} className="group relative flex-1" title={`${d.day}: ${formatCost(d.cost)}`}>
                  <div className="rounded-t bg-teal/70 transition-colors group-hover:bg-teal"
                    style={{ height: `${Math.max((d.cost / maxDay) * 100, 1)}%` }} />
                </div>
              ))}
            </div>
          </Panel>

          {/* Model breakdown */}
          <Panel title="By model · last 30 days">
            <div className="space-y-2.5">
              {models.map(m => (
                <div key={m.model}>
                  <div className="mb-1 flex justify-between text-[12.5px]">
                    <span className="font-medium text-[var(--fg)]">{m.model}</span>
                    <span className="text-[var(--fg-secondary)]">{formatCost(m.cost)} · {formatTokens(m.tokens)} tok · {formatNumber(m.requests)} call{m.requests === 1 ? '' : 's'}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
                    <div className="h-full rounded-full bg-coral" style={{ width: `${(m.cost / (models[0]?.cost || 1)) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          {/* Top prompts */}
          {prompts.length > 0 && (
            <Panel title="Top prompts by cost · last 30 days">
              <div className="space-y-1.5">
                {prompts.map(p => (
                  <div key={p.hash} className="flex justify-between gap-3 text-[12.5px]">
                    <code className="truncate font-mono text-[var(--fg-secondary)]">{p.hash.slice(0, 16)}</code>
                    <span className="shrink-0 text-[var(--fg)]">{formatCost(p.cost)} · {formatNumber(p.requests)} call{p.requests === 1 ? '' : 's'} · {p.model}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  )
}

function Kpi({ icon: Icon, label, value, sub, sub2 }: { icon: React.ElementType; label: string; value: string; sub?: string; sub2?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--fg-tertiary)]"><Icon size={13} />{label}</div>
      <div className="text-[22px] font-bold text-[var(--fg)]">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">{sub}</div>}
      {sub2 && <div className="mt-0.5 text-[10.5px] text-[var(--fg-tertiary)]">{sub2}</div>}
    </div>
  )
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
      <div className="mb-3 text-[13px] font-semibold text-[var(--fg)]">{title}</div>
      {children}
    </div>
  )
}
