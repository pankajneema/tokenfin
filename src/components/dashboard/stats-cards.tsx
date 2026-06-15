'use client'
import { DollarSign, Zap, Activity, Users, TrendingUp, TrendingDown } from 'lucide-react'
import { formatCost, formatTokens, formatNumber } from '@/lib/utils'

interface Props { totalCost: number; totalTokens: number; totalRequests: number; memberCount: number }

export function StatsCards({ totalCost, totalTokens, totalRequests, memberCount }: Props) {
  const cards = [
    { label: 'Total Cost',         value: formatCost(totalCost),        sub: 'Last 30 days',  icon: DollarSign, trend: +12.4, color: 'text-coral',            bg: 'bg-[#FDECEA] dark:bg-coral/10' },
    { label: 'Tokens Used',        value: formatTokens(totalTokens),    sub: 'Input + output', icon: Zap,        trend: +8.1,  color: 'text-teal',             bg: 'bg-[var(--green-bg)]' },
    { label: 'API Requests',       value: formatNumber(totalRequests),  sub: 'Last 30 days',  icon: Activity,   trend: +5.3,  color: 'text-[var(--blue)]',    bg: 'bg-[var(--blue-bg)]' },
    { label: 'Active Engineers',   value: String(memberCount),          sub: 'In your org',   icon: Users,      trend: null,  color: 'text-[var(--amber)]',   bg: 'bg-[var(--amber-bg)]' },
  ]

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
      {cards.map(c => (
        <div key={c.label} className="stat-card">
          <div className="flex items-start justify-between">
            <div className={`w-9 h-9 ${c.bg} rounded-lg flex items-center justify-center`}>
              <c.icon size={17} className={c.color} />
            </div>
            {c.trend !== null && (
              <span className={`flex items-center gap-0.5 text-xs font-medium ${c.trend >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                {c.trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {Math.abs(c.trend)}%
              </span>
            )}
          </div>
          <div>
            <p className="text-2xl font-semibold text-[var(--fg)] tabular-nums">{c.value}</p>
            <p className="text-xs text-[var(--fg-secondary)] mt-0.5">{c.label}</p>
          </div>
          <p className="text-xs text-[var(--fg-tertiary)]">{c.sub}</p>
        </div>
      ))}
    </div>
  )
}
