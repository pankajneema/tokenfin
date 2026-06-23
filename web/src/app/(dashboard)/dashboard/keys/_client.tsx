'use client'
import { useState } from 'react'
import {
  Plus, Copy, Check, Trash2, Key, MoreHorizontal,
  Search, Shield,
  AlertTriangle, X, ChevronDown, Zap, Clock,
  BarChart3, Activity, ToggleLeft, ToggleRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ApiKeyRow, ProjectOption, TeamOption, MemberOption } from './page'

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

/* ── Status badge ── */
function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--green-bg)] text-teal border border-teal/20 flex-shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-teal" />
      Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--red-bg)] text-[var(--red)] border border-[var(--red)]/20 flex-shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />
      Inactive
    </span>
  )
}

/* ══════════════════════════════════════════════════════════════
   CREATE KEY MODAL
══════════════════════════════════════════════════════════════ */
function CreateKeyModal({
  projects, teams, members, orgId, userId, onClose, onCreate,
}: {
  projects: ProjectOption[]
  teams:    TeamOption[]
  members:  MemberOption[]
  orgId:    string
  userId:   string
  onClose:  () => void
  onCreate: (key: ApiKeyRow, rawKey: string) => void
}) {
  const [step,         setStep]         = useState<'form' | 'reveal'>('form')
  const [name,         setName]         = useState('')
  const [env,          setEnv]          = useState<Env>('production')
  const [project,      setProject]      = useState(projects[0]?.id ?? '')
  const [assignType,   setAssignType]   = useState<'member' | 'team'>('member')
  const [assignedTeam, setAssignedTeam] = useState<string>('')
  const [assignedTo,   setAssignedTo]   = useState<string>('')
  const [scopes,       setScopes]       = useState<Scope[]>(['read', 'write'])
  const [expiry,       setExpiry]       = useState<'none' | '30d' | '90d' | '1y'>('none')
  const [loading,      setLoading]      = useState(false)
  const [rawKey,       setRawKey]       = useState('')
  const [copied,       setCopied]       = useState(false)
  const [error,        setError]        = useState<string | null>(null)

  // Members visible in the dropdown — filtered by team when assignType = 'team'
  const visibleMembers = assignType === 'team' && assignedTeam
    ? members.filter(m => m.teamId === assignedTeam)
    : members

  // Reset member when switching type or team
  function switchAssignType(t: 'member' | 'team') {
    setAssignType(t)
    setAssignedTeam('')
    setAssignedTo('')
  }

  function handleTeamChange(tid: string) {
    setAssignedTeam(tid)
    setAssignedTo('')  // reset member whenever team changes
  }

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

  // Disable Create if required fields are missing
  const canCreate = name.trim() && project && assignedTo &&
    (assignType === 'member' || (assignType === 'team' && assignedTeam))

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
          user_id:    assignedTo,
          team_id:    assignType === 'team' ? (assignedTeam || null) : null,
          env,
          scopes,
          expires_at: expiresAt(),
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error ?? 'Failed to create key')
      }
      const data = await res.json()
      setRawKey(data.raw_key)
      const assignedMember = members.find(m => m.id === assignedTo)
      const assignedTeamObj = teams.find(t => t.id === assignedTeam)
      const newKey: ApiKeyRow = {
        id:               data.id,
        name:             data.name,
        keyPrefix:        data.key_prefix,
        env:              data.env ?? env,
        scopes:           data.scopes ?? scopes,
        projectId:        data.project_id,
        projectName:      projects.find(p => p.id === data.project_id)?.name ?? '—',
        expiresAt:        data.expires_at ?? null,
        isActive:         true,
        lastUsedAt:       null,
        createdAt:        data.created_at,
        createdByName:    'You',
        assignedToId:     assignedTo || null,
        assignedToName:   assignedMember?.name ?? null,
        assignedTeamId:   assignedTeam || null,
        assignedTeamName: assignedTeamObj?.name ?? null,
        requests30d:      0,
        cost30d:          0,
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
                  <p className="text-[11.5px] text-[var(--fg-secondary)]">Key can be copied anytime from the Keys list</p>
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

              {/* ── Assignment section ── */}
              <div>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">
                  Assign to <span className="text-[var(--red)]">*</span>
                </label>

                {/* Toggle: Member / Team */}
                <div className="flex gap-1.5 mb-3 bg-[var(--bg-secondary)] p-1 rounded-xl w-fit">
                  {(['member', 'team'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => switchAssignType(t)}
                      className={cn(
                        'px-4 py-1.5 rounded-lg text-[12px] font-semibold transition-all capitalize',
                        assignType === t
                          ? 'bg-[var(--fg)] text-[var(--bg)] shadow-sm'
                          : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]'
                      )}>
                      {t === 'member' ? 'Member' : 'Team'}
                    </button>
                  ))}
                </div>

                {members.length === 0 ? (
                  <p className="text-[12px] text-[var(--amber)] bg-[var(--amber-bg)] border border-[var(--amber)]/20 px-3 py-2 rounded-lg">
                    No team members found. Invite members first before creating keys.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {/* Team dropdown (only in team mode) */}
                    {assignType === 'team' && (
                      <div>
                        <label className="text-[10.5px] font-medium text-[var(--fg-tertiary)] block mb-1">Team</label>
                        {teams.length === 0 ? (
                          <p className="text-[12px] text-[var(--amber)] bg-[var(--amber-bg)] border border-[var(--amber)]/20 px-3 py-2 rounded-lg">
                            No teams found. <a href="/dashboard/teams" className="underline font-medium">Create a team →</a>
                          </p>
                        ) : (
                          <div className="relative">
                            <select value={assignedTeam} onChange={e => handleTeamChange(e.target.value)}
                              className="input appearance-none cursor-pointer">
                              <option value="">— Select a team —</option>
                              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                            <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)] pointer-events-none" />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Member dropdown */}
                    {(assignType === 'member' || assignedTeam) && (
                      <div>
                        <label className="text-[10.5px] font-medium text-[var(--fg-tertiary)] block mb-1">Member</label>
                        {assignType === 'team' && assignedTeam && visibleMembers.length === 0 ? (
                          <p className="text-[12px] text-[var(--amber)] bg-[var(--amber-bg)] border border-[var(--amber)]/20 px-3 py-2 rounded-lg">
                            No members assigned to this team yet.
                          </p>
                        ) : (
                          <div className="relative">
                            <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
                              className="input appearance-none cursor-pointer">
                              <option value="">— Select a member —</option>
                              {visibleMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                            <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)] pointer-events-none" />
                          </div>
                        )}
                      </div>
                    )}

                    <p className="text-[11px] text-[var(--fg-tertiary)]">
                      {assignType === 'team'
                        ? 'Team + member tracked separately · 1 active key per member per project'
                        : 'Each member can have 1 active key per project · usage attributed in analytics'}
                    </p>
                  </div>
                )}
              </div>

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
              <button onClick={handleCreate} disabled={!canCreate || loading}
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
            <h3 className="text-[16px] font-bold text-[var(--fg)] mb-1">Key created</h3>
            <p className="text-[12.5px] text-[var(--fg-secondary)] mb-5">Copy your key below. You can also copy it anytime from the Keys list.</p>

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
  teams:       TeamOption[]
  members:     MemberOption[]
  orgId:       string
  userId:      string
}

export function KeysClient({ initialKeys, projects, teams, members, orgId, userId }: Props) {
  const [keys,       setKeys]       = useState<ApiKeyRow[]>(initialKeys)
  const [filter,     setFilter]     = useState<'all' | 'active' | 'inactive'>('all')
  const [search,     setSearch]     = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [deleteId,   setDeleteId]   = useState<string | null>(null)
  const [actionMenu, setActionMenu] = useState<string | null>(null)
  // revealId removed — key prefix is always shown; full key only visible at creation
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
  const totalReq    = keys.reduce((s, k) => s + k.requests30d, 0)
  const totalCost   = keys.reduce((s, k) => s + k.cost30d, 0)
  const maxReq      = Math.max(...keys.map(k => k.requests30d), 1)

  function handleCreate(key: ApiKeyRow) {
    setKeys(prev => [key, ...prev])
  }

  async function toggleStatus(id: string) {
    const key = keys.find(k => k.id === id)
    if (!key) return
    setToggling(id)
    setActionMenu(null)
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
    <div className="space-y-5">

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
          { label: 'Total keys',    value: String(keys.length),        icon: Key,       color: 'text-coral'           },
          { label: 'Active',        value: String(totalActive),        icon: Activity,  color: 'text-teal'            },
          { label: 'Requests 30d',  value: totalReq.toLocaleString(),  icon: BarChart3, color: 'text-[var(--blue)]'   },
          { label: 'Cost 30d',      value: `$${totalCost.toFixed(2)}`, icon: Zap,       color: 'text-[var(--amber)]'  },
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
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl">
        <div className="grid grid-cols-[2.2fr_1.2fr_1.1fr_1fr_1fr_1fr_90px] gap-2 px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]/50 rounded-t-2xl">
          {['Key / Status', 'API Key', 'Project', 'Permissions', 'Requests 30d', 'Last used', ''].map(h => (
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
            const expWarn = isExpiringSoon(k.expiresAt)
            const isBusy  = toggling === k.id

            return (
              <div key={k.id}
                className={cn(
                  'grid grid-cols-[2.2fr_1.2fr_1.1fr_1fr_1fr_1fr_90px] gap-2 items-center px-5 py-4 transition-colors hover:bg-[var(--bg-hover)] group',
                  !k.isActive && 'bg-[var(--bg-secondary)]/40'
                )}>

                {/* Name + env + status badge */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={cn(
                      'text-[13px] font-semibold truncate',
                      k.isActive ? 'text-[var(--fg)]' : 'text-[var(--fg-tertiary)]'
                    )}>
                      {k.name}
                    </p>
                    <span className={cn('px-1.5 py-0.5 rounded-md text-[9.5px] font-bold uppercase tracking-wide flex-shrink-0', em.bg, em.text)}>
                      {em.label}
                    </span>
                    <StatusBadge active={k.isActive} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <Clock size={10} className="text-[var(--fg-tertiary)]" />
                    <span className="text-[10.5px] text-[var(--fg-tertiary)]">
                      Created {new Date(k.createdAt).toLocaleDateString()} by {k.createdByName}
                    </span>
                    {k.assignedTeamName && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-[var(--green-bg)] text-teal">
                        ⊞ {k.assignedTeamName}
                      </span>
                    )}
                    {k.assignedToName && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-[var(--blue-bg)] text-[var(--blue)]">
                        → {k.assignedToName}
                      </span>
                    )}
                    {expWarn && k.expiresAt && (
                      <span className="flex items-center gap-0.5 text-[10px] font-semibold text-[var(--amber)]">
                        <AlertTriangle size={9} /> Expires {new Date(k.expiresAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>

                {/* API Key */}
                <div>
                  <div className="flex items-center gap-1.5">
                    <code className="text-[11px] font-mono text-[var(--fg-secondary)] bg-[var(--bg-secondary)] px-2 py-0.5 rounded-lg truncate max-w-[200px]">
                      {k.keyPrefix}
                    </code>
                    <button
                      onClick={() => copyPrefix(k.keyPrefix, k.id)}
                      className="text-[var(--fg-tertiary)] hover:text-coral transition-colors flex-shrink-0"
                      title="Copy API key">
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
                <div><ReqBar n={k.requests30d} maxN={maxReq} color={em.dot} /></div>

                {/* Last used */}
                <div className="text-[11.5px] text-[var(--fg-tertiary)]">{reltime(k.lastUsedAt)}</div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-1.5 relative">
                  {/* Toggle switch */}
                  <button
                    onClick={() => toggleStatus(k.id)}
                    disabled={isBusy}
                    title={k.isActive ? 'Click to deactivate' : 'Click to activate'}
                    className={cn(
                      'w-9 h-5 rounded-full relative transition-all flex-shrink-0 border',
                      k.isActive
                        ? 'bg-teal border-teal/40'
                        : 'bg-[var(--bg-tertiary)] border-[var(--border-strong)]',
                      isBusy && 'opacity-50 cursor-wait'
                    )}>
                    <span className={cn(
                      'absolute top-[3px] left-[3px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform duration-200',
                      k.isActive ? 'translate-x-[16px]' : 'translate-x-0'
                    )} />
                  </button>

                  {/* More menu */}
                  <button onClick={() => setActionMenu(actionMenu === k.id ? null : k.id)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--fg)] transition-colors">
                    <MoreHorizontal size={14} />
                  </button>

                  {actionMenu === k.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setActionMenu(null)} />
                      <div className="absolute right-0 top-full mt-1 z-50 w-48 bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-xl py-1.5">

                        {/* Status toggle */}
                        <button
                          onClick={() => toggleStatus(k.id)}
                          disabled={isBusy}
                          className={cn(
                            'w-full flex items-center gap-2.5 px-3.5 py-2 text-[12.5px] font-medium transition-colors',
                            k.isActive
                              ? 'text-[var(--amber)] hover:bg-[var(--amber-bg)]'
                              : 'text-teal hover:bg-[var(--green-bg)]'
                          )}>
                          {k.isActive
                            ? <><ToggleLeft  size={14} /> Deactivate key</>
                            : <><ToggleRight size={14} /> Activate key</>}
                        </button>

                        <button
                          onClick={() => { copyPrefix(k.keyPrefix, k.id); setActionMenu(null) }}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12.5px] font-medium text-[var(--fg)] hover:bg-[var(--bg-hover)] transition-colors">
                          <Copy size={13} /> Copy key
                        </button>

                        <div className="border-t border-[var(--border)] my-1" />

                        <button
                          onClick={() => { setDeleteId(k.id); setActionMenu(null) }}
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
          teams={teams}
          members={members}
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
