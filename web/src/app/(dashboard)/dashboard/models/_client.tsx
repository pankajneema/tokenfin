'use client'
import { useState, useMemo } from 'react'
import {
  Search, ChevronDown, ChevronUp, Eye,
  Check, Calculator, X,
  AlertTriangle, Plus, Trash2,
  Cpu, Pencil, Tag,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { priceFor } from '@/lib/mcp/pricing'
import { matchOverride } from '@/lib/pricing-overrides'
import type { EnabledModel, CustomPrice } from './page'

/* ── Types ── */
type Provider    = 'anthropic' | 'openai' | 'google'
type ModelStatus = 'ga' | 'beta' | 'new' | 'deprecated'
type SortKey     = 'name' | 'input_price' | 'output_price' | 'context' | 'usage'

/** Identity + capability metadata only — prices come from lib/mcp/pricing.ts. */
interface CatalogMeta {
  id: string; name: string; displayName: string; provider: Provider
  status: ModelStatus
  contextK: number
  features: string[]
  notes?: string
}

type PriceSource = 'list' | 'override' | 'unknown'
interface CatalogModel extends CatalogMeta {
  inputPer1M: number; outputPer1M: number
  priceSource: PriceSource
}

interface Model extends CatalogModel {
  addedAt:       string
  tokensUsed30d: number
  costUsed30d:   number
  avgLatencyMs?: number | null
}

/* ── Model catalog (no prices here: one price source, see priced()) ── */
const META: CatalogMeta[] = [
  { id: 'claude-opus-4-8',     name: 'claude-opus-4-8',         displayName: 'Claude Opus 4',      provider: 'anthropic', status: 'ga',   contextK: 200,  features: ['Multimodal','Function calling','Extended thinking','Streaming'] },
  { id: 'claude-sonnet-4-6',   name: 'claude-sonnet-4-6',       displayName: 'Claude Sonnet 4',    provider: 'anthropic', status: 'new',  contextK: 200,  features: ['Multimodal','Function calling','Extended thinking','Streaming'] },
  { id: 'claude-haiku-4-5',    name: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4',   provider: 'anthropic', status: 'ga',   contextK: 200,  features: ['Multimodal','Function calling','Streaming'] },
  { id: 'gpt-4o',              name: 'gpt-4o',                  displayName: 'GPT-4o',             provider: 'openai',    status: 'ga',   contextK: 128,  features: ['Multimodal','Function calling','Streaming','JSON mode'] },
  { id: 'gpt-4o-mini',         name: 'gpt-4o-mini',             displayName: 'GPT-4o mini',        provider: 'openai',    status: 'ga',   contextK: 128,  features: ['Multimodal','Function calling','Streaming','JSON mode'] },
  { id: 'o3',                  name: 'o3',                      displayName: 'o3',                 provider: 'openai',    status: 'ga',   contextK: 200,  features: ['Extended reasoning','Function calling','Streaming'] },
  { id: 'o4-mini',             name: 'o4-mini',                 displayName: 'o4-mini',            provider: 'openai',    status: 'new',  contextK: 200,  features: ['Extended reasoning','Function calling','Streaming'] },
  { id: 'gemini-2.5-pro',      name: 'gemini-2.5-pro',          displayName: 'Gemini 2.5 Pro',     provider: 'google',    status: 'ga',   contextK: 1000, features: ['Multimodal','Function calling','Long context','Streaming'], notes: '1M token context window' },
  { id: 'gemini-2.5-flash',    name: 'gemini-2.5-flash',        displayName: 'Gemini 2.5 Flash',   provider: 'google',    status: 'new',  contextK: 1000, features: ['Multimodal','Function calling','Long context','Streaming'] },
  { id: 'gemini-2.0-flash',    name: 'gemini-2.0-flash',        displayName: 'Gemini 2.0 Flash',   provider: 'google',    status: 'ga',   contextK: 1000, features: ['Multimodal','Function calling','Long context'] },
]

/**
 * Price a catalog model: the org's custom price (longest prefix) else the list
 * price from lib/mcp/pricing.ts — the same rates ingest uses to cost events.
 */
function priced(m: CatalogMeta, overrides: CustomPrice[]): CatalogModel {
  const o = matchOverride(overrides, m.name)
  const l = priceFor(m.name)
  return {
    ...m,
    inputPer1M:  o ? o.input_per_m  : l.in,
    outputPer1M: o ? o.output_per_m : l.out,
    priceSource: o ? 'override' : l.known ? 'list' : 'unknown',
  }
}

const PRICE_SOURCE_META: Record<PriceSource, { label: string; cls: string }> = {
  list:     { label: 'List price',   cls: 'bg-[var(--bg-secondary)] text-[var(--fg-secondary)]' },
  override: { label: 'Custom price', cls: 'bg-[var(--blue-bg)] text-[var(--blue)]' },
  unknown:  { label: 'Fallback',     cls: 'bg-[var(--amber-bg)] text-[var(--amber)]' },
}

/* ── Meta ── */
const PROVIDER_META: Record<Provider, { label: string; color: string; bg: string; border: string; dot: string }> = {
  anthropic: { label: 'Anthropic', color: 'text-[#D97757]', bg: 'bg-[#FDF0EE]', border: 'border-[#D97757]/25', dot: '#D97757' },
  openai:    { label: 'OpenAI',    color: 'text-[#10A37F]', bg: 'bg-[#E6F7F3]', border: 'border-[#10A37F]/25', dot: '#10A37F' },
  google:    { label: 'Google',    color: 'text-[#4285F4]', bg: 'bg-[#EBF2FE]', border: 'border-[#4285F4]/25', dot: '#4285F4' },
}

const STATUS_META: Record<ModelStatus, { label: string; cls: string }> = {
  ga:         { label: 'GA',         cls: 'bg-[var(--green-bg)] text-[var(--green)]'          },
  beta:       { label: 'Beta',       cls: 'bg-[var(--blue-bg)] text-[var(--blue)]'             },
  new:        { label: 'New',        cls: 'bg-coral/10 text-coral border border-coral/25'      },
  deprecated: { label: 'Deprecated', cls: 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]' },
}

function fmtCtx(k: number)    { return k >= 1000 ? `${k/1000}M` : `${k}K` }
function fmtPrice(p: number)  { return p < 1 ? `$${p.toFixed(p < 0.1 ? 3 : 2)}` : `$${p.toFixed(2)}` }
function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n/1_000).toFixed(0)}K`
  return `${n}`
}

/* ── Provider badge ── */
function ProviderBadge({ provider, size = 'md' }: { provider: Provider; size?: 'sm' | 'md' }) {
  const m        = PROVIDER_META[provider]
  const dim      = size === 'sm' ? 28 : 36
  const f        = size === 'sm' ? 11 : 13
  const initials: Record<Provider, string> = { anthropic: 'A', openai: 'O', google: 'G' }
  return (
    <div className={cn('rounded-xl flex items-center justify-center flex-shrink-0 border font-bold', m.bg, m.border)}
      style={{ width: dim, height: dim, fontSize: f, color: m.dot }}>
      {initials[provider]}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   ADD MODEL MODAL
══════════════════════════════════════════════════════════════ */
function AddModelModal({
  orgId,
  catalog,
  alreadyAdded,
  onClose,
  onAdded,
}: {
  orgId:        string
  catalog:      CatalogModel[]
  alreadyAdded: Set<string>
  onClose:      () => void
  onAdded:      (model: CatalogModel) => void
}) {
  const [search,  setSearch]  = useState('')
  const [adding,  setAdding]  = useState<string | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [provFil, setProvFil] = useState<Provider | 'all'>('all')

  const available = catalog.filter(m => {
    if (alreadyAdded.has(m.name)) return false
    if (provFil !== 'all' && m.provider !== provFil) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      return m.displayName.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    }
    return true
  })

  async function handleAdd(m: CatalogModel) {
    setAdding(m.name); setError(null)
    try {
      const res = await fetch('/api/v1/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, model: m.name }),
      })
      if (!res.ok) throw new Error(await res.text())
      onAdded(m)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add model')
    } finally {
      setAdding(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-[560px] max-h-[85vh] overflow-hidden flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-coral/10 flex items-center justify-center">
              <Plus size={16} className="text-coral" />
            </div>
            <div>
              <h2 className="text-[14.5px] font-bold text-[var(--fg)]">Add model</h2>
              <p className="text-[11.5px] text-[var(--fg-secondary)]">Select models your team uses to start tracking cost</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Filters */}
        <div className="px-5 pt-4 pb-3 border-b border-[var(--border)] space-y-3">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search models…" autoFocus
              className="w-full pl-8 pr-3 py-2 rounded-xl border border-[var(--border)] text-[12.5px] bg-[var(--bg)] text-[var(--fg)] focus:outline-none focus:border-coral focus:ring-2 focus:ring-coral/20 transition-all" />
          </div>
          <div className="flex gap-1">
            {(['all', 'anthropic', 'openai', 'google'] as const).map(p => {
              const pm = p !== 'all' ? PROVIDER_META[p as Provider] : null
              return (
                <button key={p} onClick={() => setProvFil(p as Provider | 'all')}
                  className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-semibold border transition-all',
                    provFil === p
                      ? p === 'all' ? 'bg-[var(--fg)] text-[var(--bg)] border-[var(--fg)]' : `${pm?.bg} ${pm?.color} border-current/30`
                      : 'border-[var(--border)] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]')}>
                  {pm && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: pm.dot }} />}
                  {p === 'all' ? 'All' : PROVIDER_META[p as Provider].label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Model list */}
        <div className="overflow-y-auto flex-1 divide-y divide-[var(--border)]">
          {available.length === 0 ? (
            <div className="py-12 text-center">
              <Cpu size={28} className="text-[var(--fg-tertiary)] mx-auto mb-3" />
              <p className="text-[13px] text-[var(--fg-secondary)]">
                {alreadyAdded.size === catalog.length ? 'All models added' : 'No models match your search'}
              </p>
            </div>
          ) : available.map(m => {
            const pm      = PROVIDER_META[m.provider]
            const sm      = STATUS_META[m.status]
            const isAdding = adding === m.name

            return (
              <div key={m.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-[var(--bg-hover)] transition-colors">
                <ProviderBadge provider={m.provider} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[13px] font-semibold text-[var(--fg)]">{m.displayName}</p>
                    <span className={cn('px-1.5 py-0.5 rounded-full text-[9px] font-bold', sm.cls)}>{sm.label}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-[var(--fg-tertiary)]">{fmtCtx(m.contextK)} ctx</span>
                    <span className="text-[10px] text-[var(--fg-tertiary)]">·</span>
                    <span className="text-[10px] text-[var(--fg-tertiary)]">{fmtPrice(m.inputPer1M)} / {fmtPrice(m.outputPer1M)} per 1M{m.priceSource === 'override' ? ' (custom)' : ''}</span>
                  </div>
                </div>
                <button onClick={() => handleAdd(m)} disabled={!!adding}
                  className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[12px] font-semibold transition-all flex-shrink-0',
                    isAdding
                      ? 'border-coral bg-coral/10 text-coral'
                      : 'border-[var(--border)] text-[var(--fg-secondary)] hover:border-coral hover:text-coral hover:bg-coral/5 disabled:opacity-40')}>
                  {isAdding
                    ? <><span className="w-3 h-3 rounded-full border-2 border-coral/30 border-t-coral animate-spin" />Adding…</>
                    : <><Plus size={12} />Add</>}
                </button>
              </div>
            )
          })}
        </div>

        {error && (
          <div className="px-5 py-3 border-t border-[var(--border)] text-[12px] text-[var(--red)] bg-[var(--red-bg)]">{error}</div>
        )}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   COST CALCULATOR
══════════════════════════════════════════════════════════════ */
function CostCalculator({ models, onClose }: { models: Model[]; onClose: () => void }) {
  const [inputTokens,  setInputTokens]  = useState(100_000)
  const [outputTokens, setOutputTokens] = useState(20_000)
  const [selected,     setSelected]     = useState<Set<string>>(new Set(models.slice(0, 4).map(m => m.name)))

  const results = models.filter(m => selected.has(m.name)).map(m => ({
    m, cost: (m.inputPer1M * inputTokens / 1_000_000) + (m.outputPer1M * outputTokens / 1_000_000),
  })).sort((a, b) => a.cost - b.cost)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-[540px] max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-coral/10 flex items-center justify-center">
              <Calculator size={15} className="text-coral" />
            </div>
            <div>
              <h3 className="text-[14px] font-bold text-[var(--fg)]">Cost calculator</h3>
              <p className="text-[11.5px] text-[var(--fg-secondary)]">Estimate cost per call across your models</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors">
            <X size={15} />
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Input tokens',  value: inputTokens,  onChange: setInputTokens  },
              { label: 'Output tokens', value: outputTokens, onChange: setOutputTokens },
            ].map(f => (
              <div key={f.label}>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">{f.label}</label>
                <input type="number" value={f.value} onChange={e => f.onChange(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full px-3 py-2 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:border-coral focus:ring-2 focus:ring-coral/20 transition-all" />
                <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-1">≈ {fmtTokens(f.value)} tokens</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <p className="text-[10.5px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider self-center mr-1">Presets:</p>
            {[
              { label: 'Short query',  i: 500,    o: 200   },
              { label: 'Chat message', i: 2_000,  o: 500   },
              { label: 'Code review',  i: 8_000,  o: 2_000 },
              { label: 'Long doc',     i: 50_000, o: 5_000 },
            ].map(p => (
              <button key={p.label} onClick={() => { setInputTokens(p.i); setOutputTokens(p.o) }}
                className="px-2.5 py-1 rounded-lg border border-[var(--border)] text-[11.5px] text-[var(--fg-secondary)] hover:border-coral hover:text-coral transition-all">
                {p.label}
              </button>
            ))}
          </div>

          {results.length === 0 ? (
            <p className="text-[12px] text-[var(--fg-tertiary)] text-center py-4">Select models below to compare</p>
          ) : (
            <div className="space-y-2">
              {results.map((r, i) => {
                const pm  = PROVIDER_META[r.m.provider]
                const pct = results.length > 1 ? (r.cost / results[results.length - 1].cost) * 100 : 100
                return (
                  <div key={r.m.name} className={cn('flex items-center gap-3 p-3 rounded-xl border transition-all',
                    i === 0 ? 'border-teal/30 bg-[var(--green-bg)]/50' : 'border-[var(--border)]')}>
                    <div className="text-[11px] font-bold text-[var(--fg-tertiary)] w-4 text-center">{i + 1}</div>
                    <ProviderBadge provider={r.m.provider} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[12.5px] font-semibold text-[var(--fg)] truncate">{r.m.displayName}</p>
                        {i === 0 && <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--green-bg)] text-[var(--green)]">Cheapest</span>}
                      </div>
                      <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full mt-1.5 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: pm.dot }} />
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
          )}

          {/* Model selection */}
          <div className="pt-3 border-t border-[var(--border)]">
            <p className="text-[11px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider mb-3">Compare models</p>
            <div className="grid grid-cols-2 gap-1.5">
              {models.map(m => {
                const pm = PROVIDER_META[m.provider]
                const on = selected.has(m.name)
                return (
                  <button key={m.name}
                    onClick={() => setSelected(prev => {
                      const next = new Set(prev)
                      if (on) { if (next.size > 2) next.delete(m.name) } else next.add(m.name)
                      return next
                    })}
                    className={cn('flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11.5px] font-medium transition-all text-left',
                      on ? 'border-current/30 text-[var(--fg)] bg-[var(--bg-secondary)]' : 'border-[var(--border)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)]')}>
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: pm.dot }} />
                    {m.displayName}
                    {on && <Check size={10} className="ml-auto text-teal" />}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   MODEL ROW
══════════════════════════════════════════════════════════════ */
function ModelRow({ model, usagePct, totalCost, expanded, onToggle, onRemove }: {
  model:     Model
  usagePct:  number
  totalCost: number
  expanded:  boolean
  onToggle:  () => void
  onRemove:  (name: string) => void
}) {
  const pm       = PROVIDER_META[model.provider]
  const sm       = STATUS_META[model.status]
  const ps       = PRICE_SOURCE_META[model.priceSource]
  const hasUsage = model.costUsed30d > 0

  return (
    <div className={cn('border-b border-[var(--border)] last:border-0 transition-colors group', expanded ? 'bg-[var(--bg-secondary)]/40' : 'hover:bg-[var(--bg-hover)]')}>
      <div className="grid grid-cols-[2.5fr_1fr_1.4fr_1.4fr_1.6fr_130px] gap-3 items-center px-5 py-4 cursor-pointer" onClick={onToggle}>
        {/* Name */}
        <div className="flex items-center gap-3 min-w-0">
          <ProviderBadge provider={model.provider} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[13.5px] font-bold text-[var(--fg)]">{model.displayName}</p>
              <span className={cn('px-1.5 py-0.5 rounded-full text-[9.5px] font-bold', sm.cls)}>{sm.label}</span>
            </div>
            <p className="text-[10.5px] font-mono text-[var(--fg-tertiary)] mt-0.5 truncate">{model.name}</p>
            {model.notes && <p className="text-[10.5px] text-teal mt-0.5">{model.notes}</p>}
          </div>
        </div>

        {/* Price source */}
        <div>
          <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold', ps.cls)}>
            {ps.label}
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

        {/* Usage */}
        <div>
          {hasUsage ? (
            <>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[12.5px] font-bold text-[var(--fg)] tabular-nums">${model.costUsed30d.toFixed(2)}</span>
                <span className="text-[10.5px] text-[var(--fg-tertiary)]">{usagePct.toFixed(0)}%</span>
              </div>
              <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${usagePct}%`, backgroundColor: pm.dot }} />
              </div>
              <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-0.5">{fmtTokens(model.tokensUsed30d)} tokens · {model.avgLatencyMs != null ? `${Math.round(model.avgLatencyMs).toLocaleString()} ms avg` : 'latency not reported'}</p>
            </>
          ) : (
            <span className="text-[11px] text-[var(--fg-tertiary)]">No usage yet</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-1.5">
          <button className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11.5px] font-semibold text-[var(--fg-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--fg)] transition-all">
            {expanded ? <><ChevronUp size={12} /> Less</> : <><Eye size={12} /> Details</>}
          </button>
          <button
            onClick={e => { e.stopPropagation(); onRemove(model.name) }}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--red-bg)] hover:text-[var(--red)] transition-colors opacity-0 group-hover:opacity-100"
            title="Remove model"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-5 pb-5 grid grid-cols-2 gap-4">
          <div className="bg-white dark:bg-[#141428] rounded-xl border border-[var(--border)] p-4">
            <p className="text-[11px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider mb-2.5">Capabilities</p>
            <div className="flex flex-wrap gap-1.5">
              {model.features.map(f => (
                <span key={f} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--bg-secondary)] text-[11px] text-[var(--fg-secondary)] border border-[var(--border)]">
                  <Check size={9} className="text-teal flex-shrink-0" />{f}
                </span>
              ))}
            </div>
          </div>
          <div className="bg-white dark:bg-[#141428] rounded-xl border border-[var(--border)] p-4">
            <p className="text-[11px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider mb-2.5">Pricing detail</p>
            <div className="space-y-2">
              {[
                { label: 'Input /1M',  price: model.inputPer1M        },
                { label: 'Output /1M', price: model.outputPer1M       },
                { label: '1K input',   price: model.inputPer1M / 1000 },
                { label: '1K output',  price: model.outputPer1M / 1000 },
              ].map(r => (
                <div key={r.label} className="flex items-center justify-between">
                  <span className="text-[12px] text-[var(--fg-secondary)]">{r.label}</span>
                  <span className="text-[12px] font-semibold text-[var(--fg)] tabular-nums">
                    {r.price < 0.000001 ? '< $0.000001' : `$${r.price.toFixed(r.price < 0.001 ? 6 : r.price < 0.01 ? 4 : 2)}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="col-span-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: pm.dot }} />
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
   CUSTOM PRICES (org_model_prices)
══════════════════════════════════════════════════════════════ */
interface PriceForm { prefix: string; input: string; output: string; cacheRead: string; cacheWrite: string }
const EMPTY_FORM: PriceForm = { prefix: '', input: '', output: '', cacheRead: '', cacheWrite: '' }
const PRICE_FIELDS: [keyof PriceForm, string, string][] = [
  ['prefix',     'Model prefix',     'claude-opus-4'],
  ['input',      'Input / 1M',       '3.00'],
  ['output',     'Output / 1M',      '15.00'],
  ['cacheRead',  'Cache read / 1M',  'default 0.1× input'],
  ['cacheWrite', 'Cache write / 1M', 'default 1.25× input'],
]

function CustomPricesSection({ orgId, initialPrices, canManage }: {
  orgId: string; initialPrices: CustomPrice[]; canManage: boolean
}) {
  const [prices,  setPrices]  = useState<CustomPrice[]>(initialPrices)
  const [form,    setForm]    = useState<PriceForm | null>(null)
  const [editing, setEditing] = useState<string | null>(null)   // prefix being edited (locked)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const fmt = (n: number | null) => n == null ? '—' : `$${n.toFixed(n > 0 && n < 0.1 ? 4 : 2)}`
  const inputCls = 'w-full px-3 py-2 rounded-lg border border-[var(--border)] text-[12.5px] bg-[var(--bg)] text-[var(--fg)] focus:outline-none focus:border-coral focus:ring-2 focus:ring-coral/20 tabular-nums'

  function startAdd() { setForm(EMPTY_FORM); setEditing(null); setError(null) }
  function startEdit(p: CustomPrice) {
    setForm({
      prefix: p.model_prefix, input: String(p.input_per_m), output: String(p.output_per_m),
      cacheRead:  p.cache_read_per_m  == null ? '' : String(p.cache_read_per_m),
      cacheWrite: p.cache_write_per_m == null ? '' : String(p.cache_write_per_m),
    })
    setEditing(p.model_prefix); setError(null)
  }
  function cancel() { setForm(null); setEditing(null); setError(null) }

  async function save() {
    if (!form) return
    const opt = (v: string) => v.trim() === '' ? null : Number(v)
    const body = {
      org_id: orgId,
      model_prefix: form.prefix.trim().toLowerCase(),
      input_per_m: Number(form.input), output_per_m: Number(form.output),
      cache_read_per_m: opt(form.cacheRead), cache_write_per_m: opt(form.cacheWrite),
    }
    if (!body.model_prefix) { setError('Model prefix is required'); return }
    const nums = [body.input_per_m, body.output_per_m, body.cache_read_per_m ?? 0, body.cache_write_per_m ?? 0]
    if (form.input.trim() === '' || form.output.trim() === '' || nums.some(n => !Number.isFinite(n) || n < 0)) {
      setError('Input and output prices are required, and every price must be a non-negative number'); return
    }
    setSaving(true); setError(null)
    try {
      const res  = await fetch('/api/v1/models', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof json.error === 'string' && json.error !== 'Forbidden' ? json.error : (json.reason ?? 'Failed to save price'))
      const saved: CustomPrice = {
        model_prefix: json.model_prefix, input_per_m: Number(json.input_per_m), output_per_m: Number(json.output_per_m),
        cache_read_per_m:  json.cache_read_per_m  == null ? null : Number(json.cache_read_per_m),
        cache_write_per_m: json.cache_write_per_m == null ? null : Number(json.cache_write_per_m),
        updated_at: json.updated_at ?? null,
      }
      setPrices(prev => [...prev.filter(p => p.model_prefix !== saved.model_prefix), saved]
        .sort((a, b) => a.model_prefix.localeCompare(b.model_prefix)))
      cancel()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save price')
    } finally {
      setSaving(false)
    }
  }

  async function remove(prefix: string) {
    if (!window.confirm(`Remove the custom price for "${prefix}"? New usage will be priced at list rates.`)) return
    setError(null)
    const res = await fetch(`/api/v1/models?org_id=${orgId}&price_prefix=${encodeURIComponent(prefix)}`, { method: 'DELETE' })
    if (!res.ok) { setError('Failed to remove price'); return }
    setPrices(prev => prev.filter(p => p.model_prefix !== prefix))
  }

  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[var(--border)] flex-wrap">
        <div className="min-w-0">
          <h2 className="text-[14px] font-bold text-[var(--fg)] flex items-center gap-2"><Tag size={14} className="text-coral" /> Custom prices</h2>
          <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5 max-w-[620px]">
            Negotiated or private pricing in USD per 1M tokens. Applies to usage ingested from now on; the longest matching model prefix wins.
          </p>
        </div>
        {canManage && !form && (
          <button onClick={startAdd} className="btn-primary flex-shrink-0"><Plus size={14} /> Add price</button>
        )}
      </div>

      {form && (
        <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--bg-secondary)]/50 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {PRICE_FIELDS.map(([k, label, ph]) => (
              <label key={k} className={cn('block', k === 'prefix' && 'col-span-2 sm:col-span-1')}>
                <span className="text-[10.5px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider">{label}</span>
                <input
                  value={form[k]} placeholder={ph}
                  disabled={k === 'prefix' && editing !== null}
                  inputMode={k === 'prefix' ? 'text' : 'decimal'}
                  onChange={e => { const v = e.target.value; setForm(f => f ? { ...f, [k]: v } : f) }}
                  className={cn(inputCls, 'mt-1', k === 'prefix' && editing !== null && 'opacity-60')}
                />
              </label>
            ))}
          </div>
          {error && <p className="text-[12px] text-[var(--red)]">{error}</p>}
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={saving} className="btn-primary">
              <Check size={14} /> {saving ? 'Saving…' : editing ? 'Save changes' : 'Add price'}
            </button>
            <button onClick={cancel} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {!form && error && <p className="px-5 pt-3 text-[12px] text-[var(--red)]">{error}</p>}

      {prices.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-[12.5px] text-[var(--fg-secondary)]">No custom prices. All usage is priced at public list rates.</p>
          {!canManage && <p className="text-[11.5px] text-[var(--fg-tertiary)] mt-1">Owners and admins can add overrides.</p>}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider bg-[var(--bg-secondary)]/50">
                <th className="px-5 py-2.5 font-semibold">Model prefix</th>
                <th className="px-3 py-2.5 font-semibold text-right">Input</th>
                <th className="px-3 py-2.5 font-semibold text-right">Output</th>
                <th className="px-3 py-2.5 font-semibold text-right">Cache read</th>
                <th className="px-3 py-2.5 font-semibold text-right">Cache write</th>
                {canManage && <th className="px-5 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {prices.map(p => (
                <tr key={p.model_prefix} className="border-t border-[var(--border)]">
                  <td className="px-5 py-2.5 font-mono text-[12px] text-[var(--fg)]">{p.model_prefix}<span className="text-[var(--fg-tertiary)]">*</span></td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[var(--fg)]">{fmt(p.input_per_m)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[var(--fg)]">{fmt(p.output_per_m)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[var(--fg-secondary)]">{fmt(p.cache_read_per_m)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[var(--fg-secondary)]">{fmt(p.cache_write_per_m)}</td>
                  {canManage && (
                    <td className="px-5 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => startEdit(p)} aria-label={`Edit ${p.model_prefix}`}
                          className="p-1.5 rounded-lg text-[var(--fg-tertiary)] hover:text-[var(--fg)] hover:bg-[var(--bg-secondary)]"><Pencil size={13} /></button>
                        <button onClick={() => remove(p.model_prefix)} aria-label={`Delete ${p.model_prefix}`}
                          className="p-1.5 rounded-lg text-[var(--fg-tertiary)] hover:text-[var(--red)] hover:bg-[var(--red-bg)]"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   MAIN CLIENT
══════════════════════════════════════════════════════════════ */
interface Props {
  initialModels:   EnabledModel[]
  orgId:           string
  initialPrices:   CustomPrice[]
  canManagePrices: boolean
}

export function ModelsClient({ initialModels, orgId, initialPrices, canManagePrices }: Props) {
  const catalog = useMemo(() => META.map(m => priced(m, initialPrices)), [initialPrices])
  const [models,      setModels]      = useState<Model[]>(() =>
    initialModels.map(em => {
      const cat = catalog.find(c => c.name === em.model || c.id === em.model)
      if (!cat) return null
      return { ...cat, addedAt: em.addedAt, tokensUsed30d: em.tokensUsed30d, costUsed30d: em.costUsed30d, avgLatencyMs: em.avgLatencyMs } as Model
    }).filter(Boolean) as Model[]
  )
  const [provFilter,  setProvFilter]  = useState<Provider | 'all'>('all')
  const [search,      setSearch]      = useState('')
  const [sortBy,      setSortBy]      = useState<SortKey>('usage')
  const [sortDir,     setSortDir]     = useState<'asc' | 'desc'>('desc')
  const [expandedId,  setExpandedId]  = useState<string | null>(null)
  const [showCalc,    setShowCalc]    = useState(false)
  const [showAdd,     setShowAdd]     = useState(false)
  const [removing,    setRemoving]    = useState<string | null>(null)

  const alreadyAdded = new Set(models.map(m => m.name))

  const TOTAL_COST   = models.reduce((s, m) => s + m.costUsed30d, 0)
  const TOTAL_TOKENS = models.reduce((s, m) => s + m.tokensUsed30d, 0)

  async function handleRemove(modelName: string) {
    setRemoving(modelName)
    try {
      await fetch(`/api/v1/models?org_id=${orgId}&model=${encodeURIComponent(modelName)}`, { method: 'DELETE' })
      setModels(prev => prev.filter(m => m.name !== modelName))
    } finally {
      setRemoving(null)
    }
  }

  function handleAdded(cat: CatalogModel) {
    const m: Model = { ...cat, addedAt: new Date().toISOString(), tokensUsed30d: 0, costUsed30d: 0 }
    setModels(prev => [...prev, m])
  }

  function handleSort(key: SortKey) {
    if (sortBy === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(key); setSortDir('desc') }
  }

  const filtered = useMemo(() => {
    let ms = models
    if (provFilter !== 'all') ms = ms.filter(m => m.provider === provFilter)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, provFilter, search, sortBy, sortDir])

  function SortBtn({ k, label }: { k: SortKey; label: string }) {
    const active = sortBy === k
    return (
      <button onClick={() => handleSort(k)}
        className={cn('flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider transition-colors',
          active ? 'text-coral' : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]')}>
        {label}
        {active
          ? sortDir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />
          : <ChevronDown size={10} className="opacity-30" />}
      </button>
    )
  }

  /* ── Empty state ── */
  if (models.length === 0 && !search && provFilter === 'all') {
    return (
      <div className="space-y-5">
        <p className="text-[13px] text-[var(--fg-secondary)]">LLM registry · pricing · your usage in the last 30 days</p>

        <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl py-20 flex flex-col items-center text-center px-8">
          <div className="w-16 h-16 rounded-2xl bg-coral/10 flex items-center justify-center mb-5">
            <Cpu size={28} className="text-coral" />
          </div>
          <h2 className="text-[18px] font-bold text-[var(--fg)] mb-2">No models added yet</h2>
          <p className="text-[13px] text-[var(--fg-secondary)] max-w-[380px] mb-6">
            Add the LLM models your team uses. TokenFin will track token usage and cost per model in real time.
          </p>

          {/* Quick-add recommended */}
          <div className="w-full max-w-[480px] mb-6">
            <p className="text-[11px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider mb-3">Quick add</p>
            <div className="grid grid-cols-3 gap-2">
              {catalog.filter(m => ['claude-sonnet-4-6', 'gpt-4o', 'gemini-2.5-flash'].includes(m.id)).map(m => {
                const pm = PROVIDER_META[m.provider]
                return (
                  <button key={m.name}
                    onClick={async () => {
                      await fetch('/api/v1/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org_id: orgId, model: m.name }) })
                      handleAdded(m)
                    }}
                    className="flex flex-col items-center gap-2 p-3 rounded-xl border border-[var(--border)] hover:border-coral hover:bg-coral/5 transition-all group">
                    <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center border text-[12px] font-bold', pm.bg, pm.border)} style={{ color: pm.dot }}>
                      {m.provider[0].toUpperCase()}
                    </div>
                    <p className="text-[11px] font-semibold text-[var(--fg)] group-hover:text-coral transition-colors">{m.displayName}</p>
                    <p className="text-[10px] text-[var(--fg-tertiary)]">{fmtPrice(m.inputPer1M)} in</p>
                  </button>
                )
              })}
            </div>
          </div>

          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus size={14} /> Browse all models
          </button>
        </div>

        <CustomPricesSection orgId={orgId} initialPrices={initialPrices} canManage={canManagePrices} />

        {showAdd && (
          <AddModelModal orgId={orgId} catalog={catalog} alreadyAdded={alreadyAdded} onClose={() => setShowAdd(false)} onAdded={m => { handleAdded(m); setShowAdd(false) }} />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-[13px] text-[var(--fg-secondary)]">LLM registry · pricing · your usage in the last 30 days</p>
        <div className="flex items-center gap-2">
          {models.length > 0 && (
            <button onClick={() => setShowCalc(true)} className="btn-secondary">
              <Calculator size={14} /> Cost calculator
            </button>
          )}
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus size={14} /> Add model
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Models tracked', value: `${models.length}`,                                     color: 'text-coral'          },
          { label: 'Providers',      value: `${new Set(models.map(m => m.provider)).size}`,          color: 'text-[var(--blue)]'  },
          { label: 'Cost · Last 30 days', value: TOTAL_COST > 0 ? `$${TOTAL_COST.toFixed(2)}` : '$0.00', color: 'text-[var(--amber)]' },
          { label: 'Total tokens',   value: fmtTokens(TOTAL_TOKENS),                                 color: 'text-teal'           },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl px-4 py-3">
            <p className={cn('text-[17px] font-bold tabular-nums', s.color)}>{s.value}</p>
            <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl p-1">
          <button onClick={() => setProvFilter('all')}
            className={cn('px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all', provFilter === 'all' ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
            All <span className="ml-1 text-[10px] opacity-60">{models.length}</span>
          </button>
          {(['anthropic', 'openai', 'google'] as Provider[]).map(p => {
            const pm  = PROVIDER_META[p]
            const cnt = models.filter(m => m.provider === p).length
            if (cnt === 0) return null
            return (
              <button key={p} onClick={() => setProvFilter(p)}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all',
                  provFilter === p ? `${pm.bg} ${pm.color}` : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: pm.dot }} />
                {pm.label}
                <span className="text-[10px] opacity-60">{cnt}</span>
              </button>
            )
          })}
        </div>

        <div className="relative flex-1 max-w-[260px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search models…"
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-[var(--border)] text-[12.5px] bg-[var(--bg)] text-[var(--fg)] focus:outline-none focus:border-coral focus:ring-2 focus:ring-coral/20 transition-all" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
        <div className="grid grid-cols-[2.5fr_1fr_1.4fr_1.4fr_1.6fr_130px] gap-3 px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]/50">
          <SortBtn k="name"         label="Model"          />
          <div className="text-[10px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider">Price source</div>
          <SortBtn k="context"      label="Context"        />
          <SortBtn k="input_price"  label="Price"          />
          <SortBtn k="usage"        label="Usage · 30 days" />
          <div />
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <AlertTriangle size={22} className="text-[var(--fg-tertiary)]" />
            <p className="text-[13px] text-[var(--fg-secondary)]">No models match your filters</p>
            <button onClick={() => { setProvFilter('all'); setSearch('') }} className="text-[12.5px] text-coral hover:underline">
              Clear filters
            </button>
          </div>
        ) : (
          filtered.map(model => (
            <ModelRow key={model.name} model={model}
              usagePct={TOTAL_COST > 0 ? (model.costUsed30d / TOTAL_COST) * 100 : 0}
              totalCost={TOTAL_COST}
              expanded={expandedId === model.name}
              onToggle={() => setExpandedId(expandedId === model.name ? null : model.name)}
              onRemove={removing ? () => {} : handleRemove}
            />
          ))
        )}
      </div>

      <CustomPricesSection orgId={orgId} initialPrices={initialPrices} canManage={canManagePrices} />

      {/* Footnote */}
      <div className="flex items-start gap-2 px-4 py-3 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)]">
        <AlertTriangle size={12} className="text-[var(--amber)] flex-shrink-0 mt-0.5" />
        <p className="text-[11.5px] text-[var(--fg-tertiary)]">
          List prices come from TokenFin&apos;s pricing table — the same rates used to cost every ingested event. A custom price
          (below) overrides the list price for new usage. Usage covers every source (SDK, OTLP agents) in the last 30 days;
          cache reads/writes are priced at their own rates.
        </p>
      </div>

      {showAdd && (
        <AddModelModal
          orgId={orgId}
          catalog={catalog}
          alreadyAdded={alreadyAdded}
          onClose={() => setShowAdd(false)}
          onAdded={m => { handleAdded(m); }}
        />
      )}
      {showCalc && <CostCalculator models={models} onClose={() => setShowCalc(false)} />}

      {removing && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-3 bg-[var(--fg)] text-[var(--bg)] rounded-2xl shadow-2xl text-[13px] font-semibold z-50">
          <span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--bg)]/30 border-t-[var(--bg)] animate-spin" /> Removing model…
        </div>
      )}
    </div>
  )
}
