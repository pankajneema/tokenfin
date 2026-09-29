'use client'
import { useState, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
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
  color:        string
  /** $/1M input & output from lib/mcp/pricing.ts or the org's override */
  priceIn:      number
  priceOut:     number
  priceSource:  'override' | 'list' | 'unknown'
  /** effective $/1M actually paid (measured) */
  costPer1M:    number
  cost30d:      number
  metered:      number
  notional:     number
  costPrev:     number
  inputTok:     number   // millions
  outputTok:    number   // millions
  calls30d:     number
  callsPrev:    number
  /** measured mean latency from telemetry; null when no latency was reported */
  avgLatencyMs: number | null
}

interface Props {
  models: ModelRow[]; days: number; windowLabel: string; totalPrompts: number
  meteredCost: number; notionalCost: number
}

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

const PRICE_SOURCE_LABEL: Record<ModelRow['priceSource'], string> = {
  override: 'custom price',
  list:     'list price',
  unknown:  'unknown model · fallback price',
}
function fmtRate(p: number) { return p < 1 ? `$${p.toFixed(p < 0.1 ? 3 : 2)}` : `$${p.toFixed(2)}` }

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
  const headers = ['Model','Provider','Cost ($)','Metered ($)','Notional ($)','vs Prior (%)','Input Tokens (M)','Output Tokens (M)','LLM Calls','Effective $/1M tokens','Input $/1M','Output $/1M','Price source','Avg latency (ms)']
  const lines = models.map(m => {
    const delta = m.costPrev > 0 ? ((m.cost30d - m.costPrev) / m.costPrev * 100).toFixed(1) + '%' : 'N/A'
    return [m.name, m.provider, m.cost30d.toFixed(4), m.metered.toFixed(4), m.notional.toFixed(4), delta, m.inputTok.toFixed(4), m.outputTok.toFixed(4), m.calls30d, m.costPer1M.toFixed(3), m.priceIn, m.priceOut, m.priceSource, m.avgLatencyMs ?? '']
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
const DAY_OPTIONS = [
  { label: '7D',  value: 7  },
  { label: '30D', value: 30 },
  { label: '90D', value: 90 },
]

export function ModelsClient({ models, days, windowLabel, totalPrompts, meteredCost, notionalCost }: Props) {
  const router   = useRouter()
  const pathname = usePathname()
  const [provFil,    setProvFil]    = useState<string>('all')
  const [sortKey,    setSortKey]    = useState<SortKey>('cost')
  const [sortDir,    setSortDir]    = useState<SortDir>('desc')
  const [exportDone, setExportDone] = useState(false)

  function setDays(d: number) {
    router.push(`${pathname}?days=${d}`)
  }

  function handleExport() {
    downloadModelsCSV(filtered)
    setExportDone(true)
    setTimeout(() => setExportDone(false), 2500)
  }


  const totalCost  = models.reduce((s, m) => s + m.cost30d, 0)
  const totalTokM  = models.reduce((s, m) => s + m.inputTok + m.outputTok, 0)
  const totalCalls = models.reduce((s, m) => s + m.calls30d, 0)

  // Derive providers dynamically — only providers that appear in real data
  const activeProviders = useMemo(() =>
    Array.from(new Set(models.map(m => m.provider))).sort(),
    [models])

  const filtered = useMemo(() => models
    .filter(m => provFil === 'all' || m.provider === provFil)
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
    }), [models, provFil, sortKey, sortDir, totalCost])

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(k); setSortDir('desc') }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="w-3 h-3 opacity-20"><ChevronDown size={11} /></span>
    return sortDir === 'desc' ? <ChevronDown size={11} className="text-coral" /> : <ChevronUp size={11} className="text-coral" />
  }

  if (models.length === 0) {
    return (
      <div className="space-y-5">
        <p className="text-[13px] text-[var(--fg-secondary)]">{windowLabel}</p>
        <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-12 text-center">
          <Cpu size={32} className="mx-auto mb-3 text-[var(--fg-tertiary)]" />
          <p className="text-[14px] font-semibold text-[var(--fg)]">No model usage yet</p>
          <p className="text-[12px] text-[var(--fg-tertiary)] mt-1">
            Send events via <code className="font-mono bg-[var(--bg-secondary)] px-1 rounded">POST /api/v1/ingest</code> to see per-model breakdown here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-[13px] text-[var(--fg-secondary)]">Cost, token usage, prices and measured latency · {windowLabel}</p>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Date range pills */}
          <div className="flex items-center gap-1 p-1 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl">
            {DAY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setDays(opt.value)}
                className={cn(
                  'px-3 py-1 rounded-lg text-[12px] font-semibold transition-all',
                  days === opt.value
                    ? 'bg-white dark:bg-[#1e1e3a] text-[var(--fg)] shadow-sm'
                    : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button onClick={handleExport}
            className={cn('flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12.5px] font-semibold border transition-all',
              exportDone ? 'bg-teal/10 border-teal/30 text-teal' : 'btn-secondary')}>
            {exportDone ? <><Check size={13} /> Exported!</> : <><Download size={13} /> Export CSV</>}
          </button>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label:`Spend · ${fmtCost(meteredCost)} metered · ${fmtCost(notionalCost)} notional`, value: fmtCost(totalCost), color:'#D97757' },
          { label:'Total tokens',      value: fmtTokens(totalTokM),         color:'#20B2AA' },
          { label:'Prompts',            value: totalPrompts.toLocaleString(), color:'#F59E0B' },
          { label:'LLM calls',          value: totalCalls.toLocaleString(),   color:'#4285F4' },
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
                  {provModels.map(m => (
                    <span key={m.id} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-[var(--bg-secondary)] text-[var(--fg-secondary)]">
                      {m.name.replace(/^(claude|gpt|gemini)-?/, '')}
                    </span>
                  ))}
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

        <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--fg-tertiary)] ml-auto">
          <Filter size={12} /> {filtered.length} of {models.length} model{models.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* ── Model table ── */}
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_100px] gap-3 px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          {[
            { label:'Model',      key:null as SortKey|null },
            { label:'Cost',       key:'cost'       as SortKey },
            { label:'Tokens',     key:'tokens'     as SortKey },
            { label:'Calls',      key:'calls'      as SortKey },
            { label:'$/M tokens', key:'efficiency' as SortKey },
            { label:'% of spend', key:'pct'        as SortKey },
            { label:'vs prior',   key:null         as SortKey|null },
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
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-[10px] text-[var(--fg-tertiary)]" title={PRICE_SOURCE_LABEL[m.priceSource]}>
                        {fmtRate(m.priceIn)} in · {fmtRate(m.priceOut)} out /1M{m.priceSource === 'override' ? ' (custom)' : m.priceSource === 'unknown' ? ' (fallback)' : ''}
                      </span>
                      <span className="text-[10px] text-[var(--fg-tertiary)]">
                        {m.avgLatencyMs != null ? `· ${Math.round(m.avgLatencyMs).toLocaleString()} ms avg` : '· latency not reported'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Cost */}
                <div>
                  <p className="text-[13px] font-bold text-[var(--fg)] tabular-nums">{fmtCost(m.cost30d)}</p>
                  {m.notional > 0 && <p className="text-[10px] text-[var(--fg-tertiary)] tabular-nums">{fmtCost(m.metered)} metered · {fmtCost(m.notional)} notional</p>}
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
