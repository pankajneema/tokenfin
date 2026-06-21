'use client'
import { useState } from 'react'
import {
  Shield, Plus, AlertTriangle, Ban, Bell, BellOff, BellPlus,
  Trash2, Pencil, PauseCircle, PlayCircle, MoreHorizontal, Check, X,
  Building2, FolderOpen, Users, User, Zap, Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LimitRow, LimitScope, LimitPeriod, ScopeOption } from './page'

/* ── Helpers ─────────────────────────────────────────────────── */
type LimitStatus = 'healthy' | 'warning' | 'throttled' | 'blocked'

function getStatus(l: LimitRow): LimitStatus {
  if (!l.isActive) return 'healthy'
  const pct = l.budgetUsd > 0 ? (l.spentUsd / l.budgetUsd) * 100 : 0
  if (pct >= l.blockAt)    return 'blocked'
  if (pct >= l.throttleAt) return 'throttled'
  if (pct >= l.warnAt)     return 'warning'
  return 'healthy'
}

function fmtUsd(n: number) {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`
}

const SCOPE_META: Record<LimitScope, { icon: React.ElementType; label: string; color: string; bg: string }> = {
  org:     { icon: Building2,  label: 'Org',     color: 'text-[var(--blue)]',   bg: 'bg-[var(--blue-bg)]'  },
  project: { icon: FolderOpen, label: 'Project', color: 'text-[var(--accent)]', bg: 'bg-[var(--red-bg)]'   },
  team:    { icon: Users,      label: 'Team',    color: 'text-[#8B5CF6]',        bg: 'bg-[#8B5CF6]/10'      },
  member:  { icon: User,       label: 'Member',  color: 'text-teal',             bg: 'bg-[var(--green-bg)]' },
}

const PERIOD_LABEL: Record<LimitPeriod, string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly',
}

const STATUS_META: Record<LimitStatus, { label: string; color: string; bg: string; dot: string }> = {
  healthy:   { label: 'Healthy',   color: 'text-teal',           bg: 'bg-[var(--green-bg)]', dot: 'bg-teal'           },
  warning:   { label: 'Warning',   color: 'text-[var(--amber)]', bg: 'bg-[var(--amber-bg)]', dot: 'bg-[var(--amber)]' },
  throttled: { label: 'Throttled', color: 'text-[var(--red)]',   bg: 'bg-[var(--red-bg)]',   dot: 'bg-[var(--red)]'   },
  blocked:   { label: 'Blocked',   color: 'text-[var(--red)]',   bg: 'bg-[var(--red-bg)]',   dot: 'bg-[var(--red)]'   },
}

/* ── ThresholdBar ── */
function ThresholdBar({ limit }: { limit: LimitRow }) {
  const pct    = Math.min(limit.budgetUsd > 0 ? (limit.spentUsd / limit.budgetUsd) * 100 : 0, 100)
  const status = getStatus(limit)
  const fill   = status === 'blocked' || status === 'throttled' ? 'bg-[var(--red)]' :
                 status === 'warning' ? 'bg-[var(--amber)]' : 'bg-teal'
  return (
    <div className="space-y-1.5">
      <div className="relative h-2 rounded-full bg-[var(--bg-tertiary)] overflow-visible">
        <div className={cn('absolute left-0 top-0 h-full rounded-full transition-all duration-500', fill)} style={{ width: `${pct}%` }} />
        {[limit.warnAt, limit.throttleAt].map((t, i) => (
          <div key={i} className="absolute top-1/2 -translate-y-1/2 w-px h-3.5 bg-[var(--border-strong)]" style={{ left: `${t}%` }} />
        ))}
      </div>
      <div className="relative h-3">
        <span className="absolute text-[9.5px] text-[var(--fg-tertiary)] -translate-x-1/2" style={{ left: `${limit.warnAt}%` }}>{limit.warnAt}%</span>
        <span className="absolute text-[9.5px] text-[var(--fg-tertiary)] -translate-x-1/2" style={{ left: `${limit.throttleAt}%` }}>{limit.throttleAt}%</span>
      </div>
    </div>
  )
}

/* ── LimitCard ── */
function LimitCard({
  limit, onToggle, onDelete, onEdit, onAddAlert,
}: {
  limit:      LimitRow
  onToggle:   (id: string) => void
  onDelete:   (id: string) => void
  onEdit:     (l: LimitRow) => void
  onAddAlert: (l: LimitRow) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const status    = getStatus(limit)
  const sm        = SCOPE_META[limit.scope]
  const stm       = STATUS_META[status]
  const ScopeIcon = sm.icon
  const pct       = limit.budgetUsd > 0 ? Math.min((limit.spentUsd / limit.budgetUsd) * 100, 100) : 0

  return (
    <div className={cn(
      'bg-white dark:bg-[#141428] border rounded-2xl p-5 space-y-4 transition-all',
      !limit.isActive ? 'opacity-60 border-[var(--border)]' :
      status === 'blocked'   ? 'border-[var(--red)]/40 shadow-[0_0_0_1px_var(--red-bg)]' :
      status === 'throttled' ? 'border-[var(--red)]/30' :
      status === 'warning'   ? 'border-[var(--amber)]/40' :
                               'border-[var(--border)]',
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', sm.bg)}>
            <ScopeIcon size={16} className={sm.color} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[13.5px] font-bold text-[var(--fg)] truncate">{limit.scopeName}</p>
              {!limit.isActive && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]">Paused</span>}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={cn('text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md', sm.bg, sm.color)}>{sm.label}</span>
              <span className="text-[10.5px] text-[var(--fg-tertiary)]">·</span>
              <span className="text-[10.5px] text-[var(--fg-tertiary)]">{PERIOD_LABEL[limit.period]}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className={cn('flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-semibold', stm.bg, stm.color)}>
            <span className={cn('w-1.5 h-1.5 rounded-full', stm.dot)} />{stm.label}
          </div>
          <div className="relative">
            <button onClick={() => setMenuOpen(v => !v)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] transition-colors">
              <MoreHorizontal size={15} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-[9]" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-9 w-48 bg-white dark:bg-[#1E1E35] border border-[var(--border)] rounded-xl shadow-2xl z-10 p-1">
                  {([
                    { icon: Pencil,                                     label: 'Edit limit',     danger: false, fn: () => { onEdit(limit); setMenuOpen(false) } },
                    { icon: limit.isActive ? PauseCircle : PlayCircle,  label: limit.isActive ? 'Pause' : 'Resume', danger: false, fn: () => { onToggle(limit.id); setMenuOpen(false) } },
                    { icon: BellPlus,                                   label: 'Add alert rule', danger: false, fn: () => { onAddAlert(limit); setMenuOpen(false) } },
                    { icon: Trash2,                                     label: 'Delete limit',   danger: true,  fn: () => { onDelete(limit.id); setMenuOpen(false) } },
                  ] as { icon: React.ElementType; label: string; danger: boolean; fn: () => void }[]).map((item, i) => (
                    <button key={i} onClick={item.fn}
                      className={cn('w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12.5px] font-medium text-left transition-colors',
                        item.danger ? 'text-[var(--red)] hover:bg-[var(--red-bg)]' : 'text-[var(--fg)] hover:bg-[var(--bg-hover)]')}>
                      <item.icon size={13} className="flex-shrink-0" />
                      {item.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Spend */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[22px] font-bold text-[var(--fg)] leading-none">{fmtUsd(limit.spentUsd)}</p>
          <p className="text-[11px] text-[var(--fg-tertiary)] mt-1">of {fmtUsd(limit.budgetUsd)} budget · {pct.toFixed(1)}%</p>
        </div>
      </div>

      <ThresholdBar limit={limit} />

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-[var(--border)]">
        <div className="flex items-center gap-3 text-[10.5px] text-[var(--fg-tertiary)]">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)] inline-block" />Warn {limit.warnAt}%</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[var(--red)] inline-block" />Throttle {limit.throttleAt}%</span>
          <span className="flex items-center gap-1"><Ban size={9} />Block {limit.blockAt}%</span>
        </div>
        <button className="flex items-center gap-1 text-[10.5px] font-medium text-[var(--fg-tertiary)] hover:text-[var(--fg)] transition-colors">
          <BellOff size={11} />No alert
        </button>
      </div>
    </div>
  )
}

/* ── LimitModal (Create / Edit) ── */
const SCOPE_OPTIONS: { value: LimitScope; icon: React.ElementType; label: string }[] = [
  { value: 'org',     icon: Building2,  label: 'Org'     },
  { value: 'project', icon: FolderOpen, label: 'Project' },
  { value: 'team',    icon: Users,      label: 'Team'    },
  { value: 'member',  icon: User,       label: 'Member'  },
]

const PERIOD_OPTIONS: { value: LimitPeriod; label: string }[] = [
  { value: 'daily',   label: 'Daily'   },
  { value: 'weekly',  label: 'Weekly'  },
  { value: 'monthly', label: 'Monthly' },
]

function LimitModal({
  initial, projects, teams, orgId, onClose, onCreated, onUpdated,
}: {
  initial?:   LimitRow | null
  projects:   ScopeOption[]
  teams:      ScopeOption[]
  orgId:      string
  onClose:    () => void
  onCreated:  (l: LimitRow) => void
  onUpdated:  (l: LimitRow) => void
}) {
  const isEdit = !!initial

  const [scope,        setScope]        = useState<LimitScope>(initial?.scope ?? 'project')
  const [targetId,     setTargetId]     = useState<string>(initial?.scopeTargetId ?? '')
  const [period,       setPeriod]       = useState<LimitPeriod>(initial?.period ?? 'monthly')
  const [budget,       setBudget]       = useState(initial?.budgetUsd?.toString() ?? '')
  const [warnAt,       setWarnAt]       = useState(initial?.warnAt ?? 70)
  const [throttleAt,   setThrottleAt]   = useState(initial?.throttleAt ?? 90)
  const [blockAt,      setBlockAt]      = useState(initial?.blockAt ?? 100)
  const [createAlert,  setCreateAlert]  = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState<string | null>(null)

  const scopeOptions: ScopeOption[] =
    scope === 'project' ? projects :
    scope === 'team'    ? teams    : []

  const scopeName = (() => {
    if (scope === 'org') return 'Entire org'
    return scopeOptions.find(o => o.id === targetId)?.name ?? ''
  })()

  async function handleSave() {
    setSaving(true); setError(null)
    try {
      const body: Record<string, unknown> = {
        org_id:      orgId,
        scope,
        period,
        budget_usd:  Number(budget),
        warn_at:     warnAt,
        throttle_at: throttleAt,
        block_at:    blockAt,
      }
      if (scope === 'project') body.project_id = targetId || null
      if (scope === 'team')    body.team_id    = targetId || null

      let row: LimitRow
      if (isEdit) {
        const res = await fetch('/api/v1/limits', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: initial!.id, budget_usd: Number(budget), period, warn_at: warnAt, throttle_at: throttleAt, block_at: blockAt }),
        })
        if (!res.ok) throw new Error(await res.text())
        const data = await res.json()
        row = {
          ...initial!,
          period:     data.period,
          budgetUsd:  data.budget_usd,
          warnAt:     data.warn_at,
          throttleAt: data.throttle_at,
          blockAt:    data.block_at,
        }
        onUpdated(row)
      } else {
        const res = await fetch('/api/v1/limits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error(await res.text())
        const data = await res.json()
        row = {
          id:            data.id,
          scope:         data.scope,
          scopeName,
          scopeTargetId: data.project_id ?? data.team_id ?? null,
          period:        data.period,
          budgetUsd:     data.budget_usd,
          spentUsd:      0,
          warnAt:        data.warn_at,
          throttleAt:    data.throttle_at,
          blockAt:       data.block_at,
          isActive:      true,
        }
        onCreated(row)

        // Optionally create alert rule linked to this limit
        if (createAlert) {
          await fetch('/api/v1/alerts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              org_id:         orgId,
              project_id:     scope === 'project' ? targetId : null,
              name:           `${scopeName} budget warn`,
              trigger_type:   'limit_breach',
              condition:      `spend >= ${warnAt}%`,
              scope:          scopeName,
              threshold:      warnAt,
              cooldown_hours: 4,
              channels:       { email: true, slack: false, webhook: false, inapp: true },
            }),
          })
        }
      }
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save limit')
    } finally {
      setSaving(false)
    }
  }

  const valid = budget && Number(budget) > 0 && (scope === 'org' || !!targetId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[520px] bg-white dark:bg-[#141428] rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-[15px] font-bold text-[var(--fg)]">{isEdit ? 'Edit limit' : 'New budget limit'}</h2>
            <p className="text-[12px] text-[var(--fg-tertiary)] mt-0.5">Warn → throttle → block spend guardrails</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Scope */}
          {!isEdit && (
            <div>
              <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Scope</label>
              <div className="grid grid-cols-4 gap-2">
                {SCOPE_OPTIONS.map(opt => {
                  const sm     = SCOPE_META[opt.value]
                  const Icon   = opt.icon
                  const active = scope === opt.value
                  return (
                    <button key={opt.value} onClick={() => { setScope(opt.value); setTargetId('') }}
                      className={cn('flex flex-col items-center gap-1.5 py-3 rounded-xl border text-center transition-all',
                        active ? `${sm.bg} ${sm.color} border-current/30` : 'border-[var(--border)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]')}>
                      <Icon size={15} />
                      <span className="text-[11px] font-semibold">{opt.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Scope target */}
          {scope !== 'org' && scopeOptions.length > 0 && (
            <div>
              <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">
                {scope === 'project' ? 'Project' : 'Team'}
              </label>
              <select value={targetId} onChange={e => setTargetId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral">
                <option value="">Select {scope}…</option>
                {scopeOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
          {scope !== 'org' && scopeOptions.length === 0 && (
            <div className="text-[12px] text-[var(--amber)] bg-[var(--amber-bg)] p-3 rounded-xl">
              No {scope}s found. Create one first.
            </div>
          )}

          {/* Period + Budget */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Period</label>
              <div className="flex gap-1 p-1 bg-[var(--bg-secondary)] rounded-xl">
                {PERIOD_OPTIONS.map(p => (
                  <button key={p.value} onClick={() => setPeriod(p.value)}
                    className={cn('flex-1 py-1.5 rounded-lg text-[11.5px] font-semibold transition-all',
                      period === p.value ? 'bg-white dark:bg-[#1E1E35] text-[var(--fg)] shadow-sm' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Budget (USD)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[var(--fg-tertiary)] font-semibold">$</span>
                <input type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder="500"
                  className="w-full pl-7 pr-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral" />
              </div>
            </div>
          </div>

          {/* Thresholds */}
          <div>
            <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-3">Thresholds</label>
            <div className="space-y-3 p-4 bg-[var(--bg-secondary)] rounded-xl">
              {[
                { label: 'Warn',     value: warnAt,     set: setWarnAt,     color: 'text-[var(--amber)]', desc: 'Send alert'       },
                { label: 'Throttle', value: throttleAt, set: setThrottleAt, color: 'text-[var(--red)]',   desc: 'Rate-limit calls' },
                { label: 'Block',    value: blockAt,    set: setBlockAt,    color: 'text-[var(--red)]',   desc: 'Reject all calls' },
              ].map(t => (
                <div key={t.label} className="flex items-center gap-3">
                  <div className="w-[72px] text-right">
                    <p className={cn('text-[12px] font-bold', t.color)}>{t.label}</p>
                    <p className="text-[9.5px] text-[var(--fg-tertiary)]">{t.desc}</p>
                  </div>
                  <input type="range" min={1} max={100} value={t.value}
                    onChange={e => t.set(Number(e.target.value))}
                    className="flex-1 accent-[var(--accent)] h-1.5" />
                  <div className="w-10 text-right">
                    <span className="text-[13px] font-bold text-[var(--fg)]">{t.value}%</span>
                  </div>
                </div>
              ))}

              {budget && (
                <div className="mt-3 pt-3 border-t border-[var(--border)]">
                  <p className="text-[10.5px] text-[var(--fg-tertiary)] mb-2">Preview · at 100% spend</p>
                  <div className="relative h-2 rounded-full bg-[var(--bg-tertiary)] overflow-visible">
                    <div className="absolute left-0 top-0 h-full w-full rounded-full bg-gradient-to-r from-teal via-[var(--amber)] to-[var(--red)]" />
                    {[warnAt, throttleAt].map((t, i) => (
                      <div key={i} className="absolute top-1/2 -translate-y-1/2 w-px h-3.5 bg-[var(--bg)]" style={{ left: `${t}%` }} />
                    ))}
                  </div>
                  <div className="flex justify-between mt-1.5 text-[9.5px] text-[var(--fg-tertiary)]">
                    <span>$0</span>
                    <span className="ml-auto">${Number(budget).toLocaleString()}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Create alert toggle (create only) */}
          {!isEdit && (
            <button onClick={() => setCreateAlert(v => !v)}
              className={cn('w-full flex items-center gap-3 p-4 rounded-xl border transition-all text-left',
                createAlert ? 'border-teal bg-[var(--green-bg)]' : 'border-[var(--border)] hover:border-[var(--border-strong)] bg-[var(--bg-secondary)]')}>
              <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors', createAlert ? 'bg-teal/20' : 'bg-[var(--bg-tertiary)]')}>
                <Bell size={16} className={createAlert ? 'text-teal' : 'text-[var(--fg-tertiary)]'} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn('text-[12.5px] font-semibold', createAlert ? 'text-[var(--green)]' : 'text-[var(--fg)]')}>Create alert rule</p>
                <p className="text-[11px] text-[var(--fg-tertiary)]">Notify via email when warn threshold is hit</p>
              </div>
              <div className={cn('w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all', createAlert ? 'bg-teal border-teal' : 'border-[var(--border)]')}>
                {createAlert && <Check size={11} className="text-white" />}
              </div>
            </button>
          )}

          {error && <p className="text-[12px] text-[var(--red)] bg-[var(--red-bg)] border border-[var(--red)]/20 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={!valid || saving}
            className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
            {saving
              ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Saving…</>
              : <><Check size={13} /> {isEdit ? 'Save changes' : 'Create limit'}</>}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── AddAlertModal ── */
function AddAlertModal({ limit, orgId, onClose, onCreated }: {
  limit:     LimitRow
  orgId:     string
  onClose:   () => void
  onCreated: () => void
}) {
  const [channels,  setChannels]  = useState({ email: true, slack: false, webhook: false, inapp: true })
  const [threshold, setThreshold] = useState(limit.warnAt.toString())
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  async function handleCreate() {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/v1/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id:         orgId,
          name:           `${limit.scopeName} budget alert`,
          trigger_type:   'limit_breach',
          condition:      `spend >= ${threshold}%`,
          scope:          limit.scopeName,
          threshold:      Number(threshold),
          cooldown_hours: 4,
          channels,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      onCreated()
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create alert')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[440px] bg-white dark:bg-[#141428] rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-[15px] font-bold text-[var(--fg)]">Add alert rule</h2>
            <p className="text-[12px] text-[var(--fg-tertiary)] mt-0.5">
              For <span className="font-semibold text-[var(--fg)]">{limit.scopeName}</span> · {PERIOD_LABEL[limit.period]} · {fmtUsd(limit.budgetUsd)} budget
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)]">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Context */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
            <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', SCOPE_META[limit.scope].bg)}>
              {(() => { const Icon = SCOPE_META[limit.scope].icon; return <Icon size={14} className={SCOPE_META[limit.scope].color} /> })()}
            </div>
            <div className="text-[12px]">
              <p className="font-semibold text-[var(--fg)]">{limit.scopeName}</p>
              <p className="text-[var(--fg-tertiary)]">Budget: {fmtUsd(limit.budgetUsd)} / {PERIOD_LABEL[limit.period].toLowerCase()}</p>
            </div>
          </div>

          {/* Trigger threshold */}
          <div>
            <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Fire when spend reaches</label>
            <div className="flex gap-1 p-1 bg-[var(--bg-secondary)] rounded-xl">
              {[
                { v: limit.warnAt.toString(),     label: `${limit.warnAt}% · Warn`           },
                { v: limit.throttleAt.toString(), label: `${limit.throttleAt}% · Throttle`   },
                { v: '100',                       label: '100% · Block'                       },
              ].map(opt => (
                <button key={opt.v} onClick={() => setThreshold(opt.v)}
                  className={cn('flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all',
                    threshold === opt.v ? 'bg-white dark:bg-[#1E1E35] text-[var(--fg)] shadow-sm' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Channels */}
          <div>
            <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Notify via</label>
            <div className="grid grid-cols-2 gap-2">
              {(['email', 'slack', 'webhook', 'inapp'] as const).map(ch => {
                const active = channels[ch]
                const labels: Record<string, string>  = { email: 'Email', slack: 'Slack', webhook: 'Webhook', inapp: 'In-app' }
                const colors: Record<string, string>  = { email: 'text-[var(--blue)] bg-[var(--blue-bg)]', slack: 'text-[#8B5CF6] bg-[#8B5CF6]/10', webhook: 'text-[var(--amber)] bg-[var(--amber-bg)]', inapp: 'text-teal bg-[var(--green-bg)]' }
                return (
                  <button key={ch}
                    onClick={() => ch !== 'inapp' && setChannels(prev => ({ ...prev, [ch]: !prev[ch] }))}
                    className={cn('flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[12px] font-semibold transition-all',
                      active ? `${colors[ch]} border-current/30` : 'border-[var(--border)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)]',
                      ch === 'inapp' && 'opacity-70 cursor-default')}>
                    {active ? <Check size={12} className="text-current" /> : <span className="w-3 h-3 rounded border-2 border-[var(--border-strong)]" />}
                    {labels[ch]}
                    {ch === 'inapp' && <span className="text-[9.5px] ml-auto opacity-70">always</span>}
                  </button>
                )
              })}
            </div>
          </div>
          {error && <p className="text-[12px] text-[var(--red)] bg-[var(--red-bg)] border border-[var(--red)]/20 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleCreate} disabled={saving} className="btn-primary disabled:opacity-40">
            {saving
              ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Creating…</>
              : <><Bell size={13} /> Create alert rule</>}
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
  initialLimits: LimitRow[]
  projects:      ScopeOption[]
  teams:         ScopeOption[]
  orgId:         string
}

export function LimitsClient({ initialLimits, projects, teams, orgId }: Props) {
  const [limits,        setLimits]        = useState<LimitRow[]>(initialLimits)
  const [scopeFilter,   setScopeFilter]   = useState<LimitScope | 'all'>('all')
  const [showModal,     setShowModal]     = useState(false)
  const [editTarget,    setEditTarget]    = useState<LimitRow | null>(null)
  const [deleteId,      setDeleteId]      = useState<string | null>(null)
  const [deleteInput,   setDeleteInput]   = useState('')
  const [alertForLimit, setAlertForLimit] = useState<LimitRow | null>(null)
  const [toast,         setToast]         = useState('')
  const [toggling,      setToggling]      = useState<string | null>(null)
  const [deleting,      setDeleting]      = useState(false)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  async function handleToggle(id: string) {
    const limit = limits.find(l => l.id === id)
    if (!limit) return
    setToggling(id)
    try {
      await fetch('/api/v1/limits', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: !limit.isActive }),
      })
      setLimits(prev => prev.map(l => l.id === id ? { ...l, isActive: !l.isActive } : l))
    } finally {
      setToggling(null)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    try {
      await fetch(`/api/v1/limits?id=${deleteId}`, { method: 'DELETE' })
      setLimits(prev => prev.filter(l => l.id !== deleteId))
      showToast('Limit deleted')
    } finally {
      setDeleting(false)
      setDeleteId(null)
      setDeleteInput('')
    }
  }

  const filtered = scopeFilter === 'all' ? limits : limits.filter(l => l.scope === scopeFilter)

  const totalBudget = limits.filter(l => l.isActive).reduce((s, l) => s + l.budgetUsd, 0)
  const atRisk      = limits.filter(l => { const s = getStatus(l); return s === 'warning' || s === 'throttled' }).length
  const blocked     = limits.filter(l => getStatus(l) === 'blocked').length
  const activeCount = limits.filter(l => l.isActive).length

  const deleteTarget = limits.find(l => l.id === deleteId)

  return (
    <div className="space-y-6 max-w-[1100px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Budget Limits</h1>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">Spend guardrails · warn → throttle → block pipeline</p>
        </div>
        <button onClick={() => { setEditTarget(null); setShowModal(true) }} className="btn-primary flex-shrink-0">
          <Plus size={14} /> New limit
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total budget capped', value: `$${(totalBudget / 1000).toFixed(1)}k / mo`, icon: Shield,        color: 'text-[var(--blue)]',  bg: 'bg-[var(--blue-bg)]'  },
          { label: 'Active limits',       value: activeCount.toString(),                       icon: Activity,      color: 'text-teal',            bg: 'bg-[var(--green-bg)]' },
          { label: 'At risk (>70%)',      value: atRisk.toString(),                            icon: AlertTriangle, color: 'text-[var(--amber)]',  bg: 'bg-[var(--amber-bg)]' },
          { label: 'Blocked scopes',      value: blocked.toString(),                           icon: Ban,           color: 'text-[var(--red)]',    bg: 'bg-[var(--red-bg)]'   },
        ].map(s => {
          const Icon = s.icon
          return (
            <div key={s.label} className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-4 flex items-center gap-3">
              <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', s.bg)}>
                <Icon size={16} className={s.color} />
              </div>
              <div>
                <p className="text-[18px] font-bold text-[var(--fg)] leading-none">{s.value}</p>
                <p className="text-[11px] text-[var(--fg-tertiary)] mt-0.5">{s.label}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Scope filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {([['all', 'All'], ['org', 'Org'], ['project', 'Project'], ['team', 'Team'], ['member', 'Member']] as const).map(([v, label]) => {
          const active = scopeFilter === v
          const sm     = v !== 'all' ? SCOPE_META[v as LimitScope] : null
          const count  = v === 'all' ? limits.length : limits.filter(l => l.scope === v).length
          return (
            <button key={v} onClick={() => setScopeFilter(v as LimitScope | 'all')}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[12.5px] font-semibold transition-all',
                active ? 'bg-[var(--fg)] text-[var(--bg)] border-[var(--fg)]' : 'border-[var(--border)] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]')}>
              {sm && <sm.icon size={11} />}
              {label}
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md font-semibold',
                active ? 'bg-white/20 text-[var(--bg)]' : 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]')}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Cards grid */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl py-20 text-center">
          <Shield size={36} className="text-[var(--fg-tertiary)] mx-auto mb-4" />
          <p className="text-[14px] font-semibold text-[var(--fg)]">No limits for this scope</p>
          <p className="text-[12.5px] text-[var(--fg-secondary)] mt-1">Create a budget limit to add spend guardrails</p>
          <button onClick={() => setShowModal(true)} className="btn-primary mt-5"><Plus size={13} /> New limit</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(limit => (
            <LimitCard
              key={limit.id}
              limit={{ ...limit, isActive: toggling === limit.id ? !limit.isActive : limit.isActive }}
              onToggle={handleToggle}
              onDelete={id => { setDeleteId(id); setDeleteInput('') }}
              onEdit={l => { setEditTarget(l); setShowModal(true) }}
              onAddAlert={l => setAlertForLimit(l)}
            />
          ))}
        </div>
      )}

      {/* Info callout */}
      <div className="flex items-start gap-4 p-4 bg-[var(--blue-bg)] border border-[var(--blue)]/20 rounded-2xl">
        <Zap size={16} className="text-[var(--blue)] mt-0.5 flex-shrink-0" />
        <div className="text-[12px] text-[var(--blue)]">
          <span className="font-bold">How limits work: </span>
          When spend hits <span className="font-semibold">Warn %</span>, alerts fire.
          At <span className="font-semibold">Throttle %</span>, API responses are rate-limited.
          At <span className="font-semibold">Block %</span>, all API calls are rejected until the period resets.
        </div>
      </div>

      {/* Create/Edit modal */}
      {showModal && (
        <LimitModal
          initial={editTarget}
          projects={projects}
          teams={teams}
          orgId={orgId}
          onClose={() => { setShowModal(false); setEditTarget(null) }}
          onCreated={row => { setLimits(prev => [row, ...prev]); showToast('Limit created') }}
          onUpdated={row => { setLimits(prev => prev.map(l => l.id === row.id ? row : l)); showToast('Limit updated') }}
        />
      )}

      {/* Alert modal */}
      {alertForLimit && (
        <AddAlertModal
          limit={alertForLimit}
          orgId={orgId}
          onClose={() => setAlertForLimit(null)}
          onCreated={() => showToast(`Alert created for ${alertForLimit.scopeName}`)}
        />
      )}

      {/* Delete confirm */}
      {deleteId && deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setDeleteId(null)} />
          <div className="relative w-full max-w-[400px] bg-white dark:bg-[#141428] rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="w-10 h-10 rounded-2xl bg-[var(--red-bg)] flex items-center justify-center">
              <Trash2 size={18} className="text-[var(--red)]" />
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-[var(--fg)]">Delete limit?</h3>
              <p className="text-[12.5px] text-[var(--fg-secondary)] mt-1">
                <span className="font-semibold text-[var(--fg)]">{deleteTarget.scopeName}</span> will have no spend cap after deletion.
              </p>
            </div>
            <div className="p-3 bg-[var(--red-bg)] rounded-xl">
              <p className="text-[11.5px] text-[var(--fg-secondary)] mb-2">
                Type <span className="font-mono font-bold text-[var(--fg)]">delete</span> to confirm
              </p>
              <input value={deleteInput} onChange={e => setDeleteInput(e.target.value)} placeholder="delete"
                className="w-full px-3 py-2 rounded-lg border border-[var(--red)]/30 text-[12.5px] bg-[var(--bg)] text-[var(--fg)] focus:outline-none focus:border-[var(--red)]" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setDeleteId(null)} className="btn-secondary flex-1">Cancel</button>
              <button disabled={deleteInput !== 'delete' || deleting} onClick={handleDelete}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--red)] text-white text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--red)]/90 transition-colors">
                <Trash2 size={13} /> Delete limit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      <div className={cn('fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-3 bg-[var(--fg)] text-[var(--bg)] rounded-2xl shadow-2xl text-[13px] font-semibold transition-all duration-300 z-50',
        toast ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none')}>
        <Check size={14} className="text-teal" /> {toast}
      </div>
    </div>
  )
}
