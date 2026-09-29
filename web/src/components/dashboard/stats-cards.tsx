'use client'
import { DollarSign, Zap, Activity, Users, MessageSquare, TrendingUp, TrendingDown, CalendarDays } from 'lucide-react'
import { cn, formatCost, formatTokens, formatNumber } from '@/lib/utils'
import { basisLine } from './cost-basis'

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
interface CostSplit { cost: number; metered: number; notional: number }
interface Props {
  /** org-local month to date; `projected` is null with < 3 days of history */
  mtd:           CostSplit & { projected: number | null }
  last30:        CostSplit
  totalTokens:   number
  inputTokens:   number
  outputTokens:  number
  totalRequests: number
  totalPrompts:  number
  memberCount:   number
  activeUsers?:  number
  sparks:        { costs: number[]; tokens: number[]; reqs: number[]; prompts: number[] }
  trends:        { cost: number | null; tokens: number | null; reqs: number | null; prompts: number | null }
}

interface Card {
  label: string; value: string; sub: string; sub2?: string
  Icon: React.ElementType; trend: number | null; color: string; iconBg: string; iconColor: string; spark: number[]
}

/* ═══════════════════════════════════════════════════════════════ */
export function StatsCards({ mtd, last30, totalTokens, inputTokens, outputTokens, totalRequests, totalPrompts, memberCount, activeUsers, sparks, trends }: Props) {
  const perPrompt = totalPrompts > 0 ? totalRequests / totalPrompts : 0
  const cards: Card[] = [
    {
      label:     'Spend · Month to date',
      value:     formatCost(mtd.cost),
      sub:       mtd.projected != null
        ? `Projected end of month ${formatCost(mtd.projected)}`
        : 'Projection shows after 3 days of data',
      sub2:      basisLine(mtd.metered, mtd.notional),
      Icon:      CalendarDays,
      trend:     null,
      color:     '#E8533A',
      iconBg:    'bg-[#FDECEA] dark:bg-coral/10',
      iconColor: 'text-coral',
      spark:     [],
    },
    {
      label:     'Spend · Last 30 days',
      value:     formatCost(last30.cost),
      sub:       trends.cost != null ? 'vs. the 30 days before' : 'No earlier 30 days to compare',
      sub2:      basisLine(last30.metered, last30.notional),
      Icon:      DollarSign,
      trend:     trends.cost,
      color:     '#E8533A',
      iconBg:    'bg-[#FDECEA] dark:bg-coral/10',
      iconColor: 'text-coral',
      spark:     sparks.costs,
    },
    {
      label:     'Tokens · 30 days',
      value:     formatTokens(totalTokens),
      sub:       inputTokens + outputTokens > 0
        ? `${formatTokens(inputTokens)} in · ${formatTokens(outputTokens)} out`
        : 'Input + output combined',
      Icon:      Zap,
      trend:     trends.tokens,
      color:     '#00C48C',
      iconBg:    'bg-[var(--green-bg)]',
      iconColor: 'text-teal',
      spark:     sparks.tokens,
    },
    {
      label:     'LLM calls · 30 days',
      value:     formatNumber(totalRequests),
      sub:       perPrompt > 0 ? `${perPrompt.toFixed(1)} calls per prompt` : 'Total completions sent',
      Icon:      Activity,
      trend:     trends.reqs,
      color:     '#60A5FA',
      iconBg:    'bg-[var(--blue-bg)]',
      iconColor: 'text-[var(--blue)]',
      spark:     sparks.reqs,
    },
    {
      label:     'Prompts · 30 days',
      value:     formatNumber(totalPrompts),
      sub:       'What people asked · each can trigger several calls',
      Icon:      MessageSquare,
      trend:     trends.prompts,
      color:     '#F59E0B',
      iconBg:    'bg-[var(--amber-bg)]',
      iconColor: 'text-[var(--amber)]',
      spark:     sparks.prompts,
    },
    {
      label:     'Members',
      value:     memberCount ? formatNumber(memberCount) : '—',
      sub:       activeUsers != null ? `${formatNumber(activeUsers)} active user${activeUsers === 1 ? '' : 's'} in 30 days` : 'Members in this workspace',
      Icon:      Users,
      trend:     null,
      color:     '#8B5CF6',
      iconBg:    'bg-purple-50 dark:bg-purple-900/20',
      iconColor: 'text-purple-500',
      spark:     [],
    },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
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
            <p className="text-[24px] font-bold text-[var(--fg)] tabular-nums leading-none tracking-tight">{c.value}</p>
            <p className="text-[12.5px] text-[var(--fg-secondary)] mt-1.5 font-medium">{c.label}</p>
          </div>

          {/* Sparkline + sub */}
          <div className="flex items-end justify-between gap-2 pt-1 mt-auto">
            <div className="min-w-0">
              <p className="text-[11px] text-[var(--fg-tertiary)] leading-snug">{c.sub}</p>
              {c.sub2 && <p className="text-[10.5px] text-[var(--fg-tertiary)] leading-snug mt-0.5">{c.sub2}</p>}
            </div>
            {c.spark.length > 0 && <Sparkline data={c.spark} color={c.color} />}
          </div>
        </div>
      ))}
    </div>
  )
}
