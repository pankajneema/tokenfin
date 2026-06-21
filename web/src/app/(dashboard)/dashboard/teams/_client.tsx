'use client'
import { useState, useMemo, useCallback } from 'react'
import {
  Users, Plus, Search, MoreHorizontal, X,
  UserCog, Trash2, ChevronDown, ChevronRight,
  DollarSign, Pencil, UserPlus, ShieldCheck,
  Code2, Eye, Crown, AlertTriangle,
} from 'lucide-react'
import { cn, formatCost } from '@/lib/utils'
import type { TeamRow, MemberRow, ProjectRow } from './page'

/* ── Role config ────────────────────────────────────────────── */
const ROLES = {
  owner:     { label: 'Owner',     icon: Crown,       color: 'text-[var(--amber)]'        },
  admin:     { label: 'Admin',     icon: ShieldCheck, color: 'text-[var(--blue)]'         },
  developer: { label: 'Developer', icon: Code2,        color: 'text-[var(--fg-secondary)]' },
  viewer:    { label: 'Viewer',    icon: Eye,          color: 'text-[var(--fg-tertiary)]'  },
} as const
type Role = keyof typeof ROLES

/* ── Helpers ────────────────────────────────────────────────── */
function avatarInitials(name: string) {
  const parts = name.trim().split(' ')
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
}

const AVATAR_COLORS = [
  '#E8533A','#00C48C','#8B5CF6','#60A5FA','#F59E0B',
  '#EC4899','#14B8A6','#F97316','#6366F1','#84CC16',
]
function avatarColor(str: string) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

function budgetPct(spent: number, budget: number | null) {
  if (!budget) return 0
  return Math.min(100, Math.round((spent / budget) * 100))
}

/* ── Avatar ─────────────────────────────────────────────────── */
function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const bg  = avatarColor(name)
  const cls = size === 'sm' ? 'w-7 h-7 text-[10px]' : size === 'lg' ? 'w-10 h-10 text-[13px]' : 'w-8 h-8 text-[11px]'
  return (
    <div
      className={cn('rounded-full flex items-center justify-center font-bold text-white flex-shrink-0', cls)}
      style={{ background: bg }}
    >
      {avatarInitials(name)}
    </div>
  )
}

/* ── Budget bar ─────────────────────────────────────────────── */
function BudgetBar({ pct, warnAt, throttleAt }: { pct: number; warnAt: number; throttleAt: number }) {
  const color = pct >= throttleAt ? 'bg-[var(--red)]' : pct >= warnAt ? 'bg-[var(--amber)]' : 'bg-[var(--teal)]'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn('text-[11px] font-semibold tabular-nums w-8 text-right',
        pct >= throttleAt ? 'text-[var(--red)]' : pct >= warnAt ? 'text-[var(--amber)]' : 'text-[var(--fg-tertiary)]')}>
        {pct}%
      </span>
    </div>
  )
}

/* ── Create / Edit team modal ───────────────────────────────── */
function TeamModal({
  orgId, projects, initial, onClose, onSave,
}: {
  orgId:    string
  projects: ProjectRow[]
  initial?: TeamRow
  onClose:  () => void
  onSave:   (t: TeamRow) => void
}) {
  const isEdit = !!initial
  const [name,      setName]      = useState(initial?.name      ?? '')
  const [projectId, setProjectId] = useState<string | null>(initial?.projectId ?? null)
  const [budget,    setBudget]    = useState(initial?.budget?.toString() ?? '')
  const [warnAt,    setWarnAt]    = useState(initial?.warnAt    ?? 70)
  const [throttle,  setThrottle]  = useState(initial?.throttleAt ?? 90)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  async function handleSave() {
    setLoading(true); setError(null)
    try {
      let savedTeam: TeamRow

      if (isEdit) {
        const res = await fetch('/api/v1/teams', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: initial!.id, name, project_id: projectId }),
        })
        if (!res.ok) throw new Error(await res.text())
        const data = await res.json()
        savedTeam = { ...initial!, name: data.name, projectId: data.project_id }
      } else {
        const res = await fetch('/api/v1/teams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ org_id: orgId, name, project_id: projectId }),
        })
        if (!res.ok) throw new Error(await res.text())
        const data = await res.json()
        savedTeam = {
          id: data.id, name: data.name, projectId: data.project_id,
          createdAt: data.created_at, budget: null, warnAt: 70, throttleAt: 90, memberCount: 0,
        }
      }

      // Upsert limit if budget is provided
      if (budget && parseFloat(budget) > 0) {
        await fetch('/api/v1/limits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            org_id: orgId, team_id: savedTeam.id,
            scope: 'team', period: 'monthly',
            budget_usd: parseFloat(budget),
            warn_at: warnAt, throttle_at: throttle, block_at: 100,
          }),
        })
        savedTeam = { ...savedTeam, budget: parseFloat(budget), warnAt, throttleAt: throttle }
      }

      onSave(savedTeam)
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save team')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-[440px]">

        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <h2 className="text-[15px] font-bold text-[var(--fg)]">{isEdit ? 'Edit Team' : 'New Team'}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors">
            <X size={15} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">Team Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Backend Team" className="input" autoFocus />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">
              Associated Project <span className="normal-case font-normal text-[var(--fg-tertiary)]">(optional)</span>
            </label>
            <select value={projectId ?? ''} onChange={e => setProjectId(e.target.value || null)} className="input appearance-none cursor-pointer">
              <option value="">No project assigned</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">
              Monthly Budget (USD) <span className="normal-case font-normal text-[var(--fg-tertiary)]">(optional)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)] text-[13px]">$</span>
              <input type="number" min="0" step="10" value={budget} onChange={e => setBudget(e.target.value)} placeholder="0" className="input pl-6" />
            </div>
          </div>

          {budget && parseFloat(budget) > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">Warn at %</label>
                <input type="number" min="1" max="99" value={warnAt} onChange={e => setWarnAt(Number(e.target.value))} className="input" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">Throttle at %</label>
                <input type="number" min="1" max="100" value={throttle} onChange={e => setThrottle(Number(e.target.value))} className="input" />
              </div>
            </div>
          )}

          {error && (
            <p className="text-[12px] text-[var(--red)] bg-[var(--red-bg)] border border-[var(--red)]/20 px-3 py-2 rounded-lg">{error}</p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[var(--border)] flex gap-3 justify-end">
          <button onClick={onClose} className="btn-secondary text-[13px] py-2">Cancel</button>
          <button onClick={handleSave} disabled={!name.trim() || loading} className="btn-primary text-[13px] py-2 min-w-[130px] justify-center">
            {loading
              ? <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              : isEdit ? 'Save changes' : 'Create team'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Assign member to team modal ────────────────────────────── */
function AssignModal({
  teamId, allMembers, teamMemberIds, onClose, onAssign,
}: {
  teamId:        string
  allMembers:    MemberRow[]
  teamMemberIds: Set<string>
  onClose:       () => void
  onAssign:      (memberId: string) => void
}) {
  const [query,   setQuery]   = useState('')
  const [loading, setLoading] = useState<string | null>(null)

  const unassigned = useMemo(() => {
    const q = query.toLowerCase()
    return allMembers.filter(m =>
      !teamMemberIds.has(m.id) &&
      (m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
    )
  }, [allMembers, teamMemberIds, query])

  async function assign(memberId: string) {
    setLoading(memberId)
    try {
      const res = await fetch('/api/v1/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: memberId, team_id: teamId }),
      })
      if (res.ok) onAssign(memberId)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-[400px]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-[14px] font-bold text-[var(--fg)]">Add member to team</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors">
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search members…" className="input pl-8 text-[13px] py-2" autoFocus />
          </div>
          <div className="max-h-[300px] overflow-y-auto space-y-1">
            {unassigned.length === 0 ? (
              <p className="text-[12px] text-[var(--fg-tertiary)] text-center py-6">
                {query ? 'No members match' : 'All org members are already in this team'}
              </p>
            ) : unassigned.map(m => (
              <div key={m.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-[var(--bg-hover)] transition-colors">
                <Avatar name={m.name} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-semibold text-[var(--fg)] truncate">{m.name}</p>
                  <p className="text-[11px] text-[var(--fg-tertiary)] truncate">{m.email}</p>
                </div>
                <button
                  onClick={() => assign(m.id)}
                  disabled={loading === m.id}
                  className="btn-primary text-[11px] py-1 px-3"
                >
                  {loading === m.id
                    ? <span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    : 'Add'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Delete confirm ─────────────────────────────────────────── */
function DeleteConfirm({
  label, onConfirm, onCancel, loading,
}: {
  label:     string
  onConfirm: () => void
  onCancel:  () => void
  loading:   boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-[360px] p-6">
        <div className="w-10 h-10 rounded-xl bg-[var(--red-bg)] flex items-center justify-center mb-4">
          <Trash2 size={18} className="text-[var(--red)]" />
        </div>
        <h3 className="text-[15px] font-bold text-[var(--fg)] mb-1.5">Delete &ldquo;{label}&rdquo;?</h3>
        <p className="text-[13px] text-[var(--fg-secondary)] mb-5 leading-relaxed">
          Members will be unassigned from this team. No users or data will be deleted.
        </p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="btn-secondary flex-1 text-[13px] py-2 justify-center">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2 rounded-xl bg-[var(--red)] text-white text-[13px] font-semibold hover:opacity-90 transition-opacity flex items-center justify-center"
          >
            {loading
              ? <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              : 'Delete team'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Team card ──────────────────────────────────────────────── */
function TeamCard({
  team, members, projects,
  onEdit, onDelete, onMembersChange,
}: {
  team:            TeamRow
  members:         MemberRow[]
  projects:        ProjectRow[]
  onEdit:          (t: TeamRow) => void
  onDelete:        (id: string) => void
  onMembersChange: (updated: MemberRow[]) => void
}) {
  const [expanded,    setExpanded]    = useState(false)
  const [showAssign,  setShowAssign]  = useState(false)
  const [menuOpen,    setMenuOpen]    = useState(false)
  const [removing,    setRemoving]    = useState<string | null>(null)
  const [roleLoading, setRoleLoading] = useState<string | null>(null)

  const teamMembers    = useMemo(() => members.filter(m => m.teamId === team.id), [members, team.id])
  const teamMemberIds  = useMemo(() => new Set(teamMembers.map(m => m.id)), [teamMembers])
  const project        = projects.find(p => p.id === team.projectId)
  const pct            = budgetPct(0, team.budget)

  async function removeFromTeam(memberId: string) {
    setRemoving(memberId)
    try {
      const res = await fetch('/api/v1/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: memberId, team_id: null }),
      })
      if (res.ok) onMembersChange(members.map(m => m.id === memberId ? { ...m, teamId: null } : m))
    } finally {
      setRemoving(null)
    }
  }

  async function changeRole(memberId: string, role: Role) {
    setRoleLoading(memberId)
    try {
      await fetch('/api/v1/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: memberId, role }),
      })
      onMembersChange(members.map(m => m.id === memberId ? { ...m, role } : m))
    } finally {
      setRoleLoading(null)
    }
  }

  function handleAssign(memberId: string) {
    onMembersChange(members.map(m => m.id === memberId ? { ...m, teamId: team.id } : m))
    setShowAssign(false)
  }

  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">

      {/* Header */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#E8533A1A] flex items-center justify-center flex-shrink-0">
              <Users size={17} className="text-[#E8533A]" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <h3 className="text-[14px] font-bold text-[var(--fg)] truncate">{team.name}</h3>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-[11px] text-[var(--fg-tertiary)]">
                  {teamMembers.length} member{teamMembers.length !== 1 ? 's' : ''}
                </span>
                {project && (
                  <>
                    <span className="text-[var(--border-strong)]">·</span>
                    <span className="text-[11px] text-[var(--blue)] font-medium">{project.name}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => setShowAssign(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-semibold text-[#E8533A] border border-[#E8533A]/30 hover:bg-[#E8533A]/5 transition-colors"
            >
              <UserPlus size={12} /> Add
            </button>
            <div className="relative">
              <button
                onClick={() => setMenuOpen(v => !v)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <MoreHorizontal size={14} />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-lg py-1.5 min-w-[140px]">
                    <button
                      onClick={() => { onEdit(team); setMenuOpen(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                    >
                      <Pencil size={12} /> Edit team
                    </button>
                    <div className="my-1 border-t border-[var(--border)]" />
                    <button
                      onClick={() => { onDelete(team.id); setMenuOpen(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-[var(--red)] hover:bg-[var(--red-bg)] transition-colors"
                    >
                      <Trash2 size={12} /> Delete team
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Budget bar */}
        {team.budget && (
          <div className="mt-4 space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[var(--fg-tertiary)]">Monthly budget</span>
              <span className="font-semibold text-[var(--fg)]">{formatCost(team.budget)}</span>
            </div>
            <BudgetBar pct={pct} warnAt={team.warnAt} throttleAt={team.throttleAt} />
            {pct >= team.warnAt && (
              <div className="flex items-center gap-1.5 mt-1">
                <AlertTriangle size={10} className={pct >= team.throttleAt ? 'text-[var(--red)]' : 'text-[var(--amber)]'} />
                <span className={cn('text-[10.5px] font-medium', pct >= team.throttleAt ? 'text-[var(--red)]' : 'text-[var(--amber)]')}>
                  {pct >= team.throttleAt ? 'Budget throttle active' : 'Approaching budget limit'}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Members toggle */}
      <div className="border-t border-[var(--border)]">
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full flex items-center justify-between px-5 py-3 text-[12px] font-semibold text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <span>
            {teamMembers.length > 0
              ? `${teamMembers.length} member${teamMembers.length !== 1 ? 's' : ''}`
              : 'No members yet'}
          </span>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {expanded && (
          <div className="border-t border-[var(--border)]">
            {teamMembers.length === 0 ? (
              <div className="px-5 py-6 text-center">
                <p className="text-[12px] text-[var(--fg-tertiary)] mb-3">No members in this team yet</p>
                <button onClick={() => setShowAssign(true)} className="btn-primary text-[12px] py-1.5">
                  <UserPlus size={12} /> Add members
                </button>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {teamMembers.map(m => {
                  const RoleIcon  = ROLES[m.role as Role]?.icon  ?? Code2
                  const roleColor = ROLES[m.role as Role]?.color ?? 'text-[var(--fg-tertiary)]'
                  return (
                    <div key={m.id} className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--bg-hover)] transition-colors group">
                      <Avatar name={m.name} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] font-semibold text-[var(--fg)] truncate">{m.name}</p>
                        <p className="text-[11px] text-[var(--fg-tertiary)] truncate">{m.email}</p>
                      </div>

                      {/* Role selector */}
                      <div className="relative">
                        <select
                          value={m.role}
                          disabled={roleLoading === m.id}
                          onChange={e => changeRole(m.id, e.target.value as Role)}
                          className={cn(
                            'appearance-none bg-transparent border border-[var(--border)] rounded-lg px-2 py-1 text-[11px] font-semibold cursor-pointer hover:border-[var(--border-strong)] transition-colors pr-6',
                            roleColor,
                          )}
                        >
                          {Object.entries(ROLES).map(([r, { label }]) => (
                            <option key={r} value={r}>{label}</option>
                          ))}
                        </select>
                        <RoleIcon size={10} className={cn('absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none', roleColor)} />
                      </div>

                      {/* Remove from team */}
                      <button
                        onClick={() => removeFromTeam(m.id)}
                        disabled={removing === m.id}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--red-bg)] hover:text-[var(--red)] transition-colors opacity-0 group-hover:opacity-100"
                        title="Remove from team"
                      >
                        {removing === m.id
                          ? <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                          : <X size={12} />}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {showAssign && (
        <AssignModal
          teamId={team.id}
          allMembers={members}
          teamMemberIds={teamMemberIds}
          onClose={() => setShowAssign(false)}
          onAssign={handleAssign}
        />
      )}
    </div>
  )
}

/* ── Unassigned members strip ───────────────────────────────── */
function UnassignedSection({
  members, onRoleChange,
}: {
  members:      MemberRow[]
  onRoleChange: (id: string, role: Role) => void
}) {
  if (members.length === 0) return null
  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-[var(--border)] flex items-center gap-2">
        <UserCog size={15} className="text-[var(--fg-tertiary)]" />
        <h3 className="text-[13px] font-semibold text-[var(--fg)]">Unassigned members</h3>
        <span className="text-[11px] text-[var(--fg-tertiary)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-full">{members.length}</span>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {members.map(m => {
          const RoleIcon  = ROLES[m.role as Role]?.icon  ?? Code2
          const roleColor = ROLES[m.role as Role]?.color ?? 'text-[var(--fg-tertiary)]'
          return (
            <div key={m.id} className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--bg-hover)] transition-colors">
              <Avatar name={m.name} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-semibold text-[var(--fg)] truncate">{m.name}</p>
                <p className="text-[11px] text-[var(--fg-tertiary)] truncate">{m.email}</p>
              </div>
              <span className="text-[11px] text-[var(--fg-tertiary)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-full">No team</span>
              <div className="relative">
                <select
                  value={m.role}
                  onChange={e => onRoleChange(m.id, e.target.value as Role)}
                  className={cn('appearance-none bg-transparent border border-[var(--border)] rounded-lg px-2 py-1 text-[11px] font-semibold cursor-pointer pr-6', roleColor)}
                >
                  {Object.entries(ROLES).map(([r, { label }]) => (
                    <option key={r} value={r}>{label}</option>
                  ))}
                </select>
                <RoleIcon size={10} className={cn('absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none', roleColor)} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   Main client component
═══════════════════════════════════════════════════════════════ */
interface Props {
  teams:    TeamRow[]
  members:  MemberRow[]
  projects: ProjectRow[]
  orgId:    string
}

export function TeamsClient({ teams: initTeams, members: initMembers, projects, orgId }: Props) {
  const [teams,      setTeams]      = useState<TeamRow[]>(initTeams)
  const [members,    setMembers]    = useState<MemberRow[]>(initMembers)
  const [query,      setQuery]      = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<TeamRow | null>(null)
  const [deleteId,   setDeleteId]   = useState<string | null>(null)
  const [deleting,   setDeleting]   = useState(false)

  const filtered   = useMemo(() => {
    if (!query.trim()) return teams
    const q = query.toLowerCase()
    return teams.filter(t => t.name.toLowerCase().includes(q))
  }, [teams, query])

  const unassigned = useMemo(() => members.filter(m => !m.teamId), [members])

  const handleSaveTeam = useCallback((t: TeamRow) => {
    setTeams(prev => {
      const idx = prev.findIndex(x => x.id === t.id)
      if (idx >= 0) { const n = [...prev]; n[idx] = t; return n }
      return [...prev, t]
    })
  }, [])

  async function handleDeleteTeam(id: string) {
    setDeleting(true)
    try {
      await fetch(`/api/v1/teams?id=${id}`, { method: 'DELETE' })
      setTeams(prev => prev.filter(t => t.id !== id))
      setMembers(prev => prev.map(m => m.teamId === id ? { ...m, teamId: null } : m))
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  async function handleRoleChange(memberId: string, role: Role) {
    await fetch('/api/v1/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: memberId, role }),
    })
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role } : m))
  }

  const deleteTarget  = teams.find(t => t.id === deleteId)
  const totalBudget   = teams.reduce((s, t) => s + (t.budget ?? 0), 0)

  return (
    <div className="space-y-5">

      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Teams</h1>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">
            {teams.length} team{teams.length !== 1 ? 's' : ''} · {members.length} member{members.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-[13px]">
          <Plus size={14} /> New team
        </button>
      </div>

      {/* Stats strip */}
      {teams.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {([
            { label: 'Total teams',          value: String(teams.length),                       Icon: Users    },
            { label: 'Org members',           value: String(members.length),                     Icon: UserCog  },
            { label: 'Total monthly budget',  value: totalBudget ? formatCost(totalBudget) : 'No limit', Icon: DollarSign },
          ] as const).map(s => (
            <div key={s.label} className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[var(--bg-secondary)] flex items-center justify-center flex-shrink-0">
                <s.Icon size={16} className="text-[var(--fg-secondary)]" strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-[14px] font-bold text-[var(--fg)] tabular-nums">{s.value}</p>
                <p className="text-[10.5px] text-[var(--fg-tertiary)]">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      {teams.length > 0 && (
        <div className="relative max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search teams…"
            className="input pl-8 text-[13px] py-2"
          />
        </div>
      )}

      {/* Empty state */}
      {teams.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#E8533A1A] flex items-center justify-center mb-5">
            <Users size={28} className="text-[#E8533A]" strokeWidth={1.5} />
          </div>
          <h3 className="text-[16px] font-bold text-[var(--fg)] mb-2">No teams yet</h3>
          <p className="text-[13px] text-[var(--fg-secondary)] max-w-xs leading-relaxed mb-6">
            Create teams to organise members, set budgets, and track spending per group.
          </p>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus size={14} /> New team
          </button>
        </div>
      )}

      {/* Team cards grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map(t => (
            <TeamCard
              key={t.id}
              team={t}
              members={members}
              projects={projects}
              onEdit={setEditTarget}
              onDelete={setDeleteId}
              onMembersChange={setMembers}
            />
          ))}
        </div>
      )}

      {/* Unassigned members */}
      <UnassignedSection members={unassigned} onRoleChange={handleRoleChange} />

      {/* Modals */}
      {showCreate && (
        <TeamModal orgId={orgId} projects={projects} onClose={() => setShowCreate(false)} onSave={handleSaveTeam} />
      )}
      {editTarget && (
        <TeamModal orgId={orgId} projects={projects} initial={editTarget} onClose={() => setEditTarget(null)} onSave={handleSaveTeam} />
      )}
      {deleteId && deleteTarget && (
        <DeleteConfirm
          label={deleteTarget.name}
          loading={deleting}
          onConfirm={() => handleDeleteTeam(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  )
}
