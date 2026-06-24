'use client'
import { useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'
import { format, parseISO } from 'date-fns'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ── Types ──────────────────────────────────────────────────── */
interface Row { bucket: string; cost_usd: number; total_tokens: number; request_count?: number }
interface PrevTotals { tokens: number; cost: number; reqs: number }
interface Props { data: Row[]; prevTotals?: PrevTotals }
type Metric = 'tokens' | 'cost' | 'reqs'

/* ── Metric config ──────────────────────────────────────────── */
const METRICS = [
  {
    key:      'tokens' as Metric,
    label:    'Tokens',
    color:    '#00C48C',
    unit:     'tokens',
    yFmt:     (v: number) => v >= 1_000_000 ? `${(v/1_000_000).toFixed(1)}M` : `${(v/1000).toFixed(0)}K`,
    tipFmt:   (v: number) => v >= 1_000_000 ? `${(v/1_000_000).toFixed(2)}M` : v.toLocaleString(),
    totalFmt: (v: number) => v >= 1_000_000 ? `${(v/1_000_000).toFixed(2)}M` : v >= 1000 ? `${(v/1000).toFixed(1)}K` : String(Math.round(v)),
  },
  {
    key:      'cost' as Metric,
    label:    'Cost',
    color:    '#E8533A',
    unit:     'USD',
    yFmt:     (v: number) => `$${v.toFixed(2)}`,
    tipFmt:   (v: number) => `$${v.toFixed(4)}`,
    totalFmt: (v: number) => `$${v.toFixed(2)}`,
  },
  {
    key:      'reqs' as Metric,
    label:    'Requests',
    color:    '#60A5FA',
    unit:     'requests',
    yFmt:     (v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v),
    tipFmt:   (v: number) => v.toLocaleString(),
    totalFmt: (v: number) => v >= 1000 ? `${(v/1000).toFixed(1)}K` : String(v),
  },
]

/* ── Trend badge ─────────────────────────────────────────────── */
function TrendBadge({
  curr, prev, isCost,
}: { curr: number; prev: number; isCost: boolean }) {
  if (!prev) return null
  const pct = (curr - prev) / prev * 100
  const up  = pct > 0
  if (Math.abs(pct) < 0.5) return (
    <span className="flex items-center gap-0.5 text-[10.5px] font-semibold text-[var(--fg-tertiary)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-full">
      <Minus size={9} strokeWidth={2.5} /> Flat vs prev 5d
    </span>
  )
  const bad  = up && isCost
  const good = !up
  return (
    <span className={cn(
      'flex items-center gap-0.5 text-[10.5px] font-semibold px-2 py-0.5 rounded-full',
      bad  ? 'bg-[var(--red-bg)]   text-[var(--red)]'   :
      good ? 'bg-[var(--green-bg)] text-[var(--green)]' :
             'bg-[var(--blue-bg)]  text-[var(--blue)]',
    )}>
      {up ? <TrendingUp size={9} strokeWidth={2.5} /> : <TrendingDown size={9} strokeWidth={2.5} />}
      {Math.abs(pct).toFixed(1)}% vs prev 5d
    </span>
  )
}

/* ── Tooltip ─────────────────────────────────────────────────── */
function CustomTooltip({ active, payload, label, m }: {
  active?: boolean; payload?: { value: number }[]; label?: string
  m: typeof METRICS[0]
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-xl px-3.5 py-2.5 min-w-[120px]">
      <p className="text-[11px] text-[var(--fg-tertiary)] mb-1.5 font-medium">{label}</p>
      <p className="text-[16px] font-bold tabular-nums leading-none" style={{ color: m.color }}>
        {m.tipFmt(payload[0]?.value ?? 0)}
      </p>
      <p className="text-[10px] text-[var(--fg-tertiary)] mt-1">{m.unit}</p>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════ */
export function CostChart({ data, prevTotals }: Props) {
  const [metric, setMetric] = useState<Metric>('tokens')
  const m = METRICS.find(x => x.key === metric)!

  /* ── Transform ── */
  const chartData = useMemo(() => data.map(r => ({
    date:   format(parseISO(r.bucket), 'MMM d'),
    tokens: r.total_tokens,
    cost:   +r.cost_usd.toFixed(4),
    reqs:   r.request_count ?? 0,
  })), [data])

  /* ── Aggregates ── */
  const totals = useMemo(() => ({
    tokens: chartData.reduce((s, r) => s + r.tokens, 0),
    cost:   chartData.reduce((s, r) => s + r.cost,   0),
    reqs:   chartData.reduce((s, r) => s + r.reqs,   0),
  }), [chartData])

  const peakIdx = useMemo(() =>
    chartData.length === 0 ? -1 :
    chartData.reduce((pi, r, i) => (r[metric] ?? 0) > (chartData[pi][metric] ?? 0) ? i : pi, 0),
    [chartData, metric])

  const dailyAvg = chartData.length > 0 ? totals[metric] / chartData.length : 0
  const currTotal = totals[metric]
  const prevTotal = prevTotals?.[metric] ?? 0

  /* ── Empty state ── */
  if (data.length === 0) {
    return (
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 h-full flex flex-col items-center justify-center gap-3 min-h-[320px]">
        <div className="w-10 h-10 rounded-xl bg-[var(--bg-secondary)] flex items-center justify-center">
          <TrendingUp size={18} className="text-[var(--fg-tertiary)]" />
        </div>
        <div className="text-center">
          <p className="text-[13px] font-semibold text-[var(--fg)]">No usage data yet</p>
          <p className="text-[11.5px] text-[var(--fg-tertiary)] mt-0.5">
            Send events via{' '}
            <code className="font-mono bg-[var(--bg-secondary)] px-1 rounded">POST /api/v1/ingest</code>
            {' '}to see your usage trend
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 h-full flex flex-col gap-4">

      {/* ── Title row ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--fg)]">Usage Trend</h2>
          <p className="text-[11.5px] text-[var(--fg-secondary)] mt-0.5">Daily · last 5 days</p>
        </div>
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

      {/* ── Big stat + trend ── */}
      <div className="flex items-end gap-3">
        <div>
          <p
            className="text-[30px] font-bold tabular-nums leading-none tracking-tight"
            style={{ color: m.color }}
          >
            {m.totalFmt(currTotal)}
          </p>
          <p className="text-[11px] text-[var(--fg-tertiary)] mt-1">
            {m.unit} · 5-day total
          </p>
        </div>
        <div className="mb-1">
          <TrendBadge curr={currTotal} prev={prevTotal} isCost={metric === 'cost'} />
        </div>
      </div>

      {/* ── Bar chart ── */}
      <ResponsiveContainer width="100%" height={175}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, left: -8, bottom: 0 }} barCategoryGap="32%">
          <defs>
            <linearGradient id={`bg-${metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={m.color} stopOpacity={0.9} />
              <stop offset="100%" stopColor={m.color} stopOpacity={0.4} />
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
            width={52}
          />
          {dailyAvg > 0 && (
            <ReferenceLine
              y={dailyAvg}
              stroke="var(--fg-tertiary)"
              strokeDasharray="4 3"
              strokeOpacity={0.35}
              label={{
                value: 'avg',
                position: 'insideTopRight',
                fontSize: 10,
                fill: 'var(--fg-tertiary)',
                opacity: 0.5,
              }}
            />
          )}
          <Tooltip
            content={<CustomTooltip m={m} />}
            cursor={{ fill: 'var(--bg-secondary)', opacity: 0.5, radius: 4 }}
          />
          <Bar dataKey={metric} radius={[5, 5, 0, 0]}>
            {chartData.map((_, i) => (
              <Cell
                key={i}
                fill={i === peakIdx ? m.color : `url(#bg-${metric})`}
                fillOpacity={i === peakIdx ? 1 : 0.8}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* ── Footer: 3 quick stats ── */}
      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-[var(--border)]">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">Peak day</p>
          <p className="text-[13px] font-bold text-[var(--fg)] mt-0.5 tabular-nums">
            {peakIdx >= 0 ? chartData[peakIdx]?.date : '—'}
          </p>
          <p className="text-[11px] text-[var(--fg-tertiary)] tabular-nums" style={{ color: m.color }}>
            {peakIdx >= 0 ? m.totalFmt(chartData[peakIdx]?.[metric] ?? 0) : ''}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">Daily avg</p>
          <p className="text-[13px] font-bold text-[var(--fg)] mt-0.5 tabular-nums">{m.totalFmt(dailyAvg)}</p>
          <p className="text-[11px] text-[var(--fg-tertiary)]">/ day</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">Prev 5 days</p>
          <p className="text-[13px] font-bold text-[var(--fg)] mt-0.5 tabular-nums">
            {prevTotal > 0 ? m.totalFmt(prevTotal) : '—'}
          </p>
          <p className="text-[11px] text-[var(--fg-tertiary)]">{prevTotal > 0 ? m.unit : 'no data yet'}</p>
        </div>
      </div>

    </div>
  )
}
