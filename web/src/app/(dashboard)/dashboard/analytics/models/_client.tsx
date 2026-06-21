'use client'
import { useState, useMemo } from 'react'
import { ArrowUpRight, ArrowDownRight, Download, Filter, ChevronUp, ChevronDown, Cpu } from 'lucide-react'
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

const PROVIDER_META: Record<string, { label: string; color: string }> = {
  Anthropic: { label: 'Anthropic', color: '#D97757' },
  OpenAI:    { label: 'OpenAI',    color: '#10A37F' },
  Google:    { label: 'Google',    color: '#4285F4' },
}
const TIER_META: Record<string, { label: string; bg: string; color: string }> = {
  frontier: { label: 'Frontier', bg: 'bg-[#8B5CF6]/10', color: 'text-[#8B5CF6]' },
  standard: { label: 'Standard', bg: 'bg-[var(--blue-bg)]',  color: 'text-[var(--blue)]'  },
  fast:     { label: 'Fast',     bg: 'bg-[var(--green-bg)]', color: 'text-teal'             },
}

/* ═══════════════════════════════════════════════════════════
   TREND LINE — uses real prev vs current cost, no fake data
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
  const stars = costPer1M < 0.5 ? 5 : costPer1M < 1.5 ? 4 : costPer1M < 5 ? 3 : costPer1M < 10 ? 2 : 1
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
  const [provFil,  setProvFil]  = useState<string>('all')
  const [tierFil,  setTierFil]  = useState<string>('all')
  const [sortKey,  setSortKey]  = useState<SortKey>('cost')
  const [sortDir,  setSortDir]  = useState<SortDir>('desc')

  const totalCost  = models.reduce((s, m) => s + m.cost30d, 0)
  const totalTok   = models.reduce((s, m) => s + m.inputTok + m.outputTok, 0)
  const totalCalls = models.reduce((s, m) => s + m.calls30d, 0)

  const filtered = useMemo(() => models
    .filter(m => provFil === 'all' || m.provider === provFil)
    .filter(m => tierFil === 'all' || m.tier === tierFil)
    .sort((a, b) => {
      const av = sortKey === 'cost'       ? a.cost30d
               : sortKey === 'tokens'     ? a.inputTok + a.outputTok
               : sortKey === 'calls'      ? a.calls30d
               : sortKey === 'efficiency' ? a.costPer1M
               : (a.cost30d / totalCost)
      const bv = sortKey === 'cost'       ? b.cost30d
               : sortKey === 'tokens'     ? b.inputTok + b.outputTok
               : sortKey === 'calls'      ? b.calls30d
               : sortKey === 'efficiency' ? b.costPer1M
               : (b.cost30d / totalCost)
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

  return (
    <div className="space-y-5 max-w-[1160px]">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">By Model</h1>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">Cost, token usage, efficiency and latency for every model — Jun 1–17</p>
        </div>
        <button className="btn-secondary"><Download size={13} /> Export CSV</button>
      </div>

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:'Total spend (30d)', value:`$${totalCost.toFixed(2)}`,            color:'#D97757' },
          { label:'Total tokens',     value:`${totalTok.toFixed(1)}M`,             color:'#20B2AA' },
          { label:'Total calls',      value:totalCalls.toLocaleString(),            color:'#4285F4' },
          { label:'Models in use',    value:`${models.length}`,                    color:'#8B5CF6' },
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

      {/* ── Provider comparison bars ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {Object.entries(PROVIDER_META).map(([prov, meta]) => {
          const provModels = models.filter(m => m.provider === prov)
          const provCost = provModels.reduce((s, m) => s + m.cost30d, 0)
          const provPct = totalCost > 0 ? (provCost / totalCost) * 100 : 0
          return (
            <div key={prov} className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: meta.color }} />
                  <p className="text-[13px] font-bold text-[var(--fg)]">{meta.label}</p>
                </div>
                <span className="text-[12px] font-semibold text-[var(--fg-tertiary)]">{provPct.toFixed(0)}% of spend</span>
              </div>
              <div>
                <div className="flex items-end justify-between mb-1.5">
                  <span className="text-[20px] font-bold text-[var(--fg)] tabular-nums">${provCost.toFixed(2)}</span>
                  <span className="text-[11px] text-[var(--fg-tertiary)]">{provModels.length} model{provModels.length>1?'s':''}</span>
                </div>
                <div className="h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width:`${provPct}%`, background: meta.color }} />
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {provModels.map(m => (
                  <span key={m.id} className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-md', TIER_META[m.tier].bg, TIER_META[m.tier].color)}>
                    {m.name.replace('claude-','').replace('gpt-','').replace('gemini-','')}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Filters ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl">
          <button onClick={() => setProvFil('all')}
            className={cn('px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all',
              provFil==='all'?'bg-[var(--fg)] text-[var(--bg)]':'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
            All providers
          </button>
          {Object.keys(PROVIDER_META).map(p => (
            <button key={p} onClick={() => setProvFil(p)}
              className={cn('px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all',
                provFil===p?'bg-[var(--fg)] text-[var(--bg)]':'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
              {p}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl">
          {['all','frontier','standard','fast'].map(t => (
            <button key={t} onClick={() => setTierFil(t)}
              className={cn('px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all capitalize',
                tierFil===t?'bg-[var(--fg)] text-[var(--bg)]':'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
              {t === 'all' ? 'All tiers' : t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--fg-tertiary)] ml-auto">
          <Filter size={12} /> {filtered.length} of {models.length} models
        </div>
      </div>

      {/* ── Model table ── */}
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
        {/* Table header */}
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

        {/* Rows */}
        <div className="divide-y divide-[var(--border)]">
          {filtered.map((m, rowI) => {
            const costDelta = ((m.cost30d - m.costPrev) / m.costPrev) * 100
            const callDelta = ((m.calls30d - m.callsPrev) / m.callsPrev) * 100
            const pct = (m.cost30d / totalCost) * 100
            const totTok = m.inputTok + m.outputTok
            const tm = TIER_META[m.tier]
            return (
              <div key={m.id}
                className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_100px] gap-3 px-5 py-4 hover:bg-[var(--bg-hover)] transition-colors items-center">

                {/* Model name */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background:`${m.color}20` }}>
                    <span className="text-[10px] font-bold" style={{ color: m.color }}>
                      {m.provider === 'Anthropic' ? 'An' : m.provider === 'OpenAI' ? 'OA' : 'Go'}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-[var(--fg)] truncate">{m.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={cn('text-[9.5px] font-semibold px-1.5 py-0.5 rounded-md', tm.bg, tm.color)}>{tm.label}</span>
                      <span className="text-[10px] text-[var(--fg-tertiary)]">{m.avgLatencyMs}ms</span>
                    </div>
                  </div>
                </div>

                {/* Cost */}
                <div>
                  <p className="text-[13px] font-bold text-[var(--fg)] tabular-nums">${m.cost30d.toFixed(2)}</p>
                  <div className={cn('flex items-center gap-0.5 text-[10px] font-semibold mt-0.5',
                    costDelta>0?'text-[var(--red)]':'text-teal')}>
                    {costDelta>0?<ArrowUpRight size={10}/>:<ArrowDownRight size={10}/>}
                    {Math.abs(costDelta).toFixed(1)}%
                  </div>
                </div>

                {/* Tokens */}
                <div>
                  <p className="text-[13px] font-semibold text-[var(--fg)] tabular-nums">{totTok.toFixed(1)}M</p>
                  <p className="text-[10px] text-[var(--fg-tertiary)] mt-0.5">
                    {m.inputTok.toFixed(1)}M in · {m.outputTok.toFixed(1)}M out
                  </p>
                </div>

                {/* Calls */}
                <div>
                  <p className="text-[13px] font-semibold text-[var(--fg)] tabular-nums">{m.calls30d.toLocaleString()}</p>
                  <div className={cn('flex items-center gap-0.5 text-[10px] font-semibold mt-0.5',
                    callDelta>0?'text-[var(--red)]':'text-teal')}>
                    {callDelta>0?<ArrowUpRight size={10}/>:<ArrowDownRight size={10}/>}
                    {Math.abs(callDelta).toFixed(1)}%
                  </div>
                </div>

                {/* $/M tokens */}
                <div>
                  <p className="text-[13px] font-semibold text-[var(--fg)] tabular-nums">${m.costPer1M.toFixed(2)}</p>
                  <EffBadge costPer1M={m.costPer1M} />
                </div>

                {/* % of spend */}
                <div>
                  <p className="text-[13px] font-semibold text-[var(--fg)] tabular-nums">{pct.toFixed(1)}%</p>
                  <div className="h-1 bg-[var(--bg-secondary)] rounded-full overflow-hidden mt-1.5 w-[60px]">
                    <div className="h-full rounded-full" style={{ width:`${pct}%`, background: m.color }} />
                  </div>
                </div>

                {/* Trend line (prev → curr, real data) */}
                <div className="flex items-center">
                  <TrendLine prev={m.costPrev} curr={m.cost30d} color={m.color} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Efficiency insight ── */}
      <div className="bg-[var(--blue-bg)] border border-[var(--blue)]/20 rounded-2xl p-5">
        <p className="text-[13px] font-bold text-[var(--blue)] mb-3">Cost optimisation opportunities</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { title:'Switch Opus → Sonnet for batch tasks', saving:'~$140/mo', desc:'claude-opus-4-8 handles tasks that claude-sonnet-4-6 can do at 5× lower cost.' },
            { title:'Replace GPT-4o with Haiku for classification', saving:'~$68/mo', desc:'Simple intent classification does not need frontier capability. Haiku is 6× cheaper per call.' },
            { title:'GPT-4o-mini for high-volume routing', saving:'~$28/mo', desc:'ChatBot Pro routes 48K calls/month. At $0.30/M, gpt-4o-mini saves vs gpt-4o for routing.' },
          ].map(o => (
            <div key={o.title} className="p-3.5 bg-white/40 dark:bg-black/10 rounded-xl space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-semibold text-[var(--fg)]">{o.title}</p>
                <span className="text-[11px] font-bold text-teal flex-shrink-0 ml-2">{o.saving}</span>
              </div>
              <p className="text-[11px] text-[var(--fg-secondary)] leading-relaxed">{o.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
