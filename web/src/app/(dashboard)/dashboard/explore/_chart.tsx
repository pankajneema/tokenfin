'use client'
/**
 * Daily stacked bar chart shared by Explore and the member drill-down.
 * `stacks` = one series per group key (top N + "Other"); when null the cost
 * view stacks metered vs notional from `total` and tokens/requests show totals.
 */
import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { cn, formatCost, formatTokens, formatNumber } from '@/lib/utils'
import type { ChartStack, ChartTotalPoint } from './_types'

type Metric = 'cost' | 'tokens' | 'requests'
const PALETTE = ['#E8533A', '#00A67E', '#3B82F6', '#A855F7', '#F59E0B', '#EC4899', '#14B8A6', '#94A3B8']

const shortDay = (d: string) => {
  const [, m, day] = d.split('-')
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]} ${Number(day)}`
}

export function DailyStackChart({ total, stacks, height = 260 }: {
  total: ChartTotalPoint[]
  stacks: ChartStack[] | null
  height?: number
}) {
  const [metric, setMetric] = useState<Metric>('cost')

  const { data, series } = useMemo(() => {
    const pick = (p: { cost_usd: number; total_tokens: number; requests: number }) =>
      metric === 'cost' ? p.cost_usd : metric === 'tokens' ? p.total_tokens : p.requests

    if (!stacks) {
      if (metric === 'cost') {
        return {
          data: total.map(p => ({ day: p.day, metered: p.metered_cost_usd, notional: p.notional_cost_usd })),
          series: [{ id: 'metered', label: 'Metered', color: PALETTE[0] }, { id: 'notional', label: 'Notional (subscription)', color: PALETTE[7] }],
        }
      }
      return { data: total.map(p => ({ day: p.day, all: pick(p) })), series: [{ id: 'all', label: metric === 'tokens' ? 'Tokens' : 'Requests', color: PALETTE[2] }] }
    }

    const byDay = new Map(total.map(p => [p.day, { day: p.day } as Record<string, number | string>]))
    stacks.forEach((s, i) => {
      for (const p of s.points) {
        const row = byDay.get(p.day)
        if (row) row[`s${i}`] = pick(p)
      }
    })
    // "Other" = total − shown stacks (clamped, float noise removed)
    let hasOther = false
    for (const p of total) {
      const row = byDay.get(p.day)!
      const shown = stacks.reduce((a, _s, i) => a + Number(row[`s${i}`] ?? 0), 0)
      const rest = pick(p) - shown
      row.other = rest > Math.max(1e-9, Math.abs(pick(p)) * 1e-9) ? rest : 0
      if (Number(row.other) > 0) hasOther = true
    }
    const series = stacks.map((s, i) => ({ id: `s${i}`, label: s.label, color: PALETTE[i % (PALETTE.length - 1)] }))
    if (hasOther) series.push({ id: 'other', label: 'Other', color: PALETTE[7] })
    return { data: Array.from(byDay.values()), series }
  }, [total, stacks, metric])

  const fmt = (v: number) => metric === 'cost' ? formatCost(v) : metric === 'tokens' ? formatTokens(v) : formatNumber(v)

  return (
    <div>
      <div role="radiogroup" aria-label="Chart metric" className="mb-3 inline-flex rounded-lg border border-[var(--border)] p-0.5">
        {(['cost', 'tokens', 'requests'] as Metric[]).map(m => (
          <button key={m} type="button" role="radio" aria-checked={metric === m} onClick={() => setMetric(m)}
            className={cn('rounded-md px-2.5 py-1 text-[12px] font-medium capitalize outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue)]',
              metric === m ? 'bg-[var(--bg-tertiary)] text-[var(--fg)]' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
            {m}
          </button>
        ))}
      </div>
      <div style={{ height }} aria-label={`Daily ${metric} chart`} role="img">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 11, fill: 'var(--fg-tertiary)' }} axisLine={false} tickLine={false} minTickGap={16} />
            <YAxis tickFormatter={fmt} tick={{ fontSize: 11, fill: 'var(--fg-tertiary)' }} axisLine={false} tickLine={false} width={56} />
            <Tooltip
              formatter={(v: number, name: string) => [fmt(Number(v)), series.find(s => s.id === name)?.label ?? name]}
              labelFormatter={(l: string) => shortDay(String(l))}
              contentStyle={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
              cursor={{ fill: 'var(--bg-tertiary)' }}
            />
            <Legend formatter={(v: string) => series.find(s => s.id === v)?.label ?? v} wrapperStyle={{ fontSize: 11 }} />
            {series.map(s => <Bar key={s.id} dataKey={s.id} stackId="a" fill={s.color} isAnimationActive={false} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
