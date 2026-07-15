'use client'

import { PiggyBank, BadgeCheck, Sparkles, ArrowDownToLine, MessageSquare } from 'lucide-react'
import type { DayPoint } from './page'

const fmtUsd = (n: number) => n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`
const fmtTok = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`

interface Props {
  hasData: boolean; costSaved: number; inputCostSaved: number; outputCostSaved: number
  tokensSaved: number; inputTokensSaved: number; outputTokensSaved: number
  savingsRate: number; outputSavingsPct: number | null; measured: boolean
  optimizedRequests: number; holdoutRequests: number; days: DayPoint[]
}

export function SavingsClient(p: Props) {
  if (!p.hasData) {
    return (
      <div className="mx-auto max-w-4xl">
        <Header />
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-10 text-center">
          <PiggyBank size={22} className="mx-auto mb-3 text-[var(--fg-tertiary)]" />
          <p className="text-[14px] font-semibold text-[var(--fg)]">No savings recorded yet</p>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] text-[var(--fg-secondary)]">
            Connect a client via <a className="text-teal underline" href="/dashboard/setup">Setup</a> and use the compress tool — savings appear as traffic flows.
          </p>
        </div>
      </div>
    )
  }
  const maxDay = Math.max(...p.days.map(d => d.saved), 0.0001)
  return (
    <div className="mx-auto max-w-4xl">
      <Header />

      {/* ROI headline */}
      <div className="mb-5 flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--green-bg)] p-5">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-medium text-teal">
            <PiggyBank size={15} /> Saved in the last 30 days
            <span className="flex items-center gap-1 rounded-full bg-[var(--bg)] px-2 py-0.5 text-[10px] text-[var(--fg-secondary)]">
              {p.measured ? <><BadgeCheck size={10} className="text-teal" /> measured (holdout)</> : <><Sparkles size={10} /> estimated</>}
            </span>
          </div>
          <div className="mt-1 text-[34px] font-bold text-[var(--fg)]">{fmtUsd(p.costSaved)}</div>
          <div className="text-[12.5px] text-[var(--fg-secondary)]">{fmtTok(p.tokensSaved)} tokens · {p.savingsRate}% of total spend</div>
        </div>
        <div className="text-right text-[11.5px] text-[var(--fg-tertiary)]">
          <div>{p.optimizedRequests.toLocaleString()} optimized</div>
          <div>{p.holdoutRequests.toLocaleString()} holdout (control)</div>
        </div>
      </div>

      {/* By lever */}
      <div className="mb-5 grid grid-cols-2 gap-3">
        <Lever icon={ArrowDownToLine} title="Input compression" cost={p.inputCostSaved} tokens={p.inputTokensSaved}
          note="Reversible compression of tool outputs/JSON/logs (CCR)." />
        <Lever icon={MessageSquare} title="Output shaping" cost={p.outputCostSaved} tokens={p.outputTokensSaved}
          note={p.outputSavingsPct == null
            ? 'Measuring… need ≥20 holdout requests for a measured rate.'
            : `${p.outputSavingsPct}% shorter responses vs control (verbosity + effort routing).`} />
      </div>

      {/* Daily savings */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
        <div className="mb-3 text-[13px] font-semibold text-[var(--fg)]">Daily savings</div>
        <div className="flex h-28 items-end gap-[3px]">
          {p.days.map(d => (
            <div key={d.day} className="group relative flex-1" title={`${d.day}: ${fmtUsd(d.saved)}`}>
              <div className="rounded-t bg-teal/70 group-hover:bg-teal" style={{ height: `${Math.max((d.saved / maxDay) * 100, 1)}%` }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Header() {
  return (
    <div className="mb-6">
      <div className="text-[19px] font-bold text-[var(--fg)]">Savings</div>
      <p className="text-[13px] text-[var(--fg-secondary)]">What TokenFin cut from your bill — measured against a live holdout, not just estimated.</p>
    </div>
  )
}

function Lever({ icon: Icon, title, cost, tokens, note }: { icon: React.ElementType; title: string; cost: number; tokens: number; note: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--fg)]"><Icon size={14} className="text-[var(--fg-tertiary)]" />{title}</div>
      <div className="text-[20px] font-bold text-[var(--fg)]">{fmtUsd(cost)}</div>
      <div className="text-[11px] text-[var(--fg-tertiary)]">{fmtTok(tokens)} tokens saved</div>
      <p className="mt-2 text-[11px] leading-snug text-[var(--fg-secondary)]">{note}</p>
    </div>
  )
}
