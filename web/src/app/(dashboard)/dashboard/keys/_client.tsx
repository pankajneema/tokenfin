'use client'
import { useState } from 'react'
import {
  Plus, Copy, Check, Trash2, Key, MoreHorizontal,
  Eye, EyeOff, Search, Shield,
  AlertTriangle, X, ChevronDown, Zap, Clock,
  BarChart3, Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ApiKeyRow, ProjectOption } from './page'

/* ── Types ─────────────────────────────────────────────────── */
type Env   = 'production' | 'staging' | 'development'
type Scope = 'read' | 'write' | 'admin'

/* ── Helpers ── */
const ENV_META: Record<Env, { label: string; dot: string; bg: string; text: string }> = {
  production:  { label: 'Prod',  dot: '#E8533A', bg: 'bg-[var(--red-bg)]',      text: 'text-[var(--red)]'          },
  staging:     { label: 'Stage', dot: '#F59E0B', bg: 'bg-[var(--amber-bg)]',    text: 'text-[var(--amber)]'        },
  development: { label: 'Dev',   dot: '#9898B0', bg: 'bg-[var(--bg-tertiary)]', text: 'text-[var(--fg-secondary)]' },
}

const SCOPE_META: Record<Scope, { label: string; color: string }> = {
  read:  { label: 'Read',  color: 'bg-[var(--blue-bg)] text-[var(--blue)]'   },
  write: { label: 'Write', color: 'bg-[var(--green-bg)] text-[var(--green)]' },
  admin: { label: 'Admin', color: 'bg-[var(--red-bg)] text-[var(--red)]'     },
}

function reltime(iso: string | null) {
  if (!iso) return 'Never'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60)    return `${Math.round(s)}s ago`
  if (s < 3600)  return `${Math.round(s/60)}m ago`
  if (s < 86400) return `${Math.round(s/3600)}h ago`
  return `${Math.round(s/86400)}d ago`
}

function isExpiringSoon(exp: string | null) {
  if (!exp) return false
  return new Date(exp).getTime() - Date.now() < 30 * 86400_000
}

function ReqBar({ n, maxN, color }: { n: number; maxN: number; color: string }) {
  const pct = maxN > 0 ? (n / maxN) * 100 : 0
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[11.5px] text-[var(--fg-secondary)] tabular-nums">{n.toLocaleString()}</span>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   CREATE KEY MODAL
══════════════════════════════════════════════════════════════ */
function CreateKeyModal({
  projects, orgId, userId, onClose, onCreate,
}: {
  projects: ProjectOption[]
  orgId:    string
  userId:   string
  onClose:  () => void
  onCreate: (key: ApiKeyRow, rawKey: string) => void
}) {
  const [step,    setStep]    = useState<'form' | 'reveal'>('form')
  const [name,    setName]    = useState('')
  const [env,     setEnv]     = useState<Env>('production')
  const [project, setProject] = useState(projects[0]?.id ?? '')
  const [scopes,  setScopes]  = useState<Scope[]>(['read', 'write'])
  const [expiry,  setExpiry]  = useState<'none' | '30d' | '90d' | '1y'>('none')
  const [loading, setLoading] = useState(false)
  const [rawKey,  setRawKey]  = useState('')
  const [copied,  setCopied]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  function toggleScope(s: Scope) {
    setScopes(prev =>
      prev.includes(s) ? (prev.length > 1 ? prev.filter(x => x !== s) : prev) : [...prev, s]
    )
  }

  function expiresAt(): string | null {
    if (expiry === 'none') return null
    const days = expiry === '30d' ? 30 : expiry === '90d' ? 90 : 365
    return new Date(Date.now() + days * 86400_000).toISOString()
  }

  async function handleCreate() {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/v1/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id:     orgId,
          project_id: project,
          name,
          created_by: userId,
          env,
          scopes,
          expires_at: expiresAt(),
        }),
      })
      if (!res.ok) {
        const msg = await res.text()
        throw new Error(msg)
      }
      const data = await res.json()
      setRawKey(data.raw_key)
      const newKey: ApiKeyRow = {
        id:            data.id,
        name:          data.name,
        keyPrefix:     data.key_prefix,
        env:           data.env ?? env,
        scopes:        data.scopes ?? scopes,
        projectId:     data.project_id,
        projectName:   projects.find(p => p.id === data.project_id)?.name ?? '—',
        expiresAt:     data.expires_at ?? null,
        isActive:      true,
        lastUsedAt:    null,
        createdAt:     data.created_at,
        createdByName: 'You',
      }
      onCreate(newKey, data.raw_key)
      setStep('reveal')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create key')
    } finally {
      setLoading(false)
    }
  }

  function copyKey() {
    navigator.clipboard.writeText(rawKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={step === 'form' ? onClose : undefined} />
      <div className="relative bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-[480px] overflow-hidden">

        {step === 'form' ? (
          <>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-coral/10 flex items-center justify-center">
                  <Key size={16} className="text-coral" />
                </div>
                <div>
                  <h2 className="text-[14.5px] font-bold text-[var(--fg)]">Create API key</h2>
                  <p className="text-[11.5px] text-[var(--fg-secondary)]">Key will be shown once — copy it immediately</p>
                </div>
              </div>
              <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors">
                <X size={15} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Name */}
              <div>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">Key name</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Production Backend v2" className="input" autoFocus />
              </div>

              {/* Environment */}
              <div>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">Environment</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['production', 'staging', 'development'] as Env[]).map(e => {
                    const m = ENV_META[e]
                    return (
                      <button key={e} onClick={() => setEnv(e)}
                        className={cn('flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[12.5px] font-semibold transition-all',
                          env === e ? 'border-coral bg-[#FDECEA] dark:bg-coral/10 text-coral' : 'border-[var(--border)] text-[var(--fg-secondary)] hover:border-[var(--border-strong)]')}>
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: m.dot }} />{m.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Project */}
              {projects.length > 0 && (
                <div>
                  <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">Project</label>
                  <div className="relative">
                    <select value={project} onChange={e => setProject(e.target.value)}
                      className="input appearance-none cursor-pointer">
                      {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)] pointer-events-none" />
                  </div>
                </div>
              )}

              {/* Scopes */}
              <div>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">Permissions</label>
                <div className="flex gap-2">
                  {(['read', 'write', 'admin'] as Scope[]).map(s => {
                    const m  = SCOPE_META[s]
                    const on = scopes.includes(s)
                    return (
                      <button key={s} onClick={() => toggleScope(s)}
                        className={cn('flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[12px] font-semibold transition-all',
                          on ? `border-transparent ${m.color}` : 'border-[var(--border)] text-[var(--fg-tertiary)] hover:border-[var(--border-strong)]')}>
                        {on && <Check size={10} />}{m.label}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[11px] text-[var(--fg-tertiary)] mt-1.5">
                  {scopes.includes('admin') ? '⚠ Admin grants full access including key management' : `Key can ${scopes.join(' and ')} usage data`}
                </p>
              </div>

              {/* Expiry */}
              <div>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">Expiry</label>
                <div className="grid grid-cols-4 gap-2">
                  {([['none', 'No expiry'], ['30d', '30 days'], ['90d', '90 days'], ['1y', '1 year']] as const).map(([v, l]) => (
                    <button key={v} onClick={() => setExpiry(v)}
                      className={cn('py-2 rounded-xl border text-[12px] font-semibold transition-all',
                        expiry === v ? 'border-coral bg-[#FDECEA] dark:bg-coral/10 text-coral' : 'border-[var(--border)] text-[var(--fg-secondary)] hover:border-[var(--border-strong)]')}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="text-[12px] text-[var(--red)] bg-[var(--red-bg)] border border-[var(--red)]/20 px-3 py-2 rounded-lg">{error}</p>}
            </div>

            <div className="px-6 py-4 border-t border-[var(--border)] flex gap-2">
              <button onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
              <button onClick={handleCreate} disabled={!name.trim() || !project || loading}
                className="btn-primary flex-1 justify-center disabled:opacity-40">
                {loading
                  ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />Generating…</>
                  : <><Key size={13} />Create key</>}
              </button>
            </div>
          </>
        ) : (
          <div className="px-6 py-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[var(--green-bg)] flex items-center justify-center mx-auto mb-4">
              <Shield size={24} className="text-teal" />
            </div>
            <h3 className="text-[16px] font-bold text-[var(--fg)] mb-1">Key created — copy now</h3>
            <p className="text-[12.5px] text-[var(--fg-secondary)] mb-5">This is the only time your full key is shown. Store it securely.</p>

            <div className="bg-[var(--bg-secondary)] rounded-xl p-3 mb-4 text-left">
              <p className="text-[10px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider mb-2">Your API key</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[11.5px] font-mono text-[var(--fg)] break-all leading-relaxed">{rawKey}</code>
                <button onClick={copyKey}
                  className={cn('flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold flex-shrink-0 transition-all',
                    copied ? 'bg-[var(--green-bg)] text-teal' : 'bg-[var(--bg)] border border-[var(--border)] text-[var(--fg-secondary)] hover:border-[var(--border-strong)]')}>
                  {copied ? <><Check size={12} />Copied!</> : <><Copy size={12} />Copy</>}
                </button>
              </div>
            </div>

            <div className="bg-[var(--amber-bg)] rounded-xl p-3 mb-5 flex items-start gap-2 text-left">
              <AlertTriangle size={13} className="text-[var(--amber)] flex-shrink-0 mt-0.5" />
              <p className="text-[11.5px] text-[var(--fg-secondary)]">Never commit keys to version control. Use environment variables or a secrets manager.</p>
            </div>

            <button onClick={onClose} className="btn-primary w-full justify-center">
              <Check size={13} /> Done, I&apos;ve saved my key
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   DELETE CONFIRM
══════════════════════════════════════════════════════════════ */
function DeleteConfirm({ keyName, onConfirm, onClose }: { keyName: string; onConfirm: () => void; onClose: () => void }) {
  const [text, setText] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-[400px] p-6">
        <div className="w-10 h-10 rounded-2xl bg-[var(--red-bg)] flex items-center justify-center mb-4">
          <Trash2 size={18} className="text-[var(--red)]" />
        </div>
        <h3 className="text-[15px] font-bold text-[var(--fg)] mb-1">Revoke API key</h3>
        <p className="text-[12.5px] text-[var(--fg-secondary)] mb-4">
          Any services using <span className="font-semibold text-[var(--fg)]">{keyName}</span> will immediately lose access.
        </p>
        <div className="mb-4">
          <p className="text-[11.5px] text-[var(--fg-secondary)] mb-1.5">Type <span className="font-mono font-bold text-[var(--fg)]">revoke</span> to confirm</p>
          <input value={text} onChange={e => setText(e.target.value)} placeholder="revoke"
            className="w-full px-3 py-2 rounded-xl border border-[var(--border)] text-[13px] bg-[var(--bg)] focus:outline-none focus:border-[var(--red)] transition-colors" />
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
          <button onClick={onConfirm} disabled={text !== 'revoke'}
            className="flex-1 justify-center flex items-center gap-1.5 py-2 rounded-xl bg-[var(--red)] text-white text-[13px] font-semibold disabled:opacity-40">
            <Trash2 size={13} /> Revoke key
          </button>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   MAIN CLIENT
══════════════════════════════════════════════════════════════ */
interface Props {
  initialKeys: ApiKeyRow[]
  projects:    ProjectOption[]
  orgId:       string
  userId:      string
}

export function KeysClient({ initialKeys, projects, orgId, userId }: Props) {
  const [keys,       setKeys]       = useState<ApiKeyRow[]>(initialKeys)
  const [filter,     setFilter]     = useState<'all' | 'active' | 'inactive'>('all')
  const [search,     setSearch]     = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [deleteId,   setDeleteId]   = useState<string | null>(null)
  const [actionMenu, setActionMenu] = useState<string | null>(null)
  const [revealId,   setRevealId]   = useState<string | null>(null)
  const [copiedId,   setCopiedId]   = useState<string | null>(null)
  const [toggling,   setToggling]   = useState<string | null>(null)
  const [deleting,   setDeleting]   = useState(false)

  const filtered = keys.filter(k => {
    if (filter === 'active'   && !k.isActive) return false
    if (filter === 'inactive' &&  k.isActive) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!k.name.toLowerCase().includes(q) && !k.projectName.toLowerCase().includes(q) && !k.keyPrefix.toLowerCase().includes(q)) return false
    }
    return true
  })

  const totalActive = keys.filter(k => k.isActive).length
  const maxReq      = 0   // no real usage data yet
  const totalCost   = 0   // no real usage data yet

  function handleCreate(key: ApiKeyRow) {
    setKeys(prev => [key, ...prev])
  }

  async function toggleStatus(id: string) {
    const key = keys.find(k => k.id === id)
    if (!key) return
    setToggling(id)
    try {
      await fetch('/api/v1/keys', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: !key.isActive }),
      })
      setKeys(prev => prev.map(k => k.id === id ? { ...k, isActive: !k.isActive } : k))
    } finally {
      setToggling(null)
    }
  }

  async function handleDelete(id: string) {
    setDeleting(true)
    try {
      await fetch(`/api/v1/keys?id=${id}`, { method: 'DELETE' })
      setKeys(prev => prev.filter(k => k.id !== id))
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  function copyPrefix(prefix: string, id: string) {
    navigator.clipboard.writeText(prefix)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const deleteKey = keys.find(k => k.id === deleteId)

  return (
    <div className="space-y-5 max-w-[1100px]">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">API Keys</h1>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">Manage keys for SDK integration and cost attribution</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary" disabled={projects.length === 0}>
          <Plus size={14} /> Create key
        </button>
      </div>

      {projects.length === 0 && (
        <div className="flex items-start gap-2.5 px-4 py-3 bg-[var(--amber-bg)] border border-[var(--amber)]/20 rounded-xl">
          <AlertTriangle size={13} className="text-[var(--amber)] flex-shrink-0 mt-0.5" />
          <p className="text-[12px] text-[var(--fg-secondary)]">
            You need to create a project before generating API keys. <a href="/dashboard/projects" className="text-[var(--blue)] hover:underline font-medium">Create a project →</a>
          </p>
        </div>
      )}

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total keys',    value: String(keys.length),    icon: Key,       color: 'text-coral'           },
          { label: 'Active',        value: String(totalActive),    icon: Activity,  color: 'text-teal'            },
          { label: 'Requests 30d',  value: String(maxReq),         icon: BarChart3, color: 'text-[var(--blue)]'   },
          { label: 'Cost 30d',      value: `$${totalCost.toFixed(2)}`, icon: Zap,  color: 'text-[var(--amber)]'  },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[var(--bg-secondary)] flex items-center justify-center flex-shrink-0">
              <s.icon size={14} className={s.color} />
            </div>
            <div>
              <p className={cn('text-[16px] font-bold tabular-nums', s.color)}>{s.value}</p>
              <p className="text-[10.5px] text-[var(--fg-tertiary)]">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Filter + Search ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl p-1">
          {([['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={cn('px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition-all',
                filter === v ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
              {l}
              <span className={cn('ml-1.5 text-[10px] px-1.5 py-0.5 rounded-md font-semibold',
                filter === v ? 'bg-white/20 text-[var(--bg)]' : 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]')}>
                {v === 'all' ? keys.length : v === 'active' ? keys.filter(k => k.isActive).length : keys.filter(k => !k.isActive).length}
              </span>
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-[280px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search keys, projects…"
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-[var(--border)] text-[12.5px] bg-[var(--bg)] text-[var(--fg)] focus:outline-none focus:border-coral focus:ring-2 focus:ring-coral/20 transition-all" />
        </div>
      </div>

      {/* ── Keys table ── */}
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
        <div className="grid grid-cols-[2.5fr_1.2fr_1.2fr_1fr_1fr_1fr_80px] gap-2 px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]/50">
          {['Key', 'Prefix', 'Project', 'Permissions', 'Requests 30d', 'Last used', ''].map(h => (
            <div key={h} className="text-[10px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider">{h}</div>
          ))}
        </div>

        <div className="divide-y divide-[var(--border)]">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[var(--bg-secondary)] flex items-center justify-center">
                <Key size={22} className="text-[var(--fg-tertiary)]" />
              </div>
              <p className="text-[13px] text-[var(--fg-secondary)]">
                {search ? `No keys matching "${search}"` : 'No API keys yet'}
              </p>
              {!search && projects.length > 0 && (
                <button onClick={() => setShowCreate(true)} className="btn-primary text-[12.5px]">
                  <Plus size={12} /> Create your first key
                </button>
              )}
            </div>
          ) : filtered.map(k => {
            const em      = ENV_META[k.env]
            const isRev   = revealId === k.id
            const expWarn = isExpiringSoon(k.expiresAt)

            return (
              <div key={k.id}
                className={cn('grid grid-cols-[2.5fr_1.2fr_1.2fr_1fr_1fr_1fr_80px] gap-2 items-center px-5 py-4 transition-colors hover:bg-[var(--bg-hover)] group',
                  !k.isActive && 'opacity-60')}>

                {/* Name + env + expiry */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[13px] font-semibold text-[var(--fg)] truncate">{k.name}</p>
                    <span className={cn('px-1.5 py-0.5 rounded-md text-[9.5px] font-bold uppercase tracking-wide flex-shrink-0', em.bg, em.text)}>
                      {em.label}
                    </span>
                    {!k.isActive && (
                      <span className="px-1.5 py-0.5 rounded-md text-[9.5px] font-bold bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]">Inactive</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Clock size={10} className="text-[var(--fg-tertiary)]" />
                    <span className="text-[10.5px] text-[var(--fg-tertiary)]">
                      Created {new Date(k.createdAt).toLocaleDateString()} by {k.createdByName}
                    </span>
                    {expWarn && k.expiresAt && (
                      <span className="flex items-center gap-0.5 text-[10px] font-semibold text-[var(--amber)]">
                        <AlertTriangle size={9} /> Expires {new Date(k.expiresAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Prefix */}
                <div>
                  <div className="flex items-center gap-1.5">
                    <code className="text-[11.5px] font-mono text-[var(--fg-secondary)] bg-[var(--bg-secondary)] px-2 py-0.5 rounded-lg">
                      {isRev ? k.keyPrefix : `${k.keyPrefix.slice(0, 8)}••••`}
                    </code>
                    <button onClick={() => setRevealId(isRev ? null : k.id)} className="text-[var(--fg-tertiary)] hover:text-[var(--fg)] transition-colors">
                      {isRev ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                    <button onClick={() => copyPrefix(k.keyPrefix, k.id)} className="text-[var(--fg-tertiary)] hover:text-coral transition-colors">
                      {copiedId === k.id ? <Check size={12} className="text-teal" /> : <Copy size={12} />}
                    </button>
                  </div>
                </div>

                {/* Project */}
                <div>
                  <span className="text-[12px] text-[var(--fg-secondary)] bg-[var(--bg-secondary)] px-2 py-0.5 rounded-lg">{k.projectName}</span>
                </div>

                {/* Scopes */}
                <div className="flex flex-wrap gap-1">
                  {(k.scopes as Scope[]).map(s => (
                    <span key={s} className={cn('text-[9.5px] font-bold px-1.5 py-0.5 rounded-full', SCOPE_META[s]?.color ?? '')}>
                      {SCOPE_META[s]?.label ?? s}
                    </span>
                  ))}
                </div>

                {/* Requests */}
                <div><ReqBar n={0} maxN={1} color={em.dot} /></div>

                {/* Last used */}
                <div className="text-[11.5px] text-[var(--fg-tertiary)]">{reltime(k.lastUsedAt)}</div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-1 relative">
                  <button onClick={() => toggleStatus(k.id)} disabled={toggling === k.id}
                    className={cn('w-8 h-4 rounded-full relative transition-colors flex-shrink-0 overflow-hidden',
                      k.isActive ? 'bg-teal' : 'bg-[var(--bg-tertiary)]')}
                    title={k.isActive ? 'Deactivate' : 'Activate'}>
                    <span className={cn('absolute top-[2px] left-[2px] w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200',
                      k.isActive ? 'translate-x-[14px]' : 'translate-x-0')} />
                  </button>

                  <button onClick={() => setActionMenu(actionMenu === k.id ? null : k.id)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--fg)] transition-colors">
                    <MoreHorizontal size={14} />
                  </button>

                  {actionMenu === k.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setActionMenu(null)} />
                      <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-xl py-1.5 overflow-hidden">
                        <button onClick={() => { copyPrefix(k.keyPrefix, k.id); setActionMenu(null) }}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12.5px] font-medium text-[var(--fg)] hover:bg-[var(--bg-hover)] transition-colors">
                          <Copy size={13} /> Copy prefix
                        </button>
                        <div className="border-t border-[var(--border)] my-1" />
                        <button onClick={() => { setDeleteId(k.id); setActionMenu(null) }}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12.5px] text-[var(--red)] hover:bg-[var(--red-bg)] transition-colors">
                          <Trash2 size={13} /> Revoke key
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Usage note ── */}
      <div className="flex items-start gap-2.5 px-4 py-3 bg-[var(--blue-bg)] border border-[var(--blue)]/20 rounded-xl">
        <Shield size={13} className="text-[var(--blue)] flex-shrink-0 mt-0.5" />
        <p className="text-[12px] text-[var(--fg-secondary)]">
          Keys are scoped per project and environment. Use <span className="font-mono font-semibold text-[var(--fg)]">X-TokenFin-Key</span> header when calling the ingest API. Never expose keys in client-side code.
        </p>
      </div>

      {showCreate && (
        <CreateKeyModal
          projects={projects}
          orgId={orgId}
          userId={userId}
          onClose={() => setShowCreate(false)}
          onCreate={(key) => { handleCreate(key); setShowCreate(false) }}
        />
      )}
      {deleteId && deleteKey && (
        <DeleteConfirm
          keyName={deleteKey.name}
          onConfirm={() => handleDelete(deleteId)}
          onClose={() => setDeleteId(null)}
        />
      )}
      {deleting && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-3 bg-[var(--fg)] text-[var(--bg)] rounded-2xl shadow-2xl text-[13px] font-semibold z-50">
          <span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--bg)]/30 border-t-[var(--bg)] animate-spin" /> Revoking key…
        </div>
      )}
    </div>
  )
}
