'use client'
import { useState, useMemo, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  TrendingUp, Download, BarChart3, Zap, Activity, DollarSign,
  AlertTriangle, Lightbulb, ArrowUpRight, ArrowDownRight, Minus,
  ChevronRight, Cpu, Layers, Puzzle, RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AnalyticsData, DayData } from './_types'

/* ═══════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════ */
type Range  = '7D' | '30D'
type Metric = 'cost' | 'tokens' | 'calls'

/* ═══════════════════════════════════════════════════════════
   SVG CHART CONSTANTS
═══════════════════════════════════════════════════════════ */
const CW = 900, CH = 220
const PL = 52, PT = 20, PR = 16, PB = 38
const PW = CW - PL - PR
const PH = CH - PT - PB

function buildPaths(vals: number[], maxV: number, n: number) {
  const pts = vals.map((v, i) => ({
    x: +(PL + (i / Math.max(n - 1, 1)) * PW).toFixed(2),
    y: +(PT + PH - (v / maxV) * PH).toFixed(2),
  }))
  const line = 'M' + pts.map(p => `${p.x},${p.y}`).join('L')
  const area = `${line}L${PL + PW},${PT + PH}L${PL},${PT + PH}Z`
  return { line, area, pts }
}

/* ═══════════════════════════════════════════════════════════
   AREA CHART
═══════════════════════════════════════════════════════════ */
function AreaChart({ data, metric, compare, hovIdx, onHover }: {
  data: DayData[]; metric: Metric; compare: boolean
  hovIdx: number | null; onHover: (i: number | null) => void
}) {
  const n = data.length
  const { cP, pP, maxV, yBudget } = useMemo(() => {
    const cv = data.map(d => metric === 'cost' ? d.cost : metric === 'tokens' ? d.tok : d.calls / 1000)
    const pv = data.map(d => metric === 'cost' ? d.prev : metric === 'tokens' ? d.prevTok : d.prevCalls / 1000)
    const maxV = Math.max(...cv, ...pv, 1) * 1.22
    const daily = metric === 'cost' ? 50 : metric === 'tokens' ? 5.0 : 2.3
    return { cP: buildPaths(cv, maxV, n), pP: buildPaths(pv, maxV, n), maxV, yBudget: +(PT + PH - (daily / maxV) * PH).toFixed(2) }
  }, [data, metric, n])

  const fmtY = (v: number) => metric === 'cost' ? `$${v.toFixed(0)}` : metric === 'tokens' ? `${v.toFixed(1)}M` : `${v.toFixed(0)}K`
  const ySteps = [0, 0.25, 0.5, 0.75, 1]
  const xIdx = Array.from({ length: n }, (_, i) => i).filter(i => i === 0 || i === n - 1 || i % Math.ceil(n / 5) === 0)

  if (n === 0) return <div className="h-[220px] flex items-center justify-center text-[12.5px] text-[var(--fg-tertiary)]">No data for this period</div>

  return (
    <div className="relative w-full select-none">
      <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full h-[220px]">
        <defs>
          <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#D97757" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#D97757" stopOpacity="0.01" />
          </linearGradient>
          <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#20B2AA" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#20B2AA" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {ySteps.map(p => (
          <line key={p} x1={PL} x2={PL + PW} y1={PT + PH - p * PH} y2={PT + PH - p * PH}
            stroke="var(--border)" strokeWidth="0.6" opacity="0.7" />
        ))}

        <line x1={PL} x2={PL + PW} y1={yBudget} y2={yBudget}
          stroke="#EF4444" strokeWidth="1.5" strokeDasharray="5,4" opacity="0.5" />
        <text x={PL + PW - 6} y={yBudget - 5} textAnchor="end" fontSize="9.5"
          fill="#EF4444" opacity="0.65" fontFamily="system-ui">Daily budget</text>

        {data.map((d, i) => !d.spike ? null : (
          <g key={i}>
            <line x1={cP.pts[i].x} x2={cP.pts[i].x} y1={PT + 2} y2={cP.pts[i].y - 8}
              stroke="var(--amber)" strokeWidth="1" strokeDasharray="3,2" opacity="0.7" />
            <text x={cP.pts[i].x} y={PT} textAnchor="middle" fontSize="9" fill="var(--amber)" fontFamily="system-ui">⚠ Spike</text>
          </g>
        ))}

        {compare && (
          <>
            <path d={pP.area} fill="url(#tg)" />
            <path d={pP.line} stroke="#20B2AA" strokeWidth="1.5" fill="none" strokeDasharray="4,3" opacity="0.55" />
          </>
        )}

        <path d={cP.area} fill="url(#ag)" />
        <path d={cP.line} stroke="#D97757" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />

        {hovIdx !== null && (
          <g>
            <line x1={cP.pts[hovIdx].x} x2={cP.pts[hovIdx].x} y1={PT} y2={PT + PH}
              stroke="var(--border-strong)" strokeWidth="1" />
            <circle cx={cP.pts[hovIdx].x} cy={cP.pts[hovIdx].y} r="4.5" fill="#D97757" stroke="white" strokeWidth="1.5" />
            {compare && <circle cx={pP.pts[hovIdx].x} cy={pP.pts[hovIdx].y} r="3.5" fill="#20B2AA" stroke="white" strokeWidth="1.5" />}
          </g>
        )}

        {data.map((_, i) => {
          const x = PL + (i / Math.max(n - 1, 1)) * PW
          return (
            <rect key={i} x={x - PW / n / 2} y={PT} width={PW / n} height={PH}
              fill="transparent" className="cursor-pointer"
              onMouseEnter={() => onHover(i)} onMouseLeave={() => onHover(null)} />
          )
        })}

        {ySteps.map(p => (
          <text key={p} x={PL - 8} y={PT + PH - p * PH + 4} textAnchor="end" fontSize="10"
            fill="var(--fg-tertiary)" fontFamily="system-ui">{fmtY(maxV * p)}</text>
        ))}

        {xIdx.map(i => (
          <text key={i} x={PL + (i / Math.max(n - 1, 1)) * PW} y={CH - 6}
            textAnchor="middle" fontSize="10" fill="var(--fg-tertiary)" fontFamily="system-ui">
            {data[i].d}
          </text>
        ))}
      </svg>

      {hovIdx !== null && (() => {
        const d = data[hovIdx]
        const left = (cP.pts[hovIdx].x / CW) * 100
        const cur = metric === 'cost' ? d.cost : metric === 'tokens' ? d.tok : d.calls / 1000
        const prv = metric === 'cost' ? d.prev : metric === 'tokens' ? d.prevTok : d.prevCalls / 1000
        const chg = prv > 0 ? ((cur - prv) / prv) * 100 : 0
        return (
          <div className="absolute top-1 pointer-events-none z-20"
            style={{ left: `${left}%`, transform: 'translateX(-50%)' }}>
            <div className="bg-[var(--fg)] text-[var(--bg)] rounded-2xl px-3.5 py-2.5 shadow-2xl min-w-[140px]">
              <p className="text-[10px] font-bold uppercase tracking-wider opacity-50 mb-1.5">{d.d}</p>
              <p className="text-[16px] font-bold leading-none">
                {metric === 'cost' ? `$${d.cost.toFixed(2)}` : metric === 'tokens' ? `${d.tok.toFixed(1)}M` : `${d.calls.toLocaleString()}`}
              </p>
              {compare && prv > 0 && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="text-[10px] opacity-50">prev:</span>
                  <span className="text-[10.5px] opacity-70">{metric === 'cost' ? `$${d.prev.toFixed(2)}` : metric === 'tokens' ? `${d.prevTok.toFixed(1)}M` : d.prevCalls.toLocaleString()}</span>
                  <span className={cn('text-[10px] font-bold', chg >= 0 ? 'text-[#FF7B54]' : 'text-[#20B2AA]')}>
                    {chg >= 0 ? '+' : ''}{chg.toFixed(1)}%
                  </span>
                </div>
              )}
              {d.spike && <p className="text-[9.5px] text-[#F59E0B] mt-1 font-semibold">⚠ Anomaly</p>}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   KPI CARD
═══════════════════════════════════════════════════════════ */
function KpiCard({ label, value, sub, delta, deltaLabel, iconColor, warning, children }: {
  label: string; value: string; sub?: string; delta?: number; deltaLabel?: string
  iconColor: string; warning?: boolean; children: React.ReactNode
}) {
  const up = (delta ?? 0) > 0
  const dn = (delta ?? 0) < 0
  return (
    <div className={cn('bg-white dark:bg-[#141428] border rounded-2xl p-4 space-y-3 col-span-1',
      warning ? 'border-[var(--amber)]/50' : 'border-[var(--border)]')}>
      <div className="flex items-center justify-between">
        <p className="text-[10.5px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider leading-tight">{label}</p>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${iconColor}18` }}>
          <div style={{ color: iconColor }}>{children}</div>
        </div>
      </div>
      <div>
        <p className="text-[21px] font-bold text-[var(--fg)] leading-none tabular-nums">{value}</p>
        {sub && <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-1 leading-tight">{sub}</p>}
      </div>
      {delta !== undefined && (
        <div className="flex items-center gap-1">
          {up ? <ArrowUpRight size={12} color="var(--red)" /> : dn ? <ArrowDownRight size={12} color="#20B2AA" /> : <Minus size={12} className="text-[var(--fg-tertiary)]" />}
          <span className={cn('text-[11px] font-semibold', up ? 'text-[var(--red)]' : dn ? 'text-teal' : 'text-[var(--fg-tertiary)]')}>
            {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
          </span>
          {deltaLabel && <span className="text-[10.5px] text-[var(--fg-tertiary)] truncate">{deltaLabel}</span>}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   MINI DONUT
═══════════════════════════════════════════════════════════ */
function MiniDonut({ slices }: { slices: { pct: number; color: string }[] }) {
  const r = 38, cx = 50, cy = 50, sw = 13
  let angle = -90
  return (
    <svg viewBox="0 0 100 100" className="w-[84px] h-[84px] flex-shrink-0">
      {slices.map((s, i) => {
        const start = angle
        angle += s.pct * 3.6
        const s1 = (start * Math.PI) / 180, s2 = (angle * Math.PI) / 180
        const x1 = cx + r * Math.cos(s1), y1 = cy + r * Math.sin(s1)
        const x2 = cx + r * Math.cos(s2), y2 = cy + r * Math.sin(s2)
        return (
          <path key={i} d={`M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${s.pct > 50 ? 1 : 0},1 ${x2.toFixed(2)},${y2.toFixed(2)}`}
            stroke={s.color} strokeWidth={sw} fill="none" />
        )
      })}
    </svg>
  )
}

const MODEL_COLORS = ['#D97757','#E8896A','#10A37F','#F0AC8A','#0D8A6A','#4285F4','#6B7280']

/* ═══════════════════════════════════════════════════════════
   CLIENT
═══════════════════════════════════════════════════════════ */
interface Props { initialData: AnalyticsData }

export function AnalyticsClient({ initialData }: Props) {
  const router                      = useRouter()
  const [isPending, startTransition] = useTransition()
  const [range,   setRange]   = useState<Range>('30D')
  const [metric,  setMetric]  = useState<Metric>('cost')
  const [compare, setCompare] = useState(true)
  const [hovIdx,  setHovIdx]  = useState<number | null>(null)

  function refresh() {
    startTransition(() => { router.refresh() })
  }

  const data = useMemo(() =>
    range === '7D' ? initialData.daily.slice(-7) : initialData.daily,
    [range, initialData.daily])

  const totCost      = useMemo(() => data.reduce((s, d) => s + d.cost,  0), [data])
  const totPrev      = useMemo(() => data.reduce((s, d) => s + d.prev,  0), [data])
  const totTok       = useMemo(() => data.reduce((s, d) => s + d.tok,   0), [data])
  const totCalls     = useMemo(() => data.reduce((s, d) => s + d.calls, 0), [data])
  const totPrevTok   = useMemo(() => data.reduce((s, d) => s + d.prevTok,   0), [data])
  const totPrevCalls = useMemo(() => data.reduce((s, d) => s + d.prevCalls, 0), [data])

  const projected = data.length > 0 ? (totCost / data.length) * 30 : 0
  const budget    = initialData.orgBudget   // null = no budget set
  const budgetPct = budget && budget > 0 ? (projected / budget) * 100 : 0
  const costDelta = totPrev > 0 ? ((totCost - totPrev) / totPrev) * 100 : 0

  /* ── spike/anomaly detection ── */
  const avgCost = data.length > 0 ? totCost / data.length : 0
  const spikes  = data.filter(d => d.cost > avgCost * 2)

  /* ── dynamic insights ── */
  const topModel   = initialData.byModel[0]
  const topProject = initialData.byProject[0]

  const hasData = totCost > 0

  // Resolve model colors (server passes color in each ModelSlice)
  const models = initialData.byModel.map((m, i) => ({ ...m, color: m.color || MODEL_COLORS[i % MODEL_COLORS.length] }))

  const dateLabel = data.length > 0
    ? `${data[0].d} – ${data[data.length - 1].d} · ${data.length} days`
    : 'No data'

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Analytics</h1>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">{dateLabel} · Full cost & usage intelligence</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setCompare(v => !v)}
            className={cn('flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[12px] font-semibold transition-all',
              compare ? 'bg-teal/10 border-teal/30 text-teal' : 'border-[var(--border)] text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
            <TrendingUp size={12} /> Compare prev period
          </button>
          <div className="flex gap-0.5 p-1 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl">
            {(['7D','30D'] as Range[]).map(r => (
              <button key={r} onClick={() => setRange(r)}
                className={cn('px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all',
                  range === r ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
                {r}
              </button>
            ))}
          </div>
          <button
            onClick={refresh}
            disabled={isPending}
            className="btn-secondary"
            title="Reload latest data">
            <RefreshCw size={13} className={isPending ? 'animate-spin' : ''} />
            {isPending ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="btn-secondary"><Download size={13} /> Export</button>
        </div>
      </div>

      {/* ── KPI Strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <KpiCard label="Spend MTD" value={hasData ? `$${totCost.toFixed(2)}` : '$0.00'}
          sub={hasData ? `$${(totCost/data.length).toFixed(2)}/day avg` : 'No usage yet'}
          delta={totPrev > 0 ? costDelta : undefined} deltaLabel="vs prior period"
          iconColor="#D97757">
          <DollarSign size={15} />
        </KpiCard>
        <KpiCard label="Projected EOM" value={`$${projected.toFixed(2)}`}
          sub={budget ? `of $${budget.toLocaleString()} budget` : 'No org budget set — add in Limits'}
          delta={budget && budgetPct > 0 ? budgetPct - 100 : undefined} deltaLabel="over/under pace"
          iconColor={budget && budgetPct > 90 ? '#EF4444' : '#F59E0B'} warning={!!(budget && budgetPct > 80)}>
          <TrendingUp size={15} />
        </KpiCard>
        <KpiCard label="Budget Pace" value={budget ? `${budgetPct.toFixed(0)}%` : '—'}
          sub={budget ? `$${(budget - projected).toFixed(0)} headroom` : 'Set a limit to track pace'}
          iconColor={budget && budgetPct > 90 ? '#EF4444' : '#F59E0B'} warning={!!(budget && budgetPct > 80)}>
          <Activity size={15} />
        </KpiCard>
        <KpiCard label="Tokens MTD" value={`${totTok.toFixed(1)}M`}
          sub={`${(totTok/Math.max(data.length,1)).toFixed(1)}M/day avg`}
          delta={totPrevTok > 0 ? ((totTok/totPrevTok)-1)*100 : undefined} deltaLabel="vs prior period"
          iconColor="#20B2AA">
          <Zap size={15} />
        </KpiCard>
        <KpiCard label="API Calls" value={totCalls.toLocaleString()}
          sub={`${Math.round(totCalls/Math.max(data.length,1)).toLocaleString()}/day avg`}
          delta={totPrevCalls > 0 ? ((totCalls/totPrevCalls)-1)*100 : undefined} deltaLabel="vs prior period"
          iconColor="#4285F4">
          <BarChart3 size={15} />
        </KpiCard>
        <KpiCard label="Avg $/M Tokens" value={totTok > 0 ? `$${(totCost/totTok).toFixed(2)}` : '—'}
          sub="blended rate · all models"
          iconColor="#8B5CF6">
          <Cpu size={15} />
        </KpiCard>
      </div>

      {/* ── Main Chart ── */}
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-wrap gap-3">
          <div className="flex items-center gap-5">
            <p className="text-[13.5px] font-bold text-[var(--fg)]">Daily breakdown</p>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <div className="w-7 h-[2.5px] rounded bg-coral" />
                <span className="text-[11px] text-[var(--fg-secondary)]">This period</span>
              </div>
              {compare && <div className="flex items-center gap-1.5">
                <div className="w-7 border-t-[2px] border-dashed border-teal opacity-60" />
                <span className="text-[11px] text-[var(--fg-tertiary)]">Prev period</span>
              </div>}
              <div className="flex items-center gap-1.5">
                <div className="w-6 border-t-2 border-dashed border-[var(--red)] opacity-50" />
                <span className="text-[11px] text-[var(--fg-tertiary)]">Budget</span>
              </div>
            </div>
          </div>
          <div className="flex gap-0.5 p-0.5 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl">
            {([['cost','Cost'],['tokens','Tokens'],['calls','Calls']] as [Metric,string][]).map(([m,l]) => (
              <button key={m} onClick={() => setMetric(m)}
                className={cn('px-3 py-1.5 rounded-lg text-[11.5px] font-semibold transition-all',
                  metric === m ? 'bg-white dark:bg-[#1E1E35] text-[var(--fg)] shadow-sm' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="px-2 pt-2 pb-0">
          <AreaChart data={data} metric={metric} compare={compare} hovIdx={hovIdx} onHover={setHovIdx} />
        </div>
      </div>

      {/* ── 3-col breakdown ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* By Model */}
        <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-bold text-[var(--fg)]">By model</p>
            <Link href="/dashboard/analytics/models" className="text-[11.5px] font-semibold text-coral hover:opacity-80 flex items-center gap-1">
              Details <ChevronRight size={11} />
            </Link>
          </div>
          {models.length > 0 ? (
            <>
              <div className="flex items-center gap-4">
                <MiniDonut slices={models.map(m => ({ pct: m.pct, color: m.color }))} />
                <div className="flex-1 space-y-2">
                  {models.slice(0,5).map(m => (
                    <div key={m.name} className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: m.color }} />
                      <span className="text-[10.5px] text-[var(--fg-secondary)] truncate flex-1">{m.name.replace('claude-','').replace('gpt-','gpt-')}</span>
                      <span className="text-[11px] font-bold text-[var(--fg)] tabular-nums">{m.pct.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-2 pt-1">
                {models.slice(0,5).map(m => (
                  <div key={m.name}>
                    <div className="flex justify-between mb-0.5">
                      <span className="text-[10px] text-[var(--fg-tertiary)] truncate">{m.name}</span>
                      <span className="text-[10.5px] font-semibold text-[var(--fg)] tabular-nums">${m.cost.toFixed(0)}</span>
                    </div>
                    <div className="h-1 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width:`${m.pct}%`, background:m.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[12px] text-[var(--fg-tertiary)] py-4 text-center">No model data yet</p>
          )}
        </div>

        {/* By Project */}
        <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-bold text-[var(--fg)]">By project</p>
            <Link href="/dashboard/analytics/projects" className="text-[11.5px] font-semibold text-coral hover:opacity-80 flex items-center gap-1">
              Details <ChevronRight size={11} />
            </Link>
          </div>
          {initialData.byProject.length > 0 ? (
            <div className="space-y-3">
              {initialData.byProject.map((p, i) => (
                <div key={p.name} className="flex items-center gap-3">
                  <span className="w-5 h-5 rounded-lg bg-[var(--bg-secondary)] text-[10px] font-bold text-[var(--fg-tertiary)] flex items-center justify-center flex-shrink-0">{i+1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px] font-semibold text-[var(--fg)] truncate">{p.name}</span>
                      <span className="text-[12px] font-bold text-[var(--fg)] tabular-nums ml-2 flex-shrink-0">${p.cost.toFixed(0)}</span>
                    </div>
                    <div className="h-1 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                      <div className="h-full bg-coral/70 rounded-full" style={{ width:`${p.pct}%` }} />
                    </div>
                    <p className="text-[10px] text-[var(--fg-tertiary)] mt-0.5">{p.calls.toLocaleString()} calls</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-[var(--fg-tertiary)] py-4 text-center">No project data yet</p>
          )}
        </div>

        {/* By Platform */}
        <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-bold text-[var(--fg)]">By platform</p>
            <Link href="/dashboard/mcp" className="text-[11.5px] font-semibold text-coral hover:opacity-80 flex items-center gap-1">
              Manage <ChevronRight size={11} />
            </Link>
          </div>
          {initialData.byPlatform.length > 0 ? (
            <>
              <div className="space-y-3">
                {initialData.byPlatform.map(p => (
                  <div key={p.name}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background:p.color }} />
                        <span className="text-[12px] font-semibold text-[var(--fg)]">{p.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10.5px] text-[var(--fg-tertiary)]">{p.pct.toFixed(1)}%</span>
                        <span className="text-[12px] font-bold text-[var(--fg)] tabular-nums">${p.cost.toFixed(0)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width:`${p.pct}%`, background:p.color }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="pt-1 border-t border-[var(--border)] flex items-center gap-2">
                <Puzzle size={12} className="text-[var(--fg-tertiary)]" />
                <p className="text-[11px] text-[var(--fg-tertiary)]">{initialData.byPlatform.length} connected · <Link href="/dashboard/mcp" className="text-coral hover:underline">add platform</Link></p>
              </div>
            </>
          ) : (
            <div className="py-4 text-center space-y-2">
              <p className="text-[12px] text-[var(--fg-tertiary)]">No platforms connected yet</p>
              <Link href="/dashboard/mcp" className="text-[11.5px] font-semibold text-coral hover:underline">Connect a platform →</Link>
            </div>
          )}
        </div>
      </div>

      {/* ── Anomaly + Insights ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[var(--amber-bg)] border border-[var(--amber)]/30 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-[var(--amber)]" />
            <p className="text-[13px] font-bold text-[var(--amber)]">
              {spikes.length > 0 ? `${spikes.length} anomal${spikes.length > 1 ? 'ies' : 'y'} detected` : 'No anomalies'}
            </p>
          </div>
          {spikes.length > 0 ? spikes.slice(0, 3).map((s, i) => (
            <div key={i} className="flex items-start gap-2.5 p-3 bg-white/40 dark:bg-black/10 rounded-xl">
              <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 bg-[var(--red)]" />
              <div>
                <p className="text-[11.5px] font-semibold text-[var(--fg)]">{s.d}</p>
                <p className="text-[11px] text-[var(--fg-secondary)] leading-relaxed">
                  ${s.cost.toFixed(2)} — {avgCost > 0 ? (s.cost / avgCost).toFixed(1) : '?'}× daily average
                </p>
              </div>
            </div>
          )) : (
            <p className="text-[12px] text-[var(--fg-secondary)] py-2">Spend is within normal range for this period.</p>
          )}
        </div>

        <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Lightbulb size={14} className="text-[#8B5CF6]" />
            <p className="text-[13px] font-bold text-[var(--fg)]">Intelligence</p>
          </div>
          {hasData ? (
            <>
              {costDelta !== 0 && (
                <div className="flex items-start gap-2.5 p-3 bg-[var(--bg-secondary)] rounded-xl">
                  <TrendingUp size={13} style={{ color: costDelta > 0 ? '#EF4444' : '#20B2AA' }} className="mt-0.5 flex-shrink-0" />
                  <p className="text-[11.5px] text-[var(--fg-secondary)] leading-relaxed">
                    Spend {costDelta > 0 ? '+' : ''}{costDelta.toFixed(1)}% vs same period prior. {costDelta > 20 ? 'Investigate top cost drivers.' : 'On track.'}
                  </p>
                </div>
              )}
              {topModel && (
                <div className="flex items-start gap-2.5 p-3 bg-[var(--bg-secondary)] rounded-xl">
                  <Cpu size={13} style={{ color: '#8B5CF6' }} className="mt-0.5 flex-shrink-0" />
                  <p className="text-[11.5px] text-[var(--fg-secondary)] leading-relaxed">
                    <strong>{topModel.name}</strong> = {topModel.pct.toFixed(1)}% of total cost this period.
                  </p>
                </div>
              )}
              {topProject && (
                <div className="flex items-start gap-2.5 p-3 bg-[var(--bg-secondary)] rounded-xl">
                  <Layers size={13} style={{ color: '#20B2AA' }} className="mt-0.5 flex-shrink-0" />
                  <p className="text-[11.5px] text-[var(--fg-secondary)] leading-relaxed">
                    Top project: <strong>{topProject.name}</strong> — ${topProject.cost.toFixed(2)} ({topProject.pct.toFixed(1)}% of spend).
                  </p>
                </div>
              )}
              {totTok > 0 && (
                <div className="flex items-start gap-2.5 p-3 bg-[var(--bg-secondary)] rounded-xl">
                  <Activity size={13} style={{ color: '#4285F4' }} className="mt-0.5 flex-shrink-0" />
                  <p className="text-[11.5px] text-[var(--fg-secondary)] leading-relaxed">
                    Blended rate: ${(totCost / totTok).toFixed(3)}/1K tokens across all models.
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="text-[12px] text-[var(--fg-tertiary)] py-2">Insights appear once usage data flows in.</p>
          )}
        </div>
      </div>

      {/* ── Sub-page nav ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { href:'/dashboard/analytics/models',   icon:Cpu,       label:'By Model',     desc:'Cost & efficiency per model, provider compare' },
          { href:'/dashboard/analytics/projects', icon:Layers,    label:'By Project',   desc:'Leaderboard, team attribution, spend trends' },
          { href:'/dashboard/analytics/costs',    icon:DollarSign,label:'Cost Reports', desc:'Export, scheduled reports, period summaries' },
        ].map(l => {
          const Icon = l.icon
          return (
            <Link key={l.href} href={l.href}
              className="flex items-center gap-4 p-4 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl hover:border-coral/40 hover:bg-coral/5 transition-all group">
              <div className="w-10 h-10 rounded-2xl bg-coral/10 flex items-center justify-center flex-shrink-0 group-hover:bg-coral/20 transition-colors">
                <Icon size={18} className="text-coral" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-[var(--fg)] group-hover:text-coral transition-colors">{l.label}</p>
                <p className="text-[11px] text-[var(--fg-tertiary)] mt-0.5">{l.desc}</p>
              </div>
              <ChevronRight size={14} className="text-[var(--fg-tertiary)] group-hover:text-coral transition-colors" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}
