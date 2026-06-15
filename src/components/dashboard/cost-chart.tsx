'use client'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { format, parseISO } from 'date-fns'

interface Row { bucket: string; cost_usd: number; total_tokens: number }

function placeholder(): Row[] {
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86400_000)
    return { bucket: d.toISOString(), cost_usd: +(Math.random() * 40 + 5).toFixed(2), total_tokens: Math.floor(Math.random() * 500_000 + 50_000) }
  })
}

export function CostChart({ data }: { data: Row[] }) {
  const chartData = (data.length ? data : placeholder()).map(r => ({
    date:   format(parseISO(r.bucket), 'MMM d'),
    cost:   +r.cost_usd.toFixed(2),
    tokens: Math.round(r.total_tokens / 1000),
  }))

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-sm font-semibold text-[var(--fg)]">Cost Trend</h2>
          <p className="text-xs text-[var(--fg-secondary)] mt-0.5">Daily spend — last 14 days</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--fg-secondary)]">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-coral inline-block" />Cost ($)</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-teal inline-block" />Tokens (k)</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="gradCost"   x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#E8533A" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#E8533A" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradTokens" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#00C48C" stopOpacity={0.12} />
              <stop offset="95%" stopColor="#00C48C" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--fg-tertiary)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--fg-tertiary)' }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--fg)' }} />
          <Area type="monotone" dataKey="cost"   stroke="#E8533A" strokeWidth={2} fill="url(#gradCost)"   dot={false} />
          <Area type="monotone" dataKey="tokens" stroke="#00C48C" strokeWidth={2} fill="url(#gradTokens)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
