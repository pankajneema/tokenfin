'use client'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { formatCost } from '@/lib/utils'

/* ── Types ──────────────────────────────────────────────────── */
interface ModelStat { name: string; cost: number; tokens: number; reqs: number; pct: number }
interface Props { data: ModelStat[]; totalCost: number }

/* ── Demo data ──────────────────────────────────────────────── */
const DEMO: ModelStat[] = [
  { name: 'claude-sonnet-4-6', cost: 1281.20, tokens: 64_000_000, reqs: 8340, pct: 45.0 },
  { name: 'gpt-4o',            cost:  910.40, tokens: 30_000_000, reqs: 4820, pct: 32.0 },
  { name: 'claude-haiku-4-5',  cost:  415.60, tokens: 40_000_000, reqs: 5120, pct: 14.6 },
  { name: 'gemini-1.5-pro',    cost:  240.12, tokens: 12_000_000, reqs: 1210, pct: 8.4  },
]

const COLORS = ['#E8533A', '#00C48C', '#8B5CF6', '#60A5FA', '#F5C842']

const MODEL_SHORT: Record<string, string> = {
  'claude-sonnet-4-6': 'Claude Sonnet',
  'claude-opus-4-8':   'Claude Opus',
  'claude-haiku-4-5':  'Claude Haiku',
  'gpt-4o':            'GPT-4o',
  'gpt-4-turbo':       'GPT-4 Turbo',
  'gemini-1.5-pro':    'Gemini 1.5 Pro',
  'gemini-1.5-flash':  'Gemini Flash',
}

const MODEL_PROVIDER: Record<string, string> = {
  'claude-sonnet-4-6': 'Anthropic',
  'claude-opus-4-8':   'Anthropic',
  'claude-haiku-4-5':  'Anthropic',
  'gpt-4o':            'OpenAI',
  'gpt-4-turbo':       'OpenAI',
  'gemini-1.5-pro':    'Google',
  'gemini-1.5-flash':  'Google',
}

function shortName(m: string) {
  return MODEL_SHORT[m] ?? m.split('-').slice(0, 2).join(' ')
}
function provider(m: string) {
  return MODEL_PROVIDER[m] ?? 'Other'
}

/* ═══════════════════════════════════════════════════════════════ */
export function ModelBreakdown({ data, totalCost }: Props) {
  const rows  = (data.length ? data : DEMO).slice(0, 5)
  const total = rows.reduce((s, r) => s + r.cost, 0) || totalCost || DEMO.reduce((s, r) => s + r.cost, 0)

  const pieData = rows.map((r, i) => ({
    name:  shortName(r.name),
    value: r.cost,
    pct:   r.pct || +(r.cost / total * 100).toFixed(1),
    color: COLORS[i % COLORS.length],
  }))

  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 h-full flex flex-col">

      {/* Header */}
      <div className="mb-4">
        <h2 className="text-[13px] font-semibold text-[var(--fg)]">Model Breakdown</h2>
        <p className="text-[11.5px] text-[var(--fg-secondary)] mt-0.5">Cost by model · last 30 days</p>
      </div>

      {/* Donut chart */}
      <div className="relative flex justify-center items-center my-1">
        <ResponsiveContainer width={156} height={156}>
          <PieChart>
            <Pie
              data={pieData}
              innerRadius={50}
              outerRadius={74}
              paddingAngle={2.5}
              dataKey="value"
              startAngle={90}
              endAngle={-270}
              strokeWidth={0}
            >
              {pieData.map((entry, i) => (
                <Cell key={i} fill={entry.color} opacity={0.9} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number) => [formatCost(v), 'Cost']}
              contentStyle={{
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                fontSize: 12,
                color: 'var(--fg)',
              }}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="text-[9.5px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-widest">Total</p>
          <p className="text-[13px] font-bold text-[var(--fg)] tabular-nums mt-0.5">{formatCost(total)}</p>
        </div>
      </div>

      {/* Ranked list */}
      <div className="flex flex-col gap-0.5 mt-4 flex-1">
        {rows.map((row, i) => (
          <div
            key={row.name}
            className="flex items-center gap-2.5 px-1.5 py-2 rounded-xl hover:bg-[var(--bg-hover)] transition-colors"
          >
            {/* Color dot */}
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />

            {/* Name + provider */}
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-[var(--fg)] truncate">{shortName(row.name)}</p>
              <p className="text-[10.5px] text-[var(--fg-tertiary)]">{provider(row.name)}</p>
            </div>

            {/* Cost + pct */}
            <div className="text-right flex-shrink-0">
              <p className="text-[12px] font-semibold text-[var(--fg)] tabular-nums">{formatCost(row.cost)}</p>
              <p className="text-[10.5px] text-[var(--fg-tertiary)] tabular-nums">
                {row.pct || +(row.cost / total * 100).toFixed(1)}%
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
