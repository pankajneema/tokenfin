'use client'
import { useState, useMemo } from 'react'
import Link from 'next/link'
import {
  Plus, Search, LayoutGrid, List, MoreHorizontal,
  Key, BarChart3, Trash2, ExternalLink,
  Clock, Zap, Activity, TrendingUp, TrendingDown,
  ChevronRight, Layers, X, ArrowRight,
} from 'lucide-react'
import { cn, formatCost, formatTokens, formatNumber } from '@/lib/utils'
import type { EnrichedProject } from './page'

/* ── Color palette per project index ───────────────────────── */
const PALETTE = [
  { accent: '#E8533A', light: '#FDECEA', text: 'text-coral',          ring: 'ring-coral/20'          },
  { accent: '#00C48C', light: '#E6FAF4', text: 'text-teal',           ring: 'ring-teal/20'           },
  { accent: '#8B5CF6', light: '#F5F3FF', text: 'text-purple-500',     ring: 'ring-purple-200'        },
  { accent: '#60A5FA', light: '#EFF6FF', text: 'text-blue-400',       ring: 'ring-blue-200'          },
  { accent: '#F59E0B', light: '#FFFBEB', text: 'text-amber-500',      ring: 'ring-amber-200'         },
]

/* ── Helpers ────────────────────────────────────────────────── */
const DEMO: EnrichedProject[] = [
  { id: '1', name: 'Backend API',    slug: 'backend-api',    description: 'Main production API handling all customer-facing LLM calls.', created_at: new Date(Date.now() - 45 * 86400_000).toISOString(), cost: 1420.50, tokens: 128_000_000, reqs: 8340, keyCount: 3, lastEventAt: new Date(Date.now() - 120_000).toISOString() },
  { id: '2', name: 'ML Pipeline',    slug: 'ml-pipeline',    description: 'Embedding and transformation pipeline for training data.', created_at: new Date(Date.now() - 30 * 86400_000).toISOString(), cost: 840.30,  tokens:  64_000_000, reqs: 4820, keyCount: 2, lastEventAt: new Date(Date.now() - 540_000).toISOString() },
  { id: '3', name: 'Customer Bot',   slug: 'customer-bot',   description: 'Claude-powered support bot handling tier-1 support tickets.', created_at: new Date(Date.now() - 20 * 86400_000).toISOString(), cost: 450.10,  tokens:  38_000_000, reqs: 2910, keyCount: 1, lastEventAt: new Date(Date.now() - 3_600_000).toISOString() },
  { id: '4', name: 'Dev Playground', slug: 'dev-playground', description: 'Internal sandbox for prototyping and developer experiments.', created_at: new Date(Date.now() - 10 * 86400_000).toISOString(), cost: 136.70,  tokens:  12_000_000, reqs:  820, keyCount: 4, lastEventAt: new Date(Date.now() - 86400_000).toISOString() },
]

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 50)
}

function reltime(iso: string | null) {
  if (!iso) return 'Never'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60)    return `${Math.round(s)}s ago`
  if (s < 3600)  return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function isActive(iso: string | null) {
  if (!iso) return false
  return (Date.now() - new Date(iso).getTime()) < 3600_000 // active if event in last 1h
}

/* ── Mini sparkline ─────────────────────────────────────────── */
const SPARK_SEEDS = [
  [4, 7, 5, 9, 6, 11, 8],
  [3, 5, 8, 6, 9, 7, 11],
  [6, 4, 7, 5, 8, 6, 9],
  [2, 5, 3, 7, 5, 8, 6],
]

function Sparkline({ seed, color }: { seed: number; color: string }) {
  const data = SPARK_SEEDS[seed % SPARK_SEEDS.length]
  const max = Math.max(...data), min = Math.min(...data), range = max - min || 1
  const W = 64, H = 22, pad = 2
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W
    const y = H - pad - ((v - min) / range) * (H - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const id = `sp${seed}${color.replace(/[^a-z0-9]/gi, '')}`
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity={0.2} />
          <stop offset="100%" stopColor={color} stopOpacity={0}   />
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill={`url(#${id})`} />
      <polyline points={pts} stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" fill="none" />
    </svg>
  )
}

/* ── Project card (grid view) ───────────────────────────────── */
function ProjectCard({ project, index, onDelete }: { project: EnrichedProject; index: number; onDelete: (id: string) => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const pal    = PALETTE[index % PALETTE.length]
  const active = isActive(project.lastEventAt)
  const trend  = [+8.2, +14.1, -3.2, +2.1][index % 4]

  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden
                    hover:shadow-lg hover:border-[var(--border-strong)] transition-all duration-200 flex flex-col group">

      {/* Accent bar */}
      <div className="h-1.5 w-full" style={{ backgroundColor: pal.accent }} />

      <div className="p-5 flex flex-col flex-1 gap-4">

        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Icon */}
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: pal.light }}>
              <Layers size={16} style={{ color: pal.accent }} strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <h3 className="text-[13.5px] font-bold text-[var(--fg)] truncate">{project.name}</h3>
              <p className="text-[11px] text-[var(--fg-tertiary)] font-mono truncate">/{project.slug}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Status badge */}
            <div className={cn(
              'flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold',
              active
                ? 'bg-[var(--green-bg)] text-[var(--green)]'
                : 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]',
            )}>
              <span className={cn('w-1 h-1 rounded-full', active ? 'bg-teal' : 'bg-[var(--fg-tertiary)]')} />
              {active ? 'Active' : 'Idle'}
            </div>

            {/* Menu */}
            <div className="relative">
              <button
                onClick={() => setMenuOpen(v => !v)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)]
                           hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] transition-colors"
              >
                <MoreHorizontal size={14} />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1.5 z-20 bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-lg py-1.5 min-w-[140px]">
                    <Link href={`/dashboard/analytics?project=${project.id}`} className="flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] transition-colors" onClick={() => setMenuOpen(false)}>
                      <BarChart3 size={13} /> Analytics
                    </Link>
                    <Link href={`/dashboard/keys?project=${project.id}`} className="flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] transition-colors" onClick={() => setMenuOpen(false)}>
                      <Key size={13} /> API Keys
                    </Link>
                    <div className="my-1 border-t border-[var(--border)]" />
                    <button onClick={() => { onDelete(project.id); setMenuOpen(false) }} className="w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-[var(--red)] hover:bg-[var(--red-bg)] transition-colors">
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="text-[12px] text-[var(--fg-secondary)] leading-relaxed line-clamp-2">
          {project.description || 'No description yet.'}
        </p>

        {/* Cost + trend */}
        <div>
          <div className="flex items-end justify-between gap-1">
            <p className="text-[24px] font-bold text-[var(--fg)] tabular-nums leading-none tracking-tight">
              {formatCost(project.cost)}
            </p>
            <div className={cn(
              'flex items-center gap-0.5 text-[11px] font-semibold mb-0.5',
              trend >= 0 ? 'text-[var(--red)]' : 'text-[var(--green)]',
            )}>
              {trend >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
              {trend >= 0 ? '+' : ''}{trend}%
            </div>
          </div>
          <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-0.5">this month vs last month</p>
        </div>

        {/* Token + request row + sparkline */}
        <div className="flex items-end justify-between gap-2">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--fg-secondary)]">
              <Zap size={11} style={{ color: pal.accent }} />
              <span className="tabular-nums font-medium">{formatTokens(project.tokens)}</span>
              <span className="text-[var(--fg-tertiary)]">tokens</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--fg-secondary)]">
              <Activity size={11} style={{ color: pal.accent }} />
              <span className="tabular-nums font-medium">{formatNumber(project.reqs)}</span>
              <span className="text-[var(--fg-tertiary)]">requests</span>
            </div>
          </div>
          <Sparkline seed={index} color={pal.accent} />
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--border)] pt-3.5 mt-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] text-[var(--fg-tertiary)]">
            <div className="flex items-center gap-1">
              <Key size={11} />
              <span>{project.keyCount} {project.keyCount === 1 ? 'key' : 'keys'}</span>
            </div>
            <span>·</span>
            <div className="flex items-center gap-1">
              <Clock size={11} />
              <span>{reltime(project.lastEventAt)}</span>
            </div>
          </div>
          <Link
            href={`/dashboard/analytics?project=${project.id}`}
            className="flex items-center gap-1 text-[11.5px] font-semibold transition-colors"
            style={{ color: pal.accent }}
          >
            View <ChevronRight size={11} />
          </Link>
        </div>
      </div>
    </div>
  )
}

/* ── List row ───────────────────────────────────────────────── */
function ProjectRow({ project, index, onDelete }: { project: EnrichedProject; index: number; onDelete: (id: string) => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const pal    = PALETTE[index % PALETTE.length]
  const active = isActive(project.lastEventAt)
  const trend  = [+8.2, +14.1, -3.2, +2.1][index % 4]

  return (
    <tr className="group hover:bg-[var(--bg-hover)] transition-colors border-b border-[var(--border)] last:border-0">
      {/* Name */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: pal.accent }} />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[var(--fg)] truncate">{project.name}</p>
            <p className="text-[10.5px] text-[var(--fg-tertiary)] font-mono">/{project.slug}</p>
          </div>
        </div>
      </td>
      {/* Status */}
      <td className="px-4 py-3.5">
        <div className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold',
          active ? 'bg-[var(--green-bg)] text-[var(--green)]' : 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]',
        )}>
          <span className={cn('w-1 h-1 rounded-full', active ? 'bg-teal' : 'bg-[var(--fg-tertiary)]')} />
          {active ? 'Active' : 'Idle'}
        </div>
      </td>
      {/* Cost */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold text-[var(--fg)] tabular-nums">{formatCost(project.cost)}</span>
          <span className={cn('text-[10.5px] font-medium tabular-nums', trend >= 0 ? 'text-[var(--red)]' : 'text-[var(--green)]')}>
            {trend >= 0 ? '↑' : '↓'}{Math.abs(trend)}%
          </span>
        </div>
      </td>
      {/* Tokens */}
      <td className="px-4 py-3.5 text-[12.5px] text-[var(--fg-secondary)] tabular-nums">{formatTokens(project.tokens)}</td>
      {/* Requests */}
      <td className="px-4 py-3.5 text-[12.5px] text-[var(--fg-secondary)] tabular-nums">{formatNumber(project.reqs)}</td>
      {/* Keys */}
      <td className="px-4 py-3.5 text-[12.5px] text-[var(--fg-secondary)]">{project.keyCount}</td>
      {/* Last active */}
      <td className="px-4 py-3.5 text-[12px] text-[var(--fg-tertiary)] whitespace-nowrap">{reltime(project.lastEventAt)}</td>
      {/* Actions */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Link href={`/dashboard/analytics?project=${project.id}`} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--fg)] transition-colors">
            <BarChart3 size={13} />
          </Link>
          <div className="relative">
            <button onClick={() => setMenuOpen(v => !v)} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--fg)] transition-colors">
              <MoreHorizontal size={13} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-lg py-1.5 min-w-[130px]">
                  <Link href={`/dashboard/keys?project=${project.id}`} className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] transition-colors" onClick={() => setMenuOpen(false)}>
                    <Key size={12} /> API Keys
                  </Link>
                  <div className="my-1 border-t border-[var(--border)]" />
                  <button onClick={() => { onDelete(project.id); setMenuOpen(false) }} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--red)] hover:bg-[var(--red-bg)] transition-colors">
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </td>
    </tr>
  )
}

/* ── New project modal ──────────────────────────────────────── */
const TEMPLATES = [
  { id: 'api',     emoji: '⚡', label: 'API Backend',    desc: 'REST or GraphQL API' },
  { id: 'chatbot', emoji: '🤖', label: 'Chatbot / Agent', desc: 'Conversational AI'  },
  { id: 'data',    emoji: '🔁', label: 'Data Pipeline',   desc: 'ETL / embeddings'   },
  { id: 'custom',  emoji: '✨', label: 'Custom',          desc: 'Start from scratch'  },
]

function NewProjectModal({
  orgId,
  onClose,
  onCreate,
}: {
  orgId: string
  onClose: () => void
  onCreate: (p: EnrichedProject) => void
}) {
  const [template, setTemplate] = useState('')
  const [name,     setName]     = useState('')
  const [slug,     setSlug]     = useState('')
  const [desc,     setDesc]     = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  function handleName(v: string) {
    setName(v)
    if (!slugEdited) setSlug(slugify(v))
  }

  async function handleCreate() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/projects', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ org_id: orgId, name, slug, description: desc || null }),
      })
      if (!res.ok) {
        const msg = await res.text()
        throw new Error(msg || 'Failed to create project')
      }
      const created = await res.json()
      onCreate({ ...created, cost: 0, tokens: 0, reqs: 0, keyCount: 0, lastEventAt: null })
      onClose()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const canCreate = name.trim().length >= 2 && slug.length >= 2

  return (
    /* Backdrop */
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      {/* Panel */}
      <div className="relative bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-[480px] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-[15px] font-bold text-[var(--fg)]">New Project</h2>
            <p className="text-[11.5px] text-[var(--fg-secondary)] mt-0.5">Set up a project to start tracking LLM costs</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* Template picker */}
          <div>
            <p className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider mb-2.5">Template</p>
            <div className="grid grid-cols-4 gap-2">
              {TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTemplate(t.id)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all duration-150',
                    template === t.id
                      ? 'border-coral bg-[#FDECEA] dark:bg-coral/10'
                      : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]',
                  )}
                >
                  <span className="text-[20px] leading-none">{t.emoji}</span>
                  <span className="text-[10.5px] font-semibold text-[var(--fg)] leading-tight">{t.label}</span>
                  <span className="text-[9.5px] text-[var(--fg-tertiary)] leading-tight">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Project name */}
          <div>
            <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">
              Project Name
            </label>
            <input
              value={name}
              onChange={e => handleName(e.target.value)}
              placeholder="e.g. Backend API"
              className="input"
              autoFocus
            />
          </div>

          {/* Slug */}
          <div>
            <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">
              Project Slug
            </label>
            <div className="flex items-center border border-[var(--border)] rounded-lg overflow-hidden focus-within:border-coral focus-within:ring-2 focus-within:ring-coral/20 transition-all">
              <span className="px-3 py-2 bg-[var(--bg-secondary)] text-[12px] text-[var(--fg-tertiary)] border-r border-[var(--border)] flex-shrink-0 font-mono">
                tokenfin/
              </span>
              <input
                value={slug}
                onChange={e => { setSlug(slugify(e.target.value)); setSlugEdited(true) }}
                placeholder="my-project"
                className="flex-1 px-3 py-2 bg-transparent text-[13px] text-[var(--fg)] font-mono placeholder:text-[var(--fg-tertiary)] focus:outline-none"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">
              Description <span className="normal-case font-normal text-[var(--fg-tertiary)]">(optional)</span>
            </label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="What does this project do?"
              rows={2}
              className="input resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-[12px] text-[var(--red)] bg-[var(--red-bg)] border border-[var(--red)]/20 px-3 py-2 rounded-lg">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between gap-3">
          <button onClick={onClose} className="btn-secondary text-[13px] py-2">Cancel</button>
          <button
            onClick={handleCreate}
            disabled={!canCreate || loading}
            className="btn-primary text-[13px] py-2 min-w-[130px] justify-center"
          >
            {loading
              ? <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              : <><Plus size={13} /> Create project</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Delete confirm ─────────────────────────────────────────── */
function DeleteConfirm({ name, onConfirm, onCancel, loading }: { name: string; onConfirm: () => void; onCancel: () => void; loading: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-[360px] p-6">
        <div className="w-10 h-10 rounded-xl bg-[var(--red-bg)] flex items-center justify-center mb-4">
          <Trash2 size={18} className="text-[var(--red)]" />
        </div>
        <h3 className="text-[15px] font-bold text-[var(--fg)] mb-1.5">Delete "{name}"?</h3>
        <p className="text-[13px] text-[var(--fg-secondary)] mb-5 leading-relaxed">
          This will permanently delete the project and all associated API keys. Usage history is retained.
        </p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="btn-secondary flex-1 text-[13px] py-2 justify-center">Cancel</button>
          <button onClick={onConfirm} disabled={loading} className="flex-1 py-2 rounded-xl bg-[var(--red)] text-white text-[13px] font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
            {loading ? <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Empty state ────────────────────────────────────────────── */
function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-[#FDECEA] dark:bg-coral/10 flex items-center justify-center mb-5">
        <Layers size={28} className="text-coral" strokeWidth={1.5} />
      </div>
      <h3 className="text-[16px] font-bold text-[var(--fg)] mb-2">No projects yet</h3>
      <p className="text-[13px] text-[var(--fg-secondary)] max-w-xs leading-relaxed mb-6">
        Create your first project to start tracking LLM costs and token usage.
      </p>
      <button onClick={onNew} className="btn-primary">
        <Plus size={14} /> New project
      </button>
    </div>
  )
}

/* ── Main client component ──────────────────────────────────── */
interface Props {
  projects: EnrichedProject[]
  orgId:    string
}

export function ProjectsClient({ projects: initialProjects, orgId }: Props) {
  const [projects,  setProjects]  = useState<EnrichedProject[]>(initialProjects)
  const [view,      setView]      = useState<'grid' | 'list'>('grid')
  const [query,     setQuery]     = useState('')
  const [showNew,   setShowNew]   = useState(false)
  const [deleteId,  setDeleteId]  = useState<string | null>(null)
  const [deleting,  setDeleting]  = useState(false)

  const display = initialProjects.length ? projects : DEMO

  const filtered = useMemo(() => {
    if (!query.trim()) return display
    const q = query.toLowerCase()
    return display.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.slug.toLowerCase().includes(q) ||
      (p.description ?? '').toLowerCase().includes(q),
    )
  }, [display, query])

  /* ── Stats ── */
  const totalCost    = display.reduce((s, p) => s + p.cost,   0)
  const totalReqs    = display.reduce((s, p) => s + p.reqs,   0)
  const mostActive   = [...display].sort((a, b) => b.cost - a.cost)[0]

  /* ── Handlers ── */
  function handleCreate(p: EnrichedProject) {
    setProjects(prev => [p, ...prev])
  }

  async function handleDelete(id: string) {
    setDeleting(true)
    try {
      await fetch(`/api/v1/projects?id=${id}`, { method: 'DELETE' })
      setProjects(prev => prev.filter(p => p.id !== id))
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  const deleteTarget = display.find(p => p.id === deleteId)

  return (
    <div className="space-y-5">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Projects</h1>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">
            {display.length} project{display.length !== 1 ? 's' : ''} · Last 30 days
          </p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary text-[13px]">
          <Plus size={14} /> New project
        </button>
      </div>

      {/* ── Summary strip ── */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total cost',     value: formatCost(totalCost),      icon: '💰', color: 'text-coral'          },
          { label: 'Total requests', value: formatNumber(totalReqs),    icon: '⚡', color: 'text-teal'           },
          { label: 'Biggest spend',  value: mostActive?.name ?? '—',    icon: '🏆', color: 'text-[var(--blue)]'  },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="text-[20px] leading-none">{s.icon}</span>
            <div className="min-w-0">
              <p className={cn('text-[14px] font-bold truncate tabular-nums', s.color)}>{s.value}</p>
              <p className="text-[10.5px] text-[var(--fg-tertiary)]">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Toolbar: search + view toggle ── */}
      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="flex-1 relative max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search projects…"
            className="input pl-8 text-[13px] py-2"
          />
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-0.5 p-0.5 bg-[var(--bg-tertiary)] rounded-lg">
          {([['grid', LayoutGrid], ['list', List]] as const).map(([v, Icon]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'w-8 h-7 rounded-[7px] flex items-center justify-center transition-all duration-150',
                view === v
                  ? 'bg-white dark:bg-[#1E1E35] text-[var(--fg)] shadow-sm'
                  : 'text-[var(--fg-tertiary)] hover:text-[var(--fg)]',
              )}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      {filtered.length === 0 && query ? (
        <div className="py-16 text-center">
          <p className="text-[13px] text-[var(--fg-secondary)]">No projects match "<span className="font-medium text-[var(--fg)]">{query}</span>"</p>
          <button onClick={() => setQuery('')} className="mt-2 text-[12px] text-coral hover:underline">Clear search</button>
        </div>
      ) : display.length === 0 ? (
        <EmptyState onNew={() => setShowNew(true)} />
      ) : view === 'grid' ? (
        /* ── Grid ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {filtered.map((p, i) => (
            <ProjectCard key={p.id} project={p} index={i} onDelete={setDeleteId} />
          ))}
          {/* Add project card */}
          <button
            onClick={() => setShowNew(true)}
            className="bg-[var(--bg-secondary)] border-2 border-dashed border-[var(--border)] rounded-2xl p-5 flex flex-col items-center justify-center gap-2.5 text-[var(--fg-tertiary)] hover:border-coral hover:text-coral hover:bg-[#FDECEA]/40 dark:hover:bg-coral/5 transition-all duration-200 min-h-[200px]"
          >
            <div className="w-10 h-10 rounded-xl bg-[var(--bg-tertiary)] flex items-center justify-center">
              <Plus size={18} />
            </div>
            <p className="text-[12.5px] font-semibold">New project</p>
          </button>
        </div>
      ) : (
        /* ── List ── */
        <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {['Project', 'Status', 'Cost (30d)', 'Tokens', 'Requests', 'API Keys', 'Last Active', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => (
                <ProjectRow key={p.id} project={p} index={i} onDelete={setDeleteId} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modals ── */}
      {showNew && (
        <NewProjectModal orgId={orgId} onClose={() => setShowNew(false)} onCreate={handleCreate} />
      )}
      {deleteId && deleteTarget && (
        <DeleteConfirm
          name={deleteTarget.name}
          loading={deleting}
          onConfirm={() => handleDelete(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  )
}
