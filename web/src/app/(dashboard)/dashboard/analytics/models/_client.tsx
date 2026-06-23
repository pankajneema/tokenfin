'use client'
import { useState, useMemo } from 'react'
import { ArrowUpRight, ArrowDownRight, Download, Check, Filter, ChevronUp, ChevronDown, Cpu } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ═══════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════ */
type SortKey = 'cost' | 'tokens' | 'calls' | 'efficiency' | 'pct'
type SortDir = 'asc' | 'desc'

export interface ModelRow {
  id:           string
  name:         string
  provider:     string
  tier:         'frontier' | 'standard' | 'fast'
  color:        string
  bg:           string
  costPer1M:    number
  cost30d:      number
  costPrev:     number
  inputTok:     number   // millions
  outputTok:    number   // millions
  calls30d:     number
  callsPrev:    number
  avgLatencyMs: number
  deprecated?:  boolean
}

interface Props { models: ModelRow[] }

/* ── Provider color palette for dynamic providers ── */
const PROVIDER_COLORS: Record<string, string> = {
  Anthropic: '#D97757',
  OpenAI:    '#10A37F',
  Google:    '#4285F4',
  Other:     '#8B5CF6',
}
function providerColor(p: string) {
  return PROVIDER_COLORS[p] ?? '#6B7280'
}
function providerAbbr(p: string) {
  return p.slice(0, 2).toUpperCase()
}

const TIER_META: Record<string, { label: string; bg: string; color: string }> = {
  frontier: { label: 'Frontier', bg: 'bg-[#8B5CF6]/10',          color: 'text-[#8B5CF6]' },
  standard: { label: 'Standard', bg: 'bg-[var(--blue-bg)]',       color: 'text-[var(--blue)]'  },
  fast:     { label: 'Fast',     bg: 'bg-[var(--green-bg)]',      color: 'text-teal'            },
}

/* ═══════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════ */
function fmtTokens(millions: number): string {
  if (millions >= 1000) return `${(millions / 1000).toFixed(1)}B`
  if (millions >= 1)    return `${millions.toFixed(2)}M`
  if (millions >= 0.001) return `${(millions * 1000).toFixed(0)}K`
  if (millions > 0)     return '<1K'
  return '—'
}

function fmtCost(usd: number): string {
  if (usd === 0)   return '$0.00'
  if (usd < 0.01)  return `$${usd.toFixed(4)}`
  if (usd < 1)     return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

function DeltaBadge({ curr, prev, size = 10 }: { curr: number; prev: number; size?: number }) {
  if (prev === 0) return <span className="text-[10px] text-[var(--fg-tertiary)]">New</span>
  const d = ((curr - prev) / prev) * 100
  return (
    <span className={cn('flex items-center gap-0.5 font-semibold', d > 0 ? 'text-[var(--red)]' : 'text-teal')}
      style={{ fontSize: size }}>
      {d > 0 ? <ArrowUpRight size={size} /> : <ArrowDownRight size={size} />}
      {Math.abs(d).toFixed(1)}%
    </span>
  )
}

/* ═══════════════════════════════════════════════════════════
   CSV EXPORT
═══════════════════════════════════════════════════════════ */
function downloadModelsCSV(models: ModelRow[]) {
  const headers = ['Model','Provider','Tier','Cost 30d ($)','vs Prior (%)','Input Tokens (M)','Output Tokens (M)','API Calls','$/1M tokens']
  const lines = models.map(m => {
    const delta = m.costPrev > 0 ? ((m.cost30d - m.costPrev) / m.costPrev * 100).toFixed(1) + '%' : 'N/A'
    return [m.name, m.provider, m.tier, m.cost30d.toFixed(4), delta, m.inputTok.toFixed(4), m.outputTok.toFixed(4), m.calls30d, m.costPer1M.toFixed(3)]
  })
  const csv = [headers, ...lines].map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = 'tokenfin-by-model.csv'; a.click()
  URL.revokeObjectURL(url)
}

/* ═══════════════════════════════════════════════════════════
   TREND LINE
═══════════════════════════════════════════════════════════ */
function TrendLine({ prev, curr, color }: { prev: number; curr: number; color: string }) {
  const w = 80, h = 24, pad = 3
  const lo = Math.min(prev, curr), hi = Math.max(prev, curr)
  const range = hi - lo || 1
  const y1 = (h - pad) - ((prev - lo) / range) * (h - pad * 2)
  const y2 = (h - pad) - ((curr - lo) / range) * (h - pad * 2)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-[80px] h-[24px]">
      <line x1="4" y1={y1.toFixed(1)} x2={w - 4} y2={y2.toFixed(1)}
        stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx={w - 4} cy={y2.toFixed(1)} r="2.5" fill={color} />
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════
   EFFICIENCY BADGE
═══════════════════════════════════════════════════════════ */
function EffBadge({ costPer1M }: { costPer1M: number }) {
  const stars = costPer1M === 0 ? 0 : costPer1M < 0.5 ? 5 : costPer1M < 1.5 ? 4 : costPer1M < 5 ? 3 : costPer1M < 10 ? 2 : 1
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={cn('text-[10px]', i < stars ? 'text-[var(--amber)]' : 'text-[var(--border-strong)]')}>★</span>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   PAGE
═══════════════════════════════════════════════════════════ */
export function ModelsClient({ models }: Props) {
  const [provFil,    setProvFil]    = useState<string>('all')
  const [tierFil,    setTierFil]    = useState<string>('all')
  const [sortKey,    setSortKey]    = useState<SortKey>('cost')
  const [sortDir,    setSortDir]    = useState<SortDir>('desc')
  const [exportDone, setExportDone] = useState(false)

  function handleExport() {
    downloadModelsCSV(filtered)
    setExportDone(true)
    setTimeout(() => setExportDone(false), 2500)
  }

  const dateRange = (() => {
    const now = new Date()
    const start = new Date(now.getTime() - 30 * 86400_000)
    return `${start.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${now.toLocaleDateString('en-US',{month:'short',day:'numeric'})}`
  })()

  const totalCost  = models.reduce((s, m) => s + m.cost30d, 0)
  const totalTokM  = models.reduce((s, m) => s + m.inputTok + m.outputTok, 0)
  const totalCalls = models.reduce((s, m) => s + m.calls30d, 0)

  // Derive providers dynamically — only providers that appear in real data
  const activeProviders = useMemo(() =>
    Array.from(new Set(models.map(m => m.provider))).sort(),
    [models])

  const filtered = useMemo(() => models
    .filter(m => provFil === 'all' || m.provider === provFil)
    .filter(m => tierFil === 'all' || m.tier === tierFil)
    .sort((a, b) => {
      const av = sortKey === 'cost'       ? a.cost30d
               : sortKey === 'tokens'     ? a.inputTok + a.outputTok
               : sortKey === 'calls'      ? a.calls30d
               : sortKey === 'efficiency' ? a.costPer1M
               : (a.cost30d / (totalCost || 1))
      const bv = sortKey === 'cost'       ? b.cost30d
               : sortKey === 'tokens'     ? b.inputTok + b.outputTok
               : sortKey === 'calls'      ? b.calls30d
               : sortKey === 'efficiency' ? b.costPer1M
               : (b.cost30d / (totalCost || 1))
      return sortDir === 'desc' ? bv - av : av - bv
    }), [models, provFil, tierFil, sortKey, sortDir, totalCost])

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(k); setSortDir('desc') }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="w-3 h-3 opacity-20"><ChevronDown size={11} /></span>
    return sortDir === 'desc' ? <ChevronDown size={11} className="text-coral" /> : <ChevronUp size={11} className="text-coral" />
  }

  // Active tiers in data
  const activeTiers = Array.from(new Set(models.map(m => m.tier)))

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">By Model</h1>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">Cost, token usage, efficiency and latency — {dateRange}</p>
        </div>
        <button onClick={handleExport}
          className={cn('flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12.5px] font-semibold border transition-all',
            exportDone ? 'bg-teal/10 border-teal/30 text-teal' : 'btn-secondary')}>
          {exportDone ? <><Check size={13} /> Exported!</> : <><Download size={13} /> Export CSV</>}
        </button>
      </div>

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:'Total spend (30d)', value: fmtCost(totalCost),           color:'#D97757' },
          { label:'Total tokens',      value: fmtTokens(totalTokM),         color:'#20B2AA' },
          { label:'Total calls',       value: totalCalls.toLocaleString(),   color:'#4285F4' },
          { label:'Models in use',     value: `${models.length}`,           color:'#8B5CF6' },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:`${s.color}18` }}>
              <Cpu size={16} style={{ color: s.color }} />
            </div>
            <div>
              <p className="text-[18px] font-bold text-[var(--fg)] tabular-nums">{s.value}</p>
              <p className="text-[10.5px] text-[var(--fg-tertiary)]">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Provider breakdown — only active providers ── */}
      {activeProviders.length > 0 && (
        <div className={cn('grid gap-3', activeProviders.length === 1 ? 'grid-cols-1 max-w-sm' : activeProviders.length === 2 ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-3')}>
          {activeProviders.map(prov => {
            const pColor     = providerColor(prov)
            const provModels = models.filter(m => m.provider === prov)
            const provCost   = provModels.reduce((s, m) => s + m.cost30d, 0)
            const provTok    = provModels.reduce((s, m) => s + m.inputTok + m.outputTok, 0)
            const provPct    = totalCost > 0 ? (provCost / totalCost) * 100 : 0
            return (
              <div key={prov} className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: pColor }} />
                    <p className="text-[13px] font-bold text-[var(--fg)]">{prov}</p>
                  </div>
                  <span className="text-[12px] font-semibold text-[var(--fg-tertiary)]">{provPct.toFixed(0)}% of spend</span>
                </div>
                <div>
                  <div className="flex items-end justify-between mb-1.5">
                    <span className="text-[20px] font-bold text-[var(--fg)] tabular-nums">{fmtCost(provCost)}</span>
                    <span className="text-[11px] text-[var(--fg-tertiary)]">{fmtTokens(provTok)} · {provModels.length} model{provModels.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width:`${provPct}%`, background: pColor }} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {provModels.map(m => {
                    const tm = TIER_META[m.tier]
                    return (
                      <span key={m.id} className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-md', tm.bg, tm.color)}>
                        {m.name.replace(/^(claude|gpt|gemini)-?/, '')}
                      </span>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Provider filter — only shown if >1 provider */}
        {activeProviders.length > 1 && (
          <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl">
            <button onClick={() => setProvFil('all')}
              className={cn('px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all',
                provFil==='all'?'bg-[var(--fg)] text-[var(--bg)]':'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
              All providers
            </button>
            {activeProviders.map(p => (
              <button key={p} onClick={() => setProvFil(p)}
                className={cn('px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all',
                  provFil===p?'bg-[var(--fg)] text-[var(--bg)]':'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
                {p}
              </button>
            ))}
          </div>
        )}

        {/* Tier filter — only shown if >1 tier */}
        {activeTiers.length > 1 && (
          <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl">
            <button onClick={() => setTierFil('all')}
              className={cn('px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all',
                tierFil==='all'?'bg-[var(--fg)] text-[var(--bg)]':'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
              All tiers
            </button>
            {activeTiers.map(t => {
              const tm = TIER_META[t]
              return (
                <button key={t} onClick={() => setTierFil(t)}
                  className={cn('px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all capitalize',
                    tierFil===t?'bg-[var(--fg)] text-[var(--bg)]':'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
                  {tm?.label ?? t}
                </button>
              )
            })}
          </div>
        )}

        <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--fg-tertiary)] ml-auto">
          <Filter size={12} /> {filtered.length} of {models.length} model{models.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* ── Model table ── */}
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_100px] gap-3 px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          {[
            { label:'Model',      key:null as SortKey|null },
            { label:'Cost MTD',   key:'cost'       as SortKey },
            { label:'Tokens',     key:'tokens'     as SortKey },
            { label:'Calls',      key:'calls'      as SortKey },
            { label:'$/M tokens', key:'efficiency' as SortKey },
            { label:'% of spend', key:'pct'        as SortKey },
            { label:'30d trend',  key:null         as SortKey|null },
          ].map(({ label, key }) => (
            <button key={label}
              onClick={() => key && toggleSort(key)}
              className={cn('flex items-center gap-1 text-[10.5px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider text-left',
                key && 'hover:text-[var(--fg)] cursor-pointer transition-colors', !key && 'cursor-default')}>
              {label}
              {key && <SortIcon k={key} />}
            </button>
          ))}
        </div>

        <div className="divide-y divide-[var(--border)]">
          {filtered.map(m => {
            const pColor  = providerColor(m.provider)
            const pct     = totalCost > 0 ? (m.cost30d / totalCost) * 100 : 0
            const totTokM = m.inputTok + m.outputTok
            const tm      = TIER_META[m.tier]
            return (
              <div key={m.id}
                className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_100px] gap-3 px-5 py-4 hover:bg-[var(--bg-secondary)]/40 transition-colors items-center">

                {/* Model name */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background:`${pColor}20` }}>
                    <span className="text-[10px] font-bold" style={{ color: pColor }}>
                      {providerAbbr(m.provider)}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-[var(--fg)] truncate">{m.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={cn('text-[9.5px] font-semibold px-1.5 py-0.5 rounded-md', tm.bg, tm.color)}>{tm.label}</span>
                      {m.avgLatencyMs > 0 && <span className="text-[10px] text-[var(--fg-tertiary)]">{m.avgLatencyMs}ms</span>}
                    </div>
                  </div>
                </div>

                {/* Cost */}
                <div>
                  <p className="text-[13px] font-bold text-[var(--fg)] tabular-nums">{fmtCost(m.cost30d)}</p>
                  <div className="mt-0.5">
                    <DeltaBadge curr={m.cost30d} prev={m.costPrev} />
                  </div>
                </div>

                {/* Tokens */}
                <div>
                  <p className="text-[13px] font-semibold text-[var(--fg)] tabular-nums">{fmtTokens(totTokM)}</p>
                  <p className="text-[10px] text-[var(--fg-tertiary)] mt-0.5">
                    {fmtTokens(m.inputTok)} in · {fmtTokens(m.outputTok)} out
                  </p>
                </div>

                {/* Calls */}
                <div>
                  <p className="text-[13px] font-semibold text-[var(--fg)] tabular-nums">{m.calls30d.toLocaleString()}</p>
                  <div className="mt-0.5">
                    <DeltaBadge curr={m.calls30d} prev={m.callsPrev} />
                  </div>
                </div>

                {/* $/M tokens */}
                <div>
                  <p className="text-[13px] font-semibold text-[var(--fg)] tabular-nums">
                    {m.costPer1M > 0 ? `$${m.costPer1M.toFixed(2)}` : '—'}
                  </p>
                  {m.costPer1M > 0 && <EffBadge costPer1M={m.costPer1M} />}
                </div>

                {/* % of spend */}
                <div>
                  <p className="text-[13px] font-semibold text-[var(--fg)] tabular-nums">{pct.toFixed(1)}%</p>
                  <div className="h-1 bg-[var(--bg-secondary)] rounded-full overflow-hidden mt-1.5 w-[60px]">
                    <div className="h-full rounded-full" style={{ width:`${pct}%`, background: m.color }} />
                  </div>
                </div>

                {/* Trend line */}
                <div className="flex items-center">
                  <TrendLine prev={m.costPrev} curr={m.cost30d} color={m.color} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

    </div>
  )
}
