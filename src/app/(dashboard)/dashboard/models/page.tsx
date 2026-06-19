'use client'
import { useState, useMemo } from 'react'
import {
  Search, ChevronDown, ChevronUp, Zap, Eye,
  BarChart3, Check, Calculator, X,
  TrendingDown, Star, AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ══════════════════════════════════════════════════════════════
   TYPES
══════════════════════════════════════════════════════════════ */
type Provider = 'anthropic' | 'openai' | 'google'
type Tier     = 'ultra' | 'balanced' | 'fast'
type ModelStatus = 'ga' | 'beta' | 'new' | 'deprecated'

interface Model {
  id: string; name: string; displayName: string; provider: Provider
  tier: Tier; status: ModelStatus
  contextK: number            // context window in K tokens
  inputPer1M: number          // $ per 1M input tokens
  outputPer1M: number         // $ per 1M output tokens
  features: string[]          // multimodal, function-calling, streaming, etc.
  tokensUsed30d: number; costUsed30d: number
  recommended?: boolean; notes?: string
}

/* ══════════════════════════════════════════════════════════════
   MODEL REGISTRY
══════════════════════════════════════════════════════════════ */
const MODELS: Model[] = [
  // ── Anthropic ──
  { id: 'claude-opus-4-8',       name: 'claude-opus-4-8',       displayName: 'Claude Opus 4',    provider: 'anthropic', tier: 'ultra',    status: 'ga',   contextK: 200,  inputPer1M: 15.00, outputPer1M: 75.00, features: ['Multimodal','Function calling','Extended thinking','Streaming'], tokensUsed30d: 22_400_000, costUsed30d: 480.00, recommended: false },
  { id: 'claude-sonnet-4-6',     name: 'claude-sonnet-4-6',     displayName: 'Claude Sonnet 4',  provider: 'anthropic', tier: 'balanced', status: 'new',  contextK: 200,  inputPer1M: 3.00,  outputPer1M: 15.00, features: ['Multimodal','Function calling','Extended thinking','Streaming'], tokensUsed30d: 64_000_000, costUsed30d: 312.00, recommended: true,  notes: 'Best cost-performance ratio' },
  { id: 'claude-haiku-4-5',      name: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4', provider: 'anthropic', tier: 'fast',     status: 'ga',   contextK: 200,  inputPer1M: 0.25,  outputPer1M: 1.25, features: ['Multimodal','Function calling','Streaming'], tokensUsed30d: 38_000_000, costUsed30d: 24.80 },
  // ── OpenAI ──
  { id: 'gpt-4o',                name: 'gpt-4o',                displayName: 'GPT-4o',           provider: 'openai',    tier: 'balanced', status: 'ga',   contextK: 128,  inputPer1M: 2.50,  outputPer1M: 10.00, features: ['Multimodal','Function calling','Streaming','JSON mode'], tokensUsed30d: 18_200_000, costUsed30d: 85.40 },
  { id: 'gpt-4o-mini',           name: 'gpt-4o-mini',           displayName: 'GPT-4o mini',      provider: 'openai',    tier: 'fast',     status: 'ga',   contextK: 128,  inputPer1M: 0.15,  outputPer1M: 0.60, features: ['Multimodal','Function calling','Streaming','JSON mode'], tokensUsed30d: 9_800_000, costUsed30d: 2.90 },
  { id: 'o3',                    name: 'o3',                    displayName: 'o3',                provider: 'openai',    tier: 'ultra',    status: 'ga',   contextK: 200,  inputPer1M: 10.00, outputPer1M: 40.00, features: ['Extended reasoning','Function calling','Streaming'], tokensUsed30d: 4_200_000, costUsed30d: 108.00 },
  { id: 'o4-mini',               name: 'o4-mini',               displayName: 'o4-mini',           provider: 'openai',    tier: 'balanced', status: 'new',  contextK: 200,  inputPer1M: 1.10,  outputPer1M: 4.40, features: ['Extended reasoning','Function calling','Streaming'], tokensUsed30d: 6_400_000, costUsed30d: 17.80, recommended: false },
  // ── Google ──
  { id: 'gemini-2.5-pro',        name: 'gemini-2.5-pro',        displayName: 'Gemini 2.5 Pro',   provider: 'google',    tier: 'ultra',    status: 'ga',   contextK: 1000, inputPer1M: 1.25,  outputPer1M: 5.00, features: ['Multimodal','Function calling','Long context','Streaming'], tokensUsed30d: 12_000_000, costUsed30d: 30.40, notes: '1M token context window' },
  { id: 'gemini-2.5-flash',      name: 'gemini-2.5-flash',      displayName: 'Gemini 2.5 Flash', provider: 'google',    tier: 'fast',     status: 'new',  contextK: 1000, inputPer1M: 0.075, outputPer1M: 0.30, features: ['Multimodal','Function calling','Long context','Streaming'], tokensUsed30d: 8_600_000, costUsed30d: 1.80 },
  { id: 'gemini-2.0-flash',      name: 'gemini-2.0-flash',      displayName: 'Gemini 2.0 Flash', provider: 'google',    tier: 'fast',     status: 'ga',   contextK: 1000, inputPer1M: 0.10,  outputPer1M: 0.40, features: ['Multimodal','Function calling','Long context'], tokensUsed30d: 3_200_000, costUsed30d: 0.80 },
]

/* ══════════════════════════════════════════════════════════════
   META / HELPERS
══════════════════════════════════════════════════════════════ */
const PROVIDER_META: Record<Provider, { label: string; color: string; bg: string; border: string; dot: string }> = {
  anthropic: { label: 'Anthropic', color: 'text-[#D97757]', bg: 'bg-[#FDF0EE]',   border: 'border-[#D97757]/25', dot: '#D97757' },
  openai:    { label: 'OpenAI',    color: 'text-[#10A37F]', bg: 'bg-[#E6F7F3]',   border: 'border-[#10A37F]/25', dot: '#10A37F' },
  google:    { label: 'Google',    color: 'text-[#4285F4]', bg: 'bg-[#EBF2FE]',   border: 'border-[#4285F4]/25', dot: '#4285F4' },
}

const TIER_META: Record<Tier, { label: string; icon: React.ElementType; bg: string; text: string }> = {
  ultra:    { label: 'Ultra',    icon: Zap,       bg: 'bg-[var(--red-bg)]',   text: 'text-[var(--red)]'    },
  balanced: { label: 'Balanced', icon: BarChart3,  bg: 'bg-[var(--blue-bg)]',  text: 'text-[var(--blue)]'   },
  fast:     { label: 'Fast',     icon: TrendingDown, bg: 'bg-[var(--green-bg)]', text: 'text-[var(--green)]' },
}

const STATUS_META: Record<ModelStatus, { label: string; cls: string }> = {
  ga:         { label: 'GA',         cls: 'bg-[var(--green-bg)] text-[var(--green)]'        },
  beta:       { label: 'Beta',       cls: 'bg-[var(--blue-bg)] text-[var(--blue)]'           },
  new:        { label: 'New',        cls: 'bg-coral/10 text-coral border border-coral/25'    },
  deprecated: { label: 'Deprecated', cls: 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]' },
}

function fmtCtx(k: number) {
  return k >= 1000 ? `${k/1000}M` : `${k}K`
}

function fmtPrice(p: number) {
  return p < 1 ? `$${p.toFixed(p < 0.1 ? 3 : 2)}` : `$${p.toFixed(2)}`
}

function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n/1_000).toFixed(0)}K`
  return `${n}`
}

const TOTAL_COST = MODELS.reduce((s, m) => s + m.costUsed30d, 0)
const TOTAL_TOKENS = MODELS.reduce((s, m) => s + m.tokensUsed30d, 0)

/* ══════════════════════════════════════════════════════════════
   PROVIDER LOGO (SVG inline, no img tag)
══════════════════════════════════════════════════════════════ */
function ProviderBadge({ provider, size = 'md' }: { provider: Provider; size?: 'sm' | 'md' }) {
  const m   = PROVIDER_META[provider]
  const dim = size === 'sm' ? 28 : 36
  const f   = size === 'sm' ? 11 : 13
  const initials = { anthropic: 'A', openai: 'O', google: 'G' }

  return (
    <div
      className={cn('rounded-xl flex items-center justify-center flex-shrink-0 border font-bold', m.bg, m.border)}
      style={{ width: dim, height: dim, fontSize: f, color: m.dot }}
    >
      {initials[provider]}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   COST CALCULATOR
══════════════════════════════════════════════════════════════ */
function CostCalculator({ models, onClose }: { models: Model[]; onClose: () => void }) {
  const [inputTokens,  setInputTokens]  = useState(100_000)
  const [outputTokens, setOutputTokens] = useState(20_000)
  const [selected,     setSelected]     = useState<Set<string>>(new Set(models.slice(0,4).map(m => m.id)))

  const shownModels = models.filter(m => selected.has(m.id))
  const results = shownModels.map(m => ({
    m,
    cost: (m.inputPer1M * inputTokens / 1_000_000) + (m.outputPer1M * outputTokens / 1_000_000),
  })).sort((a,b) => a.cost - b.cost)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose}/>
      <div className="relative bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-[580px] max-h-[85vh] overflow-hidden flex flex-col">

        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-coral/10 flex items-center justify-center">
              <Calculator size={15} className="text-coral"/>
            </div>
            <div>
              <h3 className="text-[14px] font-bold text-[var(--fg)]">Cost calculator</h3>
              <p className="text-[11.5px] text-[var(--fg-secondary)]">Estimate cost per request across models</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors">
            <X size={15}/>
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1">
          {/* Token inputs */}
          <div className="grid grid-cols-2 gap-4 mb-5">
            {[
              { label: 'Input tokens',  value: inputTokens,  onChange: setInputTokens  },
              { label: 'Output tokens', value: outputTokens, onChange: setOutputTokens },
            ].map(f => (
              <div key={f.label}>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">{f.label}</label>
                <input
                  type="number"
                  value={f.value}
                  onChange={e => f.onChange(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full px-3 py-2 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:border-coral focus:ring-2 focus:ring-coral/20 transition-all"
                />
                <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-1">≈ {fmtTokens(f.value)} tokens</p>
              </div>
            ))}
          </div>

          {/* Quick presets */}
          <div className="flex flex-wrap gap-1.5 mb-5">
            <p className="text-[10.5px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider self-center mr-1">Presets:</p>
            {[
              { label: 'Short query',   i: 500,    o: 200    },
              { label: 'Chat message',  i: 2_000,  o: 500    },
              { label: 'Code review',   i: 8_000,  o: 2_000  },
              { label: 'Long doc',      i: 50_000, o: 5_000  },
            ].map(p => (
              <button
                key={p.label}
                onClick={() => { setInputTokens(p.i); setOutputTokens(p.o) }}
                className="px-2.5 py-1 rounded-lg border border-[var(--border)] text-[11.5px] text-[var(--fg-secondary)] hover:border-coral hover:text-coral transition-all"
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Results */}
          <div className="space-y-2">
            {results.map((r, i) => {
              const pm = PROVIDER_META[r.m.provider]
              const pct = results.length > 1 ? (r.cost / results[results.length-1].cost) * 100 : 100
              return (
                <div key={r.m.id} className={cn('flex items-center gap-3 p-3 rounded-xl border transition-all', i === 0 ? 'border-teal/30 bg-[var(--green-bg)]/50' : 'border-[var(--border)]')}>
                  <div className="text-[11px] font-bold text-[var(--fg-tertiary)] w-4 text-center">{i+1}</div>
                  <ProviderBadge provider={r.m.provider} size="sm"/>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[12.5px] font-semibold text-[var(--fg)] truncate">{r.m.displayName}</p>
                      {i === 0 && <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--green-bg)] text-[var(--green)]">Cheapest</span>}
                    </div>
                    <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full mt-1.5 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: pm.dot }}/>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[14px] font-bold text-[var(--fg)] tabular-nums">${r.cost.toFixed(r.cost < 0.001 ? 5 : r.cost < 0.01 ? 4 : 3)}</p>
                    <p className="text-[10px] text-[var(--fg-tertiary)]">per call</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   MODEL ROW
══════════════════════════════════════════════════════════════ */
function ModelRow({ model, usagePct, expanded, onToggle }: {
  model: Model; usagePct: number; expanded: boolean; onToggle: () => void
}) {
  const pm = PROVIDER_META[model.provider]
  const tm = TIER_META[model.tier]
  const sm = STATUS_META[model.status]
  const TierIcon = tm.icon

  return (
    <div className={cn('border-b border-[var(--border)] last:border-0 transition-colors', expanded ? 'bg-[var(--bg-secondary)]/40' : 'hover:bg-[var(--bg-hover)]')}>
      {/* Main row */}
      <div className="grid grid-cols-[2.5fr_1fr_1.4fr_1.4fr_1.6fr_120px] gap-3 items-center px-5 py-4 cursor-pointer" onClick={onToggle}>

        {/* Model name */}
        <div className="flex items-center gap-3 min-w-0">
          <ProviderBadge provider={model.provider}/>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[13.5px] font-bold text-[var(--fg)]">{model.displayName}</p>
              <span className={cn('px-1.5 py-0.5 rounded-full text-[9.5px] font-bold', sm.cls)}>{sm.label}</span>
              {model.recommended && (
                <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-coral/10 text-coral text-[9.5px] font-bold">
                  <Star size={8}/> Recommended
                </span>
              )}
            </div>
            <p className="text-[10.5px] font-mono text-[var(--fg-tertiary)] mt-0.5 truncate">{model.name}</p>
            {model.notes && (
              <p className="text-[10.5px] text-teal mt-0.5">{model.notes}</p>
            )}
          </div>
        </div>

        {/* Tier */}
        <div>
          <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold', tm.bg, tm.text)}>
            <TierIcon size={10}/> {tm.label}
          </span>
        </div>

        {/* Context */}
        <div>
          <span className="text-[12.5px] font-semibold text-[var(--fg)] tabular-nums">{fmtCtx(model.contextK)}</span>
          <span className="text-[10.5px] text-[var(--fg-tertiary)] ml-1">tokens</span>
        </div>

        {/* Pricing */}
        <div>
          <div className="flex items-baseline gap-1">
            <span className="text-[12px] font-semibold text-[var(--fg)] tabular-nums">{fmtPrice(model.inputPer1M)}</span>
            <span className="text-[10px] text-[var(--fg-tertiary)]">in</span>
          </div>
          <div className="flex items-baseline gap-1 mt-0.5">
            <span className="text-[12px] font-semibold text-[var(--fg-secondary)] tabular-nums">{fmtPrice(model.outputPer1M)}</span>
            <span className="text-[10px] text-[var(--fg-tertiary)]">out /1M</span>
          </div>
        </div>

        {/* Your usage */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[12.5px] font-bold text-[var(--fg)] tabular-nums">${model.costUsed30d.toFixed(2)}</span>
            <span className="text-[10.5px] text-[var(--fg-tertiary)]">{usagePct.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${usagePct}%`, backgroundColor: pm.dot }}/>
          </div>
          <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-0.5">{fmtTokens(model.tokensUsed30d)} tokens</p>
        </div>

        {/* Expand */}
        <div className="flex justify-end">
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-semibold text-[var(--fg-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--fg)] transition-all">
            {expanded ? <><ChevronUp size={12}/> Less</> : <><Eye size={12}/> Details</>}
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-5 pb-5 grid grid-cols-2 gap-4">
          {/* Features */}
          <div className="bg-white dark:bg-[#141428] rounded-xl border border-[var(--border)] p-4">
            <p className="text-[11px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider mb-2.5">Capabilities</p>
            <div className="flex flex-wrap gap-1.5">
              {model.features.map(f => (
                <span key={f} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--bg-secondary)] text-[11px] text-[var(--fg-secondary)] border border-[var(--border)]">
                  <Check size={9} className="text-teal flex-shrink-0"/>{f}
                </span>
              ))}
            </div>
          </div>

          {/* Quick cost breakdown */}
          <div className="bg-white dark:bg-[#141428] rounded-xl border border-[var(--border)] p-4">
            <p className="text-[11px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider mb-2.5">Pricing detail</p>
            <div className="space-y-2">
              {[
                { label: 'Input tokens',   price: model.inputPer1M,  per: '/1M' },
                { label: 'Output tokens',  price: model.outputPer1M, per: '/1M' },
                { label: '1K input',       price: model.inputPer1M / 1000,  per: '' },
                { label: '1K output',      price: model.outputPer1M / 1000, per: '' },
              ].map(r => (
                <div key={r.label} className="flex items-center justify-between">
                  <span className="text-[12px] text-[var(--fg-secondary)]">{r.label}</span>
                  <span className="text-[12px] font-semibold text-[var(--fg)] tabular-nums">
                    {r.price < 0.000001 ? '< $0.000001' : `$${r.price.toFixed(r.price < 0.001 ? 6 : r.price < 0.01 ? 4 : 2)}`}{r.per}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Provider note */}
          <div className="col-span-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: pm.dot }}/>
            <p className="text-[11.5px] text-[var(--fg-secondary)]">
              <span className="font-semibold" style={{ color: pm.dot }}>{pm.label}</span>
              {' · '}Model ID: <code className="font-mono text-[var(--fg)]">{model.name}</code>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════ */
type SortKey = 'name' | 'input_price' | 'output_price' | 'context' | 'usage'

export default function ModelsPage() {
  const [provFilter, setProvFilter] = useState<Provider | 'all'>('all')
  const [tierFilter, setTierFilter] = useState<Tier | 'all'>('all')
  const [search,     setSearch]     = useState('')
  const [sortBy,     setSortBy]     = useState<SortKey>('usage')
  const [sortDir,    setSortDir]    = useState<'asc'|'desc'>('desc')
  const [expandedId, setExpandedId] = useState<string|null>(null)
  const [showCalc,   setShowCalc]   = useState(false)

  function handleSort(key: SortKey) {
    if (sortBy === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(key); setSortDir('desc') }
  }

  const filtered = useMemo(() => {
    let ms = MODELS
    if (provFilter !== 'all') ms = ms.filter(m => m.provider === provFilter)
    if (tierFilter !== 'all') ms = ms.filter(m => m.tier === tierFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      ms = ms.filter(m => m.displayName.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
    }
    return [...ms].sort((a, b) => {
      let diff = 0
      if (sortBy === 'name')         diff = a.displayName.localeCompare(b.displayName)
      if (sortBy === 'input_price')  diff = a.inputPer1M  - b.inputPer1M
      if (sortBy === 'output_price') diff = a.outputPer1M - b.outputPer1M
      if (sortBy === 'context')      diff = a.contextK    - b.contextK
      if (sortBy === 'usage')        diff = a.costUsed30d - b.costUsed30d
      return sortDir === 'asc' ? diff : -diff
    })
  }, [provFilter, tierFilter, search, sortBy, sortDir])

  function SortBtn({ k, label }: { k: SortKey; label: string }) {
    const active = sortBy === k
    return (
      <button
        onClick={() => handleSort(k)}
        className={cn(
          'flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider transition-colors',
          active ? 'text-coral' : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
        )}
      >
        {label}
        {active
          ? sortDir === 'desc' ? <ChevronDown size={10}/> : <ChevronUp size={10}/>
          : <ChevronDown size={10} className="opacity-30"/>
        }
      </button>
    )
  }

  return (
    <div className="space-y-5 max-w-[1100px]">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Models</h1>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">LLM registry · pricing · your 30-day usage</p>
        </div>
        <button onClick={() => setShowCalc(true)} className="btn-secondary">
          <Calculator size={14}/> Cost calculator
        </button>
      </div>

      {/* ── Summary strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Models tracked', value: `${MODELS.length}`,                      color: 'text-coral'             },
          { label: 'Providers',      value: '3',                                      color: 'text-[var(--blue)]'     },
          { label: 'Total cost 30d', value: `$${TOTAL_COST.toFixed(2)}`,             color: 'text-[var(--amber)]'    },
          { label: 'Total tokens',   value: fmtTokens(TOTAL_TOKENS),                 color: 'text-teal'              },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl px-4 py-3">
            <p className={cn('text-[17px] font-bold tabular-nums', s.color)}>{s.value}</p>
            <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="flex items-center gap-3 flex-wrap">

        {/* Provider tabs */}
        <div className="flex items-center gap-1 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl p-1">
          <button
            onClick={() => setProvFilter('all')}
            className={cn('px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all', provFilter === 'all' ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}
          >
            All <span className="ml-1 text-[10px] opacity-60">{MODELS.length}</span>
          </button>
          {(['anthropic','openai','google'] as Provider[]).map(p => {
            const pm = PROVIDER_META[p]
            const cnt = MODELS.filter(m => m.provider === p).length
            return (
              <button
                key={p}
                onClick={() => setProvFilter(p)}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all', provFilter === p ? `${pm.bg} ${pm.color}` : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: pm.dot }}/>
                {pm.label}
                <span className="text-[10px] opacity-60">{cnt}</span>
              </button>
            )
          })}
        </div>

        {/* Tier filter */}
        <div className="flex items-center gap-1 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl p-1">
          <button
            onClick={() => setTierFilter('all')}
            className={cn('px-2.5 py-1.5 rounded-lg text-[11.5px] font-semibold transition-all', tierFilter === 'all' ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}
          >All</button>
          {(['ultra','balanced','fast'] as Tier[]).map(t => {
            const tm = TIER_META[t]
            const Icon = tm.icon
            return (
              <button
                key={t}
                onClick={() => setTierFilter(t)}
                className={cn('flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11.5px] font-semibold transition-all', tierFilter === t ? `${tm.bg} ${tm.text}` : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}
              >
                <Icon size={10}/> {tm.label}
              </button>
            )
          })}
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-[260px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]"/>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search models…"
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-[var(--border)] text-[12.5px] bg-[var(--bg)] text-[var(--fg)] focus:outline-none focus:border-coral focus:ring-2 focus:ring-coral/20 transition-all"
          />
        </div>
      </div>

      {/* ── Models table ── */}
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">

        {/* Header */}
        <div className="grid grid-cols-[2.5fr_1fr_1.4fr_1.4fr_1.6fr_120px] gap-3 px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]/50">
          <SortBtn k="name"         label="Model"        />
          <div className="text-[10px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider">Tier</div>
          <SortBtn k="context"      label="Context"      />
          <SortBtn k="input_price"  label="Price"        />
          <SortBtn k="usage"        label="Your usage 30d"/>
          <div/>
        </div>

        {/* Rows */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <AlertTriangle size={22} className="text-[var(--fg-tertiary)]"/>
            <p className="text-[13px] text-[var(--fg-secondary)]">No models match your filters</p>
            <button onClick={() => { setProvFilter('all'); setTierFilter('all'); setSearch('') }} className="text-[12.5px] text-coral hover:underline">Clear filters</button>
          </div>
        ) : (
          filtered.map(model => (
            <ModelRow
              key={model.id}
              model={model}
              usagePct={TOTAL_COST > 0 ? (model.costUsed30d / TOTAL_COST) * 100 : 0}
              expanded={expandedId === model.id}
              onToggle={() => setExpandedId(expandedId === model.id ? null : model.id)}
            />
          ))
        )}
      </div>

      {/* ── Footnote ── */}
      <div className="flex items-start gap-2 px-4 py-3 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)]">
        <AlertTriangle size={12} className="text-[var(--amber)] flex-shrink-0 mt-0.5"/>
        <p className="text-[11.5px] text-[var(--fg-tertiary)]">
          Prices are updated periodically from provider APIs. Actual costs may differ based on cache hits, batch discounts, or special pricing agreements.
          <button className="text-coral hover:underline ml-1">View price history →</button>
        </p>
      </div>

      {showCalc && <CostCalculator models={MODELS} onClose={() => setShowCalc(false)}/>}
    </div>
  )
}
