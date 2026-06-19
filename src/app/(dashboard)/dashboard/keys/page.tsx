'use client'
import { useState, useRef } from 'react'
import {
  Plus, Copy, Check, Trash2, Key, MoreHorizontal,
  Eye, EyeOff, RotateCcw, Search, Shield,
  AlertTriangle, X, ChevronDown, Zap, Clock,
  BarChart3, Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ══════════════════════════════════════════════════════════════
   TYPES & DEMO DATA
══════════════════════════════════════════════════════════════ */
type Env    = 'production' | 'staging' | 'development'
type Scope  = 'read' | 'write' | 'admin'
type Status = 'active' | 'inactive' | 'revoked'

interface ApiKey {
  id: string; name: string; prefix: string; env: Env
  project: string; projectId: string; scopes: Scope[]
  status: Status; requests30d: number; costUsd30d: number
  createdAt: string; lastUsedAt: string | null; createdBy: string
  expiresAt: string | null
}

const now = Date.now()
const DEMO_KEYS: ApiKey[] = [
  { id: 'k1', name: 'Production Backend',  prefix: 'tfk_prod_4Xk9', env: 'production',  project: 'Backend API',    projectId: 'p1', scopes: ['read','write'],       status: 'active',   requests30d: 5_840, costUsd30d: 420.30, createdAt: '2026-01-14', lastUsedAt: new Date(now - 120_000).toISOString(),    createdBy: 'Alex Chen',    expiresAt: '2027-01-14' },
  { id: 'k2', name: 'ML Pipeline Worker',  prefix: 'tfk_prod_9Bm3', env: 'production',  project: 'ML Pipeline',    projectId: 'p2', scopes: ['read','write'],       status: 'active',   requests30d: 3_210, costUsd30d: 284.10, createdAt: '2026-02-01', lastUsedAt: new Date(now - 3_600_000).toISOString(),  createdBy: 'Priya Patel',  expiresAt: null },
  { id: 'k3', name: 'Staging Integration', prefix: 'tfk_stg_7Lp1',  env: 'staging',     project: 'Backend API',    projectId: 'p1', scopes: ['read'],               status: 'active',   requests30d: 940,   costUsd30d: 62.40,  createdAt: '2026-03-10', lastUsedAt: new Date(now - 86_400_000).toISOString(), createdBy: 'Sam Rivera',   expiresAt: '2026-09-10' },
  { id: 'k4', name: 'Bot Dev Key',         prefix: 'tfk_dev_2Rv8',  env: 'development', project: 'Customer Bot',   projectId: 'p3', scopes: ['read','write','admin'], status: 'active', requests30d: 480,   costUsd30d: 28.80,  createdAt: '2026-04-05', lastUsedAt: new Date(now - 7_200_000).toISOString(),  createdBy: 'Morgan Lee',   expiresAt: null },
  { id: 'k5', name: 'Old Analytics Key',   prefix: 'tfk_prod_1Kx5', env: 'production',  project: 'Backend API',    projectId: 'p1', scopes: ['read'],               status: 'inactive', requests30d: 0,     costUsd30d: 0,      createdAt: '2025-10-01', lastUsedAt: '2026-01-03T10:22:00Z',                    createdBy: 'Alex Chen',    expiresAt: null },
  { id: 'k6', name: 'Playground Dev',      prefix: 'tfk_dev_6Hq2',  env: 'development', project: 'Dev Playground', projectId: 'p4', scopes: ['read','write'],       status: 'active',   requests30d: 120,   costUsd30d: 8.40,   createdAt: '2026-05-20', lastUsedAt: new Date(now - 1_800_000).toISOString(),  createdBy: 'Casey Wong',   expiresAt: null },
]

const PROJECTS = [
  { id: 'p1', name: 'Backend API'    },
  { id: 'p2', name: 'ML Pipeline'    },
  { id: 'p3', name: 'Customer Bot'   },
  { id: 'p4', name: 'Dev Playground' },
]

/* ── Helpers ── */
const ENV_META: Record<Env, { label: string; dot: string; bg: string; text: string }> = {
  production:  { label: 'Prod',  dot: '#E8533A', bg: 'bg-[var(--red-bg)]',   text: 'text-[var(--red)]'   },
  staging:     { label: 'Stage', dot: '#F59E0B', bg: 'bg-[var(--amber-bg)]', text: 'text-[var(--amber)]' },
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

/* ── Mini request bar ── */
const MAX_REQ = Math.max(...DEMO_KEYS.map(k => k.requests30d), 1)
function ReqBar({ n, color }: { n: number; color: string }) {
  const pct = (n / MAX_REQ) * 100
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
function CreateKeyModal({ onClose, onCreate }: {
  onClose: () => void
  onCreate: (key: ApiKey) => void
}) {
  const [step,     setStep]     = useState<'form' | 'reveal'>('form')
  const [name,     setName]     = useState('')
  const [env,      setEnv]      = useState<Env>('production')
  const [project,  setProject]  = useState('p1')
  const [scopes,   setScopes]   = useState<Scope[]>(['read','write'])
  const [expiry,   setExpiry]   = useState<'none' | '30d' | '90d' | '1y'>('none')
  const [loading,  setLoading]  = useState(false)
  const [rawKey,   setRawKey]   = useState('')
  const [copied,   setCopied]   = useState(false)

  function toggleScope(s: Scope) {
    setScopes(prev => {
      if (prev.includes(s)) { return prev.length > 1 ? prev.filter(x => x !== s) : prev }
      return [...prev, s]
    })
  }

  async function handleCreate() {
    setLoading(true)
    await new Promise(r => setTimeout(r, 900))
    const prefix = `tfk_${env.slice(0,4)}_${Math.random().toString(36).slice(2,6)}`
    const generated = `${prefix}${'x'.repeat(32)}`
    setRawKey(generated)
    const newKey: ApiKey = {
      id: `k${Date.now()}`, name, prefix, env,
      project: PROJECTS.find(p => p.id === project)?.name ?? project,
      projectId: project, scopes: [...scopes],
      status: 'active', requests30d: 0, costUsd30d: 0,
      createdAt: new Date().toISOString().split('T')[0],
      lastUsedAt: null, createdBy: 'You',
      expiresAt: expiry === 'none' ? null
        : new Date(Date.now() + (expiry === '30d' ? 30 : expiry === '90d' ? 90 : 365) * 86400_000).toISOString().split('T')[0],
    }
    onCreate(newKey)
    setLoading(false)
    setStep('reveal')
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
            {/* Header */}
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
                <X size={15}/>
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Name */}
              <div>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">Key name</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Production Backend v2"
                  className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral hover:border-[var(--border-strong)] transition-all"
                />
              </div>

              {/* Environment */}
              <div>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">Environment</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['production','staging','development'] as Env[]).map(e => {
                    const m = ENV_META[e]
                    return (
                      <button
                        key={e}
                        onClick={() => setEnv(e)}
                        className={cn(
                          'flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[12.5px] font-semibold transition-all',
                          env === e ? `border-coral bg-[#FDECEA] dark:bg-coral/10 text-coral` : 'border-[var(--border)] text-[var(--fg-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--fg)]',
                        )}
                      >
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: m.dot }} />
                        {m.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Project */}
              <div>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">Project</label>
                <div className="relative">
                  <select
                    value={project}
                    onChange={e => setProject(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:border-coral appearance-none hover:border-[var(--border-strong)] transition-all"
                  >
                    {PROJECTS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)] pointer-events-none"/>
                </div>
              </div>

              {/* Scopes */}
              <div>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">Permissions</label>
                <div className="flex gap-2">
                  {(['read','write','admin'] as Scope[]).map(s => {
                    const m   = SCOPE_META[s]
                    const on  = scopes.includes(s)
                    return (
                      <button
                        key={s}
                        onClick={() => toggleScope(s)}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[12px] font-semibold transition-all',
                          on ? `border-transparent ${m.color}` : 'border-[var(--border)] text-[var(--fg-tertiary)] hover:border-[var(--border-strong)]',
                        )}
                      >
                        {on && <Check size={10}/>}
                        {m.label}
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
                  {([['none','No expiry'],['30d','30 days'],['90d','90 days'],['1y','1 year']] as const).map(([v, l]) => (
                    <button
                      key={v}
                      onClick={() => setExpiry(v)}
                      className={cn(
                        'py-2 rounded-xl border text-[12px] font-semibold transition-all',
                        expiry === v ? 'border-coral bg-[#FDECEA] dark:bg-coral/10 text-coral' : 'border-[var(--border)] text-[var(--fg-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--fg)]',
                      )}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-[var(--border)] flex gap-2">
              <button onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
              <button
                onClick={handleCreate}
                disabled={!name.trim() || loading}
                className="btn-primary flex-1 justify-center disabled:opacity-40"
              >
                {loading
                  ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin"/>Generating…</>
                  : <><Key size={13}/>Create key</>
                }
              </button>
            </div>
          </>
        ) : (
          /* ── Reveal step ── */
          <div className="px-6 py-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[var(--green-bg)] flex items-center justify-center mx-auto mb-4">
              <Shield size={24} className="text-teal"/>
            </div>
            <h3 className="text-[16px] font-bold text-[var(--fg)] mb-1">Key created — copy now</h3>
            <p className="text-[12.5px] text-[var(--fg-secondary)] mb-5">This is the only time your full key is shown. Store it securely.</p>

            <div className="bg-[var(--bg-secondary)] rounded-xl p-3 mb-4 text-left">
              <p className="text-[10px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider mb-2">Your API key</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[11.5px] font-mono text-[var(--fg)] break-all leading-relaxed">{rawKey}</code>
                <button
                  onClick={copyKey}
                  className={cn('flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold flex-shrink-0 transition-all',
                    copied ? 'bg-[var(--green-bg)] text-teal' : 'bg-[var(--bg)] border border-[var(--border)] text-[var(--fg-secondary)] hover:border-[var(--border-strong)]'
                  )}
                >
                  {copied ? <><Check size={12}/>Copied!</> : <><Copy size={12}/>Copy</>}
                </button>
              </div>
            </div>

            <div className="bg-[var(--amber-bg)] rounded-xl p-3 mb-5 flex items-start gap-2 text-left">
              <AlertTriangle size={13} className="text-[var(--amber)] flex-shrink-0 mt-0.5"/>
              <p className="text-[11.5px] text-[var(--fg-secondary)]">Never commit keys to version control. Use environment variables or a secrets manager.</p>
            </div>

            <button onClick={onClose} className="btn-primary w-full justify-center">
              <Check size={13}/> Done, I've saved my key
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
function DeleteConfirm({ keyName, onConfirm, onClose }: {
  keyName: string; onConfirm: () => void; onClose: () => void
}) {
  const [text, setText] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose}/>
      <div className="relative bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-[400px] p-6">
        <div className="w-10 h-10 rounded-2xl bg-[var(--red-bg)] flex items-center justify-center mb-4">
          <Trash2 size={18} className="text-[var(--red)]"/>
        </div>
        <h3 className="text-[15px] font-bold text-[var(--fg)] mb-1">Revoke API key</h3>
        <p className="text-[12.5px] text-[var(--fg-secondary)] mb-4">
          Any services using <span className="font-semibold text-[var(--fg)]">{keyName}</span> will immediately lose access. This cannot be undone.
        </p>
        <div className="mb-4">
          <p className="text-[11.5px] text-[var(--fg-secondary)] mb-1.5">Type <span className="font-mono font-bold text-[var(--fg)]">revoke</span> to confirm</p>
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="revoke"
            className="w-full px-3 py-2 rounded-xl border border-[var(--border)] text-[13px] bg-[var(--bg)] focus:outline-none focus:border-[var(--red)] transition-colors"
          />
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={text !== 'revoke'}
            className="flex-1 justify-center flex items-center gap-1.5 py-2 rounded-xl bg-[var(--red)] text-white text-[13px] font-semibold disabled:opacity-40"
          >
            <Trash2 size={13}/> Revoke key
          </button>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════ */
export default function KeysPage() {
  const [keys,       setKeys]       = useState(DEMO_KEYS)
  const [filter,     setFilter]     = useState<'all'|'active'|'inactive'>('all')
  const [search,     setSearch]     = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [deleteId,   setDeleteId]   = useState<string|null>(null)
  const [actionMenu, setActionMenu] = useState<string|null>(null)
  const [revealId,   setRevealId]   = useState<string|null>(null)
  const [copiedId,   setCopiedId]   = useState<string|null>(null)

  /* ── Derived ── */
  const filtered = keys.filter(k => {
    if (filter === 'active'   && k.status !== 'active')   return false
    if (filter === 'inactive' && k.status !== 'inactive') return false
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!k.name.toLowerCase().includes(q) && !k.project.toLowerCase().includes(q) && !k.prefix.toLowerCase().includes(q)) return false
    }
    return true
  })

  const totalActive   = keys.filter(k => k.status === 'active').length
  const totalReqs     = keys.reduce((s, k) => s + k.requests30d, 0)
  const totalCost     = keys.reduce((s, k) => s + k.costUsd30d, 0)

  function handleCreate(key: ApiKey) {
    setKeys(prev => [key, ...prev])
  }

  function toggleStatus(id: string) {
    setKeys(prev => prev.map(k => k.id === id ? { ...k, status: k.status === 'active' ? 'inactive' : 'active' } : k))
  }

  function handleDelete(id: string) {
    setKeys(prev => prev.filter(k => k.id !== id))
    setDeleteId(null)
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
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus size={14}/> Create key
        </button>
      </div>

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total keys',  value: String(keys.length), icon: Key,       color: 'text-coral'        },
          { label: 'Active',      value: String(totalActive), icon: Activity,  color: 'text-teal'         },
          { label: 'Requests 30d', value: totalReqs.toLocaleString(), icon: BarChart3, color: 'text-[var(--blue)]' },
          { label: 'Cost 30d',    value: `$${totalCost.toFixed(2)}`, icon: Zap, color: 'text-[var(--amber)]' },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[var(--bg-secondary)] flex items-center justify-center flex-shrink-0">
              <s.icon size={14} className={s.color}/>
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
          {([['all','All'], ['active','Active'], ['inactive','Inactive']] as const).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setFilter(v)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition-all',
                filter === v ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]',
              )}
            >
              {l}
              <span className={cn(
                'ml-1.5 text-[10px] px-1.5 py-0.5 rounded-md font-semibold',
                filter === v ? 'bg-white/20 text-[var(--bg)]' : 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]',
              )}>
                {v === 'all' ? keys.length : v === 'active' ? keys.filter(k => k.status === 'active').length : keys.filter(k => k.status !== 'active').length}
              </span>
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-[280px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]"/>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search keys, projects…"
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-[var(--border)] text-[12.5px] bg-[var(--bg)] text-[var(--fg)] focus:outline-none focus:border-coral focus:ring-2 focus:ring-coral/20 transition-all"
          />
        </div>
      </div>

      {/* ── Keys table ── */}
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">

        {/* Column headers */}
        <div className="grid grid-cols-[2.5fr_1.2fr_1.2fr_1fr_1fr_1fr_80px] gap-2 px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]/50">
          {['Key','Prefix','Project','Permissions','Requests 30d','Last used',''].map(h => (
            <div key={h} className="text-[10px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider">{h}</div>
          ))}
        </div>

        {/* Rows */}
        <div className="divide-y divide-[var(--border)]">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[var(--bg-secondary)] flex items-center justify-center">
                <Key size={22} className="text-[var(--fg-tertiary)]"/>
              </div>
              <p className="text-[13px] text-[var(--fg-secondary)]">
                {search ? `No keys matching "${search}"` : 'No API keys yet'}
              </p>
              {!search && (
                <button onClick={() => setShowCreate(true)} className="btn-primary text-[12.5px]">
                  <Plus size={12}/> Create your first key
                </button>
              )}
            </div>
          ) : filtered.map(k => {
            const em      = ENV_META[k.env]
            const isRev   = revealId === k.id
            const expWarn = isExpiringSoon(k.expiresAt)

            return (
              <div
                key={k.id}
                className={cn(
                  'grid grid-cols-[2.5fr_1.2fr_1.2fr_1fr_1fr_1fr_80px] gap-2 items-center px-5 py-4 transition-colors hover:bg-[var(--bg-hover)] group',
                  k.status !== 'active' && 'opacity-60'
                )}
              >
                {/* Name + env + expiry */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[13px] font-semibold text-[var(--fg)] truncate">{k.name}</p>
                    <span className={cn('px-1.5 py-0.5 rounded-md text-[9.5px] font-bold uppercase tracking-wide flex-shrink-0', em.bg, em.text)}>
                      {em.label}
                    </span>
                    {k.status === 'inactive' && (
                      <span className="px-1.5 py-0.5 rounded-md text-[9.5px] font-bold bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]">Inactive</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Clock size={10} className="text-[var(--fg-tertiary)]"/>
                    <span className="text-[10.5px] text-[var(--fg-tertiary)]">
                      Created {k.createdAt} by {k.createdBy}
                    </span>
                    {expWarn && k.expiresAt && (
                      <span className="flex items-center gap-0.5 text-[10px] font-semibold text-[var(--amber)]">
                        <AlertTriangle size={9}/> Expires {k.expiresAt}
                      </span>
                    )}
                  </div>
                </div>

                {/* Prefix */}
                <div>
                  <div className="flex items-center gap-1.5">
                    <code className="text-[11.5px] font-mono text-[var(--fg-secondary)] bg-[var(--bg-secondary)] px-2 py-0.5 rounded-lg">
                      {isRev ? k.prefix : `${k.prefix.slice(0,8)}••••`}
                    </code>
                    <button
                      onClick={() => setRevealId(isRev ? null : k.id)}
                      className="text-[var(--fg-tertiary)] hover:text-[var(--fg)] transition-colors"
                    >
                      {isRev ? <EyeOff size={12}/> : <Eye size={12}/>}
                    </button>
                    <button
                      onClick={() => copyPrefix(k.prefix, k.id)}
                      className="text-[var(--fg-tertiary)] hover:text-coral transition-colors"
                    >
                      {copiedId === k.id ? <Check size={12} className="text-teal"/> : <Copy size={12}/>}
                    </button>
                  </div>
                </div>

                {/* Project */}
                <div>
                  <span className="text-[12px] text-[var(--fg-secondary)] bg-[var(--bg-secondary)] px-2 py-0.5 rounded-lg">{k.project}</span>
                </div>

                {/* Scopes */}
                <div className="flex flex-wrap gap-1">
                  {k.scopes.map(s => (
                    <span key={s} className={cn('text-[9.5px] font-bold px-1.5 py-0.5 rounded-full', SCOPE_META[s].color)}>
                      {SCOPE_META[s].label}
                    </span>
                  ))}
                </div>

                {/* Requests */}
                <div><ReqBar n={k.requests30d} color={em.dot}/></div>

                {/* Last used */}
                <div className="text-[11.5px] text-[var(--fg-tertiary)]">{reltime(k.lastUsedAt)}</div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-1 relative">
                  {/* Status toggle */}
                  <button
                    onClick={() => toggleStatus(k.id)}
                    className={cn(
                      'w-8 h-4 rounded-full relative transition-colors flex-shrink-0 overflow-hidden',
                      k.status === 'active' ? 'bg-teal' : 'bg-[var(--bg-tertiary)]'
                    )}
                    title={k.status === 'active' ? 'Deactivate' : 'Activate'}
                  >
                    <span className={cn(
                      'absolute top-[2px] left-[2px] w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200',
                      k.status === 'active' ? 'translate-x-[14px]' : 'translate-x-0'
                    )}/>
                  </button>

                  {/* More menu */}
                  <button
                    onClick={() => setActionMenu(actionMenu === k.id ? null : k.id)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--fg)] transition-colors"
                  >
                    <MoreHorizontal size={14}/>
                  </button>

                  {actionMenu === k.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setActionMenu(null)}/>
                      <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-xl py-1.5 overflow-hidden">
                        <button
                          onClick={() => { copyPrefix(k.prefix, k.id); setActionMenu(null) }}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12.5px] font-medium text-[var(--fg)] hover:bg-[var(--bg-hover)] transition-colors"
                        >
                          <Copy size={13}/> Copy prefix
                        </button>
                        <button
                          onClick={() => setActionMenu(null)}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12.5px] font-medium text-[var(--fg)] hover:bg-[var(--bg-hover)] transition-colors"
                        >
                          <RotateCcw size={13}/> Rotate key
                        </button>
                        <div className="border-t border-[var(--border)] my-1"/>
                        <button
                          onClick={() => { setDeleteId(k.id); setActionMenu(null) }}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12.5px] text-[var(--red)] hover:bg-[var(--red-bg)] transition-colors"
                        >
                          <Trash2 size={13}/> Revoke key
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
        <Shield size={13} className="text-[var(--blue)] flex-shrink-0 mt-0.5"/>
        <p className="text-[12px] text-[var(--fg-secondary)]">
          Keys are scoped per project and environment. Use <span className="font-mono font-semibold text-[var(--fg)]">X-TokenFin-Key</span> header when calling the ingest API. Never expose keys in client-side code.
        </p>
      </div>

      {showCreate && <CreateKeyModal onClose={() => setShowCreate(false)} onCreate={handleCreate}/>}
      {deleteId && deleteKey && (
        <DeleteConfirm keyName={deleteKey.name} onConfirm={() => handleDelete(deleteId)} onClose={() => setDeleteId(null)}/>
      )}
    </div>
  )
}
