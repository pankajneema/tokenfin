'use client'

import { DollarSign, Hash, Activity, Sparkles } from 'lucide-react'
import type { ModelSlice, DayPoint, PromptRow } from './page'
import { SavingsCard } from '@/components/dashboard/savings-card'

const fmtUsd = (n: number) => n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`
const fmtTok = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`

export function MyUsageClient({ name, totalCost, totalTokens, requests, models, days, prompts, costSaved, tokensSaved, savingsRate, savingsMeasured }: {
  name: string; totalCost: number; totalTokens: number; requests: number
  models: ModelSlice[]; days: DayPoint[]; prompts: PromptRow[]
  costSaved: number; tokensSaved: number; savingsRate: number; savingsMeasured: boolean
}) {
  const empty = requests === 0
  const topModel = models[0]
  const maxDay = Math.max(...days.map(d => d.cost), 0.0001)

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-1 text-[19px] font-bold text-[var(--fg)]">My usage</div>
      <p className="mb-6 text-[13px] text-[var(--fg-secondary)]">Your personal AI spend over the last 30 days.</p>

      {empty ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-10 text-center">
          <Sparkles size={22} className="mx-auto mb-3 text-[var(--fg-tertiary)]" />
          <p className="text-[14px] font-semibold text-[var(--fg)]">No usage attributed to you yet</p>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] text-[var(--fg-secondary)]">
            Once you send requests with your personal API key, your spend, models, and prompts show up here.
          </p>
        </div>
      ) : (
        <>
          {/* Plain-English summary */}
          <div className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--green-bg)] p-4 text-[13.5px] text-[var(--fg)]">
            Hi {name} — you’ve spent <span className="font-bold">{fmtUsd(totalCost)}</span> across{' '}
            <span className="font-bold">{fmtTok(totalTokens)}</span> tokens and {requests.toLocaleString()} requests this month
            {topModel && <>, mostly on <span className="font-bold">{topModel.model}</span> ({fmtUsd(topModel.cost)})</>}.
          </div>

          {/* KPI cards — dollars first */}
          <div className="mb-5 grid grid-cols-3 gap-3">
            <Kpi icon={DollarSign} label="Spend (30d)" value={fmtUsd(totalCost)} />
            <Kpi icon={Hash} label="Tokens" value={fmtTok(totalTokens)} sub={`${totalTokens.toLocaleString()} total`} />
            <Kpi icon={Activity} label="Requests" value={requests.toLocaleString()} />
          </div>

          {costSaved > 0 && (
            <div className="mb-5">
              <SavingsCard costSaved={costSaved} tokensSaved={tokensSaved} savingsRate={savingsRate} measured={savingsMeasured} />
            </div>
          )}

          {/* Daily trend */}
          <Panel title="Daily spend">
            <div className="flex h-28 items-end gap-[3px]">
              {days.map(d => (
                <div key={d.day} className="group relative flex-1" title={`${d.day}: ${fmtUsd(d.cost)}`}>
                  <div className="rounded-t bg-teal/70 transition-colors group-hover:bg-teal"
                    style={{ height: `${Math.max((d.cost / maxDay) * 100, 1)}%` }} />
                </div>
              ))}
            </div>
          </Panel>

          {/* Model breakdown */}
          <Panel title="By model">
            <div className="space-y-2.5">
              {models.map(m => (
                <div key={m.model}>
                  <div className="mb-1 flex justify-between text-[12.5px]">
                    <span className="font-medium text-[var(--fg)]">{m.model}</span>
                    <span className="text-[var(--fg-secondary)]">{fmtUsd(m.cost)} · {fmtTok(m.tokens)} tok · {m.requests} req</span>
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
            <Panel title="Top prompts (by cost)">
              <div className="space-y-1.5">
                {prompts.map(p => (
                  <div key={p.hash} className="flex justify-between text-[12.5px]">
                    <code className="font-mono text-[var(--fg-secondary)]">{p.hash.slice(0, 16)}</code>
                    <span className="text-[var(--fg)]">{fmtUsd(p.cost)} · {p.requests} req · {p.model}</span>
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

function Kpi({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--fg-tertiary)]"><Icon size={13} />{label}</div>
      <div className="text-[22px] font-bold text-[var(--fg)]">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">{sub}</div>}
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
