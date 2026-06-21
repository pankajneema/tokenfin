'use client'
import { useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { format, parseISO } from 'date-fns'
import { TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ── Types ──────────────────────────────────────────────────── */
interface Row { bucket: string; cost_usd: number; total_tokens: number; request_count?: number }
interface Props { data: Row[] }
type Metric = 'cost' | 'tokens' | 'reqs'

/* ── Metric config ──────────────────────────────────────────── */
const METRICS: {
  key:    Metric
  label:  string
  color:  string
  yFmt:   (v: number) => string
  tipFmt: (v: number) => string
}[] = [
  { key: 'cost',   label: 'Cost ($)',  color: '#E8533A', yFmt: v => `$${v}`,        tipFmt: v => `$${v.toFixed(2)}` },
  { key: 'tokens', label: 'Tokens',    color: '#00C48C', yFmt: v => v >= 1_000_000 ? `${(v/1_000_000).toFixed(1)}M` : `${(v/1000).toFixed(0)}K`, tipFmt: v => v >= 1_000_000 ? `${(v/1_000_000).toFixed(2)}M` : `${(v/1000).toFixed(0)}K` },
  { key: 'reqs',   label: 'Requests',  color: '#60A5FA', yFmt: v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v), tipFmt: v => v.toLocaleString() },
]

/* ── Custom tooltip ─────────────────────────────────────────── */
function CustomTooltip({ active, payload, label, metric }: any) {
  if (!active || !payload?.length) return null
  const m = METRICS.find(x => x.key === metric)!
  return (
    <div className="bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-lg px-3.5 py-2.5">
      <p className="text-[11px] text-[var(--fg-tertiary)] mb-1 font-medium">{label}</p>
      <p className="text-[15px] font-bold text-[var(--fg)] tabular-nums">{m.tipFmt(payload[0]?.value ?? 0)}</p>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════ */
export function CostChart({ data }: Props) {
  const [metric, setMetric] = useState<Metric>('cost')

  const m      = METRICS.find(x => x.key === metric)!
  const gradId = `gchart-${metric}`

  /* ── Empty state ── */
  if (data.length === 0) {
    return (
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 h-full flex flex-col items-center justify-center gap-3 min-h-[280px]">
        <div className="w-10 h-10 rounded-xl bg-[var(--bg-secondary)] flex items-center justify-center">
          <TrendingUp size={18} className="text-[var(--fg-tertiary)]" />
        </div>
        <div className="text-center">
          <p className="text-[13px] font-semibold text-[var(--fg)]">No usage data yet</p>
          <p className="text-[11.5px] text-[var(--fg-tertiary)] mt-0.5">
            Send events via <code className="font-mono bg-[var(--bg-secondary)] px-1 rounded">POST /api/v1/ingest</code> to see your cost trend
          </p>
        </div>
      </div>
    )
  }

  const chartData = data.map(r => ({
    date:   format(parseISO(r.bucket), 'MMM d'),
    cost:   +r.cost_usd.toFixed(2),
    tokens: r.total_tokens,
    reqs:   r.request_count ?? 0,
  }))

  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 h-full flex flex-col">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--fg)]">Cost Trend</h2>
          <p className="text-[11.5px] text-[var(--fg-secondary)] mt-0.5">Daily usage · last 14 days</p>
        </div>

        {/* Metric toggle pills */}
        <div className="flex items-center gap-0.5 p-0.5 bg-[var(--bg-tertiary)] rounded-lg">
          {METRICS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setMetric(opt.key)}
              className={cn(
                'px-3 py-1.5 rounded-[7px] text-[11.5px] font-medium transition-all duration-150',
                metric === opt.key
                  ? 'bg-white dark:bg-[#1E1E35] text-[var(--fg)] shadow-sm'
                  : 'text-[var(--fg-tertiary)] hover:text-[var(--fg)]',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={m.color} stopOpacity={0.18} />
              <stop offset="95%" stopColor={m.color} stopOpacity={0}    />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: 'var(--fg-tertiary)' }}
            axisLine={false}
            tickLine={false}
            dy={4}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--fg-tertiary)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={m.yFmt}
            width={54}
          />
          <Tooltip
            content={<CustomTooltip metric={metric} />}
            cursor={{ stroke: m.color, strokeWidth: 1, strokeDasharray: '3 3', opacity: 0.55 }}
          />
          <Area
            type="monotone"
            dataKey={metric}
            stroke={m.color}
            strokeWidth={2}
            fill={`url(#${gradId})`}
            dot={false}
            activeDot={{ r: 4, fill: m.color, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
