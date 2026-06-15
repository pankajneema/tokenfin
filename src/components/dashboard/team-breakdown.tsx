'use client'
import { Users } from 'lucide-react'

const TEAMS = [
  { name: 'Backend Team', cost: 142.50, pct: 48, color: '#E8533A' },
  { name: 'ML Research',  cost:  89.20, pct: 30, color: '#00C48C' },
  { name: 'Frontend',     cost:  43.10, pct: 15, color: '#8B5CF6' },
  { name: 'DevOps',       cost:  21.80, pct:  7, color: '#0C447C' },
]

export function TeamBreakdown() {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-5">
        <Users size={15} className="text-[var(--fg-secondary)]" />
        <h2 className="text-sm font-semibold text-[var(--fg)]">Team Breakdown</h2>
      </div>
      <div className="space-y-4">
        {TEAMS.map(t => (
          <div key={t.name}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-[var(--fg)]">{t.name}</span>
              <span className="text-xs text-[var(--fg-secondary)] tabular-nums">${t.cost.toFixed(2)}</span>
            </div>
            <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${t.pct}%`, backgroundColor: t.color }} />
            </div>
            <p className="text-[10px] text-[var(--fg-tertiary)] mt-0.5 text-right">{t.pct}%</p>
          </div>
        ))}
      </div>
      <div className="divider mt-5 mb-4" />
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--fg-secondary)]">Total</span>
        <span className="text-sm font-semibold text-[var(--fg)]">$296.60</span>
      </div>
    </div>
  )
}
