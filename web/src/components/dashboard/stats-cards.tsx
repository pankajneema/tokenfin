'use client'
import { DollarSign, Zap, Activity, Users, TrendingUp, TrendingDown } from 'lucide-react'
import { cn, formatCost, formatTokens, formatNumber } from '@/lib/utils'

/* ── Sparkline ──────────────────────────────────────────────── */
function Sparkline({ data, color }: { data: number[]; color: string }) {
  // Need at least 2 real points — otherwise render a flat zero line
  const pts = data.length >= 2 ? data : Array(7).fill(0)
  const max = Math.max(...pts)
  const min = Math.min(...pts)
  const range = max - min || 1
  const W = 80, H = 28, pad = 3

  const poly = pts
    .map((v, i) => {
      const x = (i / (pts.length - 1)) * W
      const y = H - pad - ((v - min) / range) * (H - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  const id = `sg${color.replace(/[^a-z0-9]/gi, '')}`

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none" className="overflow-visible flex-shrink-0">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0}    />
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${poly} ${W},${H}`} fill={`url(#${id})`} />
      <polyline points={poly} stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" fill="none" />
    </svg>
  )
}

/* ── Trend badge ────────────────────────────────────────────── */
function TrendBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null
  const up = pct >= 0
  return (
    <div className={cn(
      'flex items-center gap-0.5 text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full',
      up ? 'bg-[var(--red-bg)] text-[var(--red)]' : 'bg-[var(--green-bg)] text-[var(--green)]',
    )}>
      {up ? <TrendingUp size={9} strokeWidth={2.5} /> : <TrendingDown size={9} strokeWidth={2.5} />}
      {Math.abs(pct).toFixed(1)}%
    </div>
  )
}

/* ── Types ──────────────────────────────────────────────────── */
interface Props {
  totalCost:     number
  totalTokens:   number
  totalRequests: number
  memberCount:   number
  sparks:        { costs: number[]; tokens: number[]; reqs: number[] }
  trends:        { cost: number | null; tokens: number | null; reqs: number | null }
}

/* ═══════════════════════════════════════════════════════════════ */
export function StatsCards({ totalCost, totalTokens, totalRequests, memberCount, sparks, trends }: Props) {
  const cards = [
    {
      label:     'Total Cost',
      value:     formatCost(totalCost),
      sub:       'vs. previous 30 days',
      Icon:      DollarSign,
      trend:     trends.cost,
      color:     '#E8533A',
      iconBg:    'bg-[#FDECEA] dark:bg-coral/10',
      iconColor: 'text-coral',
      spark:     sparks.costs,
    },
    {
      label:     'Tokens Used',
      value:     formatTokens(totalTokens),
      sub:       'Input + output combined',
      Icon:      Zap,
      trend:     trends.tokens,
      color:     '#00C48C',
      iconBg:    'bg-[var(--green-bg)]',
      iconColor: 'text-teal',
      spark:     sparks.tokens,
    },
    {
      label:     'API Requests',
      value:     formatNumber(totalRequests),
      sub:       'Across all projects',
      Icon:      Activity,
      trend:     trends.reqs,
      color:     '#60A5FA',
      iconBg:    'bg-[var(--blue-bg)]',
      iconColor: 'text-[var(--blue)]',
      spark:     sparks.reqs,
    },
    {
      label:     'Members',
      value:     String(memberCount || '—'),
      sub:       'Active members in org',
      Icon:      Users,
      trend:     null as number | null,
      color:     '#8B5CF6',
      iconBg:    'bg-purple-50 dark:bg-purple-900/20',
      iconColor: 'text-purple-500',
      spark:     [] as number[],
    },
  ]

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
      {cards.map(c => (
        <div
          key={c.label}
          className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 flex flex-col gap-4
                     hover:shadow-lg hover:border-[var(--border-strong)] transition-all duration-200"
        >
          {/* Icon + trend */}
          <div className="flex items-start justify-between">
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', c.iconBg)}>
              <c.Icon size={18} className={c.iconColor} strokeWidth={1.75} />
            </div>
            <TrendBadge pct={c.trend} />
          </div>

          {/* Value + label */}
          <div>
            <p className="text-[26px] font-bold text-[var(--fg)] tabular-nums leading-none tracking-tight">{c.value}</p>
            <p className="text-[12.5px] text-[var(--fg-secondary)] mt-1.5 font-medium">{c.label}</p>
          </div>

          {/* Sparkline + sub */}
          <div className="flex items-end justify-between gap-2 pt-1 mt-auto">
            <p className="text-[11px] text-[var(--fg-tertiary)] leading-snug">{c.sub}</p>
            <Sparkline data={c.spark} color={c.color} />
          </div>
        </div>
      ))}
    </div>
  )
}
