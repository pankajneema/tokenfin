'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Shield, Plus, AlertTriangle, Ban, Bell, BellOff, BellPlus,
  Trash2, Pencil, PauseCircle, PlayCircle, MoreHorizontal, Check,
  Building2, FolderOpen, Users, User, Zap, Activity, TrendingUp,
} from 'lucide-react'
import { cn, readApiError } from '@/lib/utils'
import { can, type Role } from '@/lib/rbac'
import { Dialog } from '@/components/ui/dialog'
import type { LimitRow, LimitScope, LimitPeriod, ScopeOption } from './page'
import type { ChannelStatus } from '../alerts/_types'

type ChannelMap = Map<ChannelStatus['id'], ChannelStatus>
/** Default channels for a new budget alert: in-app plus email only if the server can send it. */
const defaultChannels = (ch: ChannelMap) => ({ email: !!ch.get('email')?.deliverable, slack: false, webhook: false, inapp: true })


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

/* ── Forecast ── */
// Budget-dependent numbers are derived here from the server's run-rate and
// projection so they stay right after the budget is edited in place.
function deriveForecast(l: LimitRow) {
  const f = l.forecast
  if (!f || l.budgetUsd <= 0) return null
  const onTrack = f.projectedUsd <= l.budgetUsd
  const runway  = l.spentUsd >= l.budgetUsd ? 0 : f.ratePerDay > 0 ? (l.budgetUsd - l.spentUsd) / f.ratePerDay : null
  const exceed  = onTrack ? null
    : new Date(Date.now() + (runway ?? 0) * 86400_000).toISOString().slice(0, 10)
  return { ...f, onTrack, runwayDays: runway, exceedDate: exceed, projectedPct: (f.projectedUsd / l.budgetUsd) * 100 }
}

const PERIOD_END: Record<LimitPeriod, string> = { daily: 'end of day', weekly: 'next 7 days', monthly: 'month-end' }

// Locale-independent so server and browser render identical text (no hydration mismatch).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDate(d: string) {
  const [, m, day] = d.split('-').map(Number)
  return `${MONTHS[m - 1]} ${day}`
}

function fmtRunway(days: number | null) {
  if (days == null) return 'No spend trend'
  if (days <= 0)    return 'Budget used up'
  if (days < 1)     return '< 1 day'
  return `${days >= 100 ? Math.round(days) : days.toFixed(days < 10 ? 1 : 0)} days`
}

function ForecastRow({ limit }: { limit: LimitRow }) {
  const f = deriveForecast(limit)
  if (!f) return null
  return (
    <div className="grid grid-cols-3 gap-3 rounded-xl bg-[var(--bg-secondary)] px-3 py-2.5" data-testid="limit-forecast">
      <div className="min-w-0">
        <p className="text-[9.5px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)] flex items-center gap-1"><TrendingUp size={9} />Projected {PERIOD_END[limit.period]}</p>
        <p className="text-[13px] font-bold text-[var(--fg)] mt-0.5">{fmtUsd(f.projectedUsd)} <span className="text-[10.5px] font-medium text-[var(--fg-tertiary)]">· {f.projectedPct.toFixed(0)}%</span></p>
      </div>
      <div className="min-w-0">
        <p className="text-[9.5px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">Runway</p>
        <p className="text-[13px] font-bold text-[var(--fg)] mt-0.5" title={`${fmtUsd(f.ratePerDay)}/day run-rate (14 days, weighted to the last 7)`}>{fmtRunway(f.runwayDays)}</p>
      </div>
      <div className="flex items-center justify-end">
        {f.onTrack ? (
          <span className="text-[10.5px] font-semibold px-2 py-1 rounded-full bg-[var(--green-bg)] text-teal whitespace-nowrap">On track</span>
        ) : (
          <span className="text-[10.5px] font-semibold px-2 py-1 rounded-full bg-[var(--red-bg)] text-[var(--red)] whitespace-nowrap">
            {f.runwayDays === 0 ? 'Over budget' : `Will exceed on ${fmtDate(f.exceedDate!)}`}
          </span>
        )}
      </div>
    </div>
  )
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
  limit, onToggle, onDelete, onEdit, onAddAlert, readOnly = false, canAlert,
}: {
  canAlert:    boolean
  limit:       LimitRow
  onToggle:    (id: string) => void
  onDelete:    (id: string) => void
  onEdit:      (l: LimitRow) => void
  onAddAlert:  (l: LimitRow) => void
  readOnly?:   boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const status    = getStatus(limit)
  const sm        = SCOPE_META[limit.scope]
  const stm       = STATUS_META[status]
  const ScopeIcon = sm.icon
  const pct       = limit.budgetUsd > 0 ? Math.min((limit.spentUsd / limit.budgetUsd) * 100, 100) : 0

  return (
    <div id={`limit-${limit.id}`} className={cn(
      'bg-white dark:bg-[#141428] border rounded-2xl p-5 space-y-4 transition-all scroll-mt-4 target:ring-2 target:ring-coral/40',
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
          {!readOnly && <div className="relative">
            <button type="button" onClick={() => setMenuOpen(v => !v)} aria-label={`Actions for ${limit.scopeName} limit`} aria-haspopup="menu" aria-expanded={menuOpen}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] transition-colors">
              <MoreHorizontal size={15} aria-hidden="true" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-[9]" onClick={() => setMenuOpen(false)} />
                <div role="menu" className="absolute right-0 top-9 w-48 bg-white dark:bg-[#1E1E35] border border-[var(--border)] rounded-xl shadow-2xl z-10 p-1">
                  {([
                    { icon: Pencil,                                     label: 'Edit limit',     danger: false, fn: () => { onEdit(limit); setMenuOpen(false) } },
                    { icon: limit.isActive ? PauseCircle : PlayCircle,  label: limit.isActive ? 'Pause' : 'Resume', danger: false, fn: () => { onToggle(limit.id); setMenuOpen(false) } },
                    ...(canAlert && limit.scope !== 'member' ? [{ icon: BellPlus, label: 'Create alert for this budget', danger: false, fn: () => { onAddAlert(limit); setMenuOpen(false) } }] : []),
                    { icon: Trash2,                                     label: 'Delete limit',   danger: true,  fn: () => { onDelete(limit.id); setMenuOpen(false) } },
                  ] as { icon: React.ElementType; label: string; danger: boolean; fn: () => void }[]).map((item, i) => (
                    <button key={i} type="button" role="menuitem" onClick={item.fn}
                      className={cn('w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12.5px] font-medium text-left transition-colors',
                        item.danger ? 'text-[var(--red)] hover:bg-[var(--red-bg)]' : 'text-[var(--fg)] hover:bg-[var(--bg-hover)]')}>
                      <item.icon size={13} className="flex-shrink-0" aria-hidden="true" />
                      {item.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>}
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

      {limit.isActive && <ForecastRow limit={limit} />}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-[var(--border)]">
        <div className="flex items-center gap-3 text-[10.5px] text-[var(--fg-tertiary)]">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)] inline-block" />Warn {limit.warnAt}%</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[var(--red)] inline-block" />Throttle {limit.throttleAt}%</span>
          <span className="flex items-center gap-1"><Ban size={9} />Block {limit.blockAt}%</span>
        </div>
      </div>

      {/* Alert rules watching this budget (same matching as the alert engine) */}
      <div className="rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] px-3 py-2.5 space-y-1.5">
        {limit.scope === 'member' ? (
          <p className="text-[11px] text-[var(--fg-secondary)] flex items-center gap-1.5"><BellOff size={11} aria-hidden="true" /> Alerts can&apos;t watch member limits yet.</p>
        ) : limit.alertRules.length === 0 ? (
          <p className="text-[11px] text-[var(--fg-secondary)] flex items-center gap-1.5"><BellOff size={11} aria-hidden="true" /> No alert watches this budget.</p>
        ) : (
          <ul className="space-y-1">
            {limit.alertRules.map(r => (
              <li key={r.id} className="flex items-center gap-1.5 text-[11px]">
                {r.triggerType === 'forecast' ? <TrendingUp size={11} className="text-[var(--blue)]" aria-hidden="true" /> : <Bell size={11} className="text-[var(--green)]" aria-hidden="true" />}
                <Link href={`/dashboard/alerts#rule-${r.id}`} className="font-semibold text-[var(--fg)] hover:text-coral hover:underline truncate">{r.name}</Link>
                <span className="text-[var(--fg-tertiary)]">· {r.triggerType === 'forecast' ? 'forecast' : 'limit breach'}{r.isActive ? '' : ' · paused'}</span>
              </li>
            ))}
          </ul>
        )}
        {canAlert && limit.scope !== 'member' && (
          <button type="button" onClick={() => onAddAlert(limit)}
            className="flex items-center gap-1 text-[11px] font-semibold text-coral hover:underline">
            <BellPlus size={11} aria-hidden="true" /> Create alert for this budget
          </button>
        )}
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
  initial, projects, teams, orgId, onClose, onCreated, onUpdated, channels, canAlert,
}: {
  channels:   ChannelMap
  canAlert:   boolean
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
        if (!res.ok) throw new Error(await readApiError(res))
        const data = await res.json()
        row = {
          ...initial!,
          // A new period changes the projection window — drop it until reload.
          forecast:   data.period === initial!.period ? initial!.forecast : null,
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
        if (!res.ok) throw new Error(await readApiError(res))
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
          hasAlert:      false,
          hasForecastAlert: false,
          alertRules:    [],   // recomputed by the server refresh after save
          forecast:      null,
        }
        // Optionally create an alert rule that watches this limit
        if (createAlert) {
          const ar = await fetch('/api/v1/alerts', {
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
              channels:       defaultChannels(channels),
            }),
          })
          if (!ar.ok) { onCreated(row); throw new Error(`Limit saved, but the alert rule failed: ${await readApiError(ar)}`) }
        }
        onCreated(row)
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
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? 'Edit limit' : 'New budget limit'}
      description="Warn → throttle → block spend guardrails"
      footer={<>
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="button" onClick={handleSave} disabled={!valid || saving}
          className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
          {saving
            ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" aria-hidden="true" /> Saving…</>
            : <><Check size={13} aria-hidden="true" /> {isEdit ? 'Save changes' : 'Create limit'}</>}
        </button>
      </>}
    >
        <div className="px-6 py-5 space-y-5">
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
          {!isEdit && canAlert && scope !== 'member' && (
            <button type="button" role="checkbox" aria-checked={createAlert} onClick={() => setCreateAlert(v => !v)}
              className={cn('w-full flex items-center gap-3 p-4 rounded-xl border transition-all text-left',
                createAlert ? 'border-teal bg-[var(--green-bg)]' : 'border-[var(--border)] hover:border-[var(--border-strong)] bg-[var(--bg-secondary)]')}>
              <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors', createAlert ? 'bg-teal/20' : 'bg-[var(--bg-tertiary)]')}>
                <Bell size={16} className={createAlert ? 'text-teal' : 'text-[var(--fg-tertiary)]'} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn('text-[12.5px] font-semibold', createAlert ? 'text-[var(--green)]' : 'text-[var(--fg)]')}>Create alert rule</p>
                <p className="text-[11px] text-[var(--fg-tertiary)]">
                  At the warn threshold, notify in-app{channels.get('email')?.deliverable ? ' and by email' : ' (email isn’t set up on this server)'}
                </p>
              </div>
              <div className={cn('w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all', createAlert ? 'bg-teal border-teal' : 'border-[var(--border)]')}>
                {createAlert && <Check size={11} className="text-white" />}
              </div>
            </button>
          )}

          {error && <p role="alert" className="text-[12px] text-[var(--red)] bg-[var(--red-bg)] border border-[var(--red)]/20 px-3 py-2 rounded-lg">{error}</p>}
        </div>
    </Dialog>
  )
}

/* ── AddAlertModal ── */
function AddAlertModal({ limit, orgId, onClose, onCreated, status }: {
  status:    ChannelMap
  limit:     LimitRow
  orgId:     string
  onClose:   () => void
  onCreated: (kind: 'limit_breach' | 'forecast') => void
}) {
  const [channels,  setChannels]  = useState(defaultChannels(status))
  const [threshold, setThreshold] = useState(limit.warnAt.toString())   // % of budget, or 'forecast'
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  async function handleCreate() {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/v1/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(threshold === 'forecast' ? {
          org_id:         orgId,
          project_id:     limit.scope === 'project' ? limit.scopeTargetId : null,
          name:           `${limit.scopeName} projected overspend`,
          trigger_type:   'forecast',
          condition:      'Projected to exceed budget this period',
          scope:          limit.scopeName,
          cooldown_hours: 24,
          channels,
        } : {
          org_id:         orgId,
          project_id:     limit.scope === 'project' ? limit.scopeTargetId : null,
          name:           `${limit.scopeName} budget alert`,
          trigger_type:   'limit_breach',
          condition:      `spend >= ${threshold}%`,
          scope:          limit.scopeName,
          threshold:      Number(threshold),
          cooldown_hours: 4,
          channels,
        }),
      })
      if (!res.ok) throw new Error(await readApiError(res))
      onCreated(threshold === 'forecast' ? 'forecast' : 'limit_breach')
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create alert')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title="Create alert for this budget"
      description={<>For <span className="font-semibold text-[var(--fg)]">{limit.scopeName}</span> · {PERIOD_LABEL[limit.period]} · {fmtUsd(limit.budgetUsd)} budget</>}
      footer={<>
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="button" onClick={handleCreate} disabled={saving} className="btn-primary disabled:opacity-40">
          {saving
            ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" aria-hidden="true" /> Creating…</>
            : <><Bell size={13} aria-hidden="true" /> Create alert rule</>}
        </button>
      </>}
    >

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
                { v: 'forecast',                  label: 'Projected over'                     },
              ].map(opt => (
                <button key={opt.v} onClick={() => setThreshold(opt.v)}
                  className={cn('flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all',
                    threshold === opt.v ? 'bg-white dark:bg-[#1E1E35] text-[var(--fg)] shadow-sm' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
                  {opt.label}
                </button>
              ))}
            </div>
            {threshold === 'forecast' && (
              <p className="text-[11px] text-[var(--fg-tertiary)] mt-2">
                Warns when the 14-day run-rate projects spend past this budget before the period ends — before the limit is actually hit.
              </p>
            )}
          </div>

          {/* Channels */}
          <div>
            <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Notify via</label>
            <div className="grid grid-cols-2 gap-2">
              {(['email', 'slack', 'webhook', 'inapp'] as const).map(ch => {
                const active = channels[ch]
                const labels: Record<string, string>  = { email: 'Email', slack: 'Slack', webhook: 'Webhook', inapp: 'In-app' }
                const colors: Record<string, string>  = { email: 'text-[var(--blue)] bg-[var(--blue-bg)]', slack: 'text-[#8B5CF6] bg-[#8B5CF6]/10', webhook: 'text-[var(--amber)] bg-[var(--amber-bg)]', inapp: 'text-teal bg-[var(--green-bg)]' }
                const ok = status.get(ch)?.deliverable ?? false
                return (
                  <button key={ch} type="button" role="checkbox" aria-checked={active}
                    aria-disabled={ch === 'inapp' || (!ok && !active)}
                    title={!ok ? status.get(ch)?.detail : undefined}
                    onClick={() => ch !== 'inapp' && (ok || active) && setChannels(prev => ({ ...prev, [ch]: !prev[ch] }))}
                    className={cn('flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[12px] font-semibold transition-all text-left',
                      active ? `${colors[ch]} border-current/30` : 'border-[var(--border)] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]',
                      (ch === 'inapp' || !ok) && 'cursor-not-allowed', !ok && !active && 'opacity-60')}>
                    {active ? <Check size={12} className="text-current" aria-hidden="true" /> : <span className="w-3 h-3 rounded border-2 border-[var(--border-strong)]" aria-hidden="true" />}
                    {labels[ch]}
                    {ch === 'inapp' && <span className="text-[9.5px] ml-auto opacity-80">always</span>}
                    {!ok && <span className="text-[9.5px] ml-auto">not set up</span>}
                  </button>
                )
              })}
            </div>
          </div>
          {error && <p role="alert" className="text-[12px] text-[var(--red)] bg-[var(--red-bg)] border border-[var(--red)]/20 px-3 py-2 rounded-lg">{error}</p>}
          <p className="text-[11px] text-[var(--fg-tertiary)]">
            Watches {limit.scope === 'project' ? 'this project’s budgets' : 'every budget in the org'} — the rule shows up on{' '}
            <Link href="/dashboard/alerts" className="font-semibold text-coral hover:underline">Alerts</Link>.
          </p>
        </div>
    </Dialog>
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
  role:          Role
  channels:      ChannelStatus[]
}

export function LimitsClient({ initialLimits, projects, teams, orgId, role, channels }: Props) {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const status       = new Map(channels.map(c => [c.id, c]))
  const canAlert     = can(role, 'alerts:write')
  const [limits,        setLimits]        = useState<LimitRow[]>(initialLimits)
  // Re-sync after router.refresh() (server recomputes spend + linked alerts).
  useEffect(() => { setLimits(initialLimits) }, [initialLimits])
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

  // ⌘K "New budget limit" → /dashboard/limits?new=1
  useEffect(() => {
    if (searchParams?.get('new') === '1' && can(role, 'limits:write')) {
      setEditTarget(null); setShowModal(true)
      router.replace('/dashboard/limits', { scroll: false })
    }
  }, [searchParams, role, router])

  async function handleToggle(id: string) {
    const limit = limits.find(l => l.id === id)
    if (!limit) return
    setToggling(id)
    try {
      const res = await fetch('/api/v1/limits', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: !limit.isActive }),
      })
      if (!res.ok) { showToast(await readApiError(res)); return }
      setLimits(prev => prev.map(l => l.id === id ? { ...l, isActive: !l.isActive } : l))
    } finally {
      setToggling(null)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/v1/limits?id=${encodeURIComponent(deleteId)}`, { method: 'DELETE' })
      if (!res.ok) { showToast(await readApiError(res)); return }
      setLimits(prev => prev.filter(l => l.id !== deleteId))
      showToast('Limit deleted')
    } finally {
      setDeleting(false)
      setDeleteId(null)
      setDeleteInput('')
    }
  }

  const filtered = scopeFilter === 'all' ? limits : limits.filter(l => l.scope === scopeFilter)

  // Normalise every period to a month so daily/weekly caps aren't summed as if monthly.
  const PER_MONTH: Record<LimitPeriod, number> = { daily: 30.44, weekly: 30.44 / 7, monthly: 1 }
  const totalBudget = limits.filter(l => l.isActive).reduce((s, l) => s + l.budgetUsd * PER_MONTH[l.period], 0)
  const atRisk      = limits.filter(l => { const s = getStatus(l); return s === 'warning' || s === 'throttled' }).length
  const blocked     = limits.filter(l => getStatus(l) === 'blocked').length
  const activeCount = limits.filter(l => l.isActive).length

  const deleteTarget = limits.find(l => l.id === deleteId)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Budget Limits</h2>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">Spend guardrails · warn → throttle → block pipeline</p>
        </div>
        {can(role, 'limits:write') && (
          <button type="button" onClick={() => { setEditTarget(null); setShowModal(true) }} className="btn-primary flex-shrink-0">
            <Plus size={14} aria-hidden="true" /> New limit
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: 'Budgets (≈ per month)', value: `${fmtUsd(totalBudget)}`, icon: Shield,        color: 'text-[var(--blue)]',  bg: 'bg-[var(--blue-bg)]'  },
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
          {can(role, 'limits:write') && (
            <button onClick={() => setShowModal(true)} className="btn-primary mt-5"><Plus size={13} /> New limit</button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(limit => (
            <LimitCard
              key={limit.id}
              limit={{ ...limit, isActive: toggling === limit.id ? !limit.isActive : limit.isActive }}
              onToggle={can(role, 'limits:write') ? handleToggle : () => {}}
              onDelete={can(role, 'limits:write') ? id => { setDeleteId(id); setDeleteInput('') } : () => {}}
              onEdit={can(role, 'limits:write') ? l => { setEditTarget(l); setShowModal(true) } : () => {}}
              onAddAlert={l => setAlertForLimit(l)}
              readOnly={!can(role, 'limits:write')}
              canAlert={canAlert}
            />
          ))}
        </div>
      )}

      {/* Info callout */}
      <div className="flex items-start gap-4 p-4 bg-[var(--blue-bg)] border border-[var(--blue)]/20 rounded-2xl">
        <Zap size={16} className="text-[var(--blue)] mt-0.5 flex-shrink-0" />
        <div className="text-[12px] text-[var(--blue)]">
          <span className="font-bold">How limits work: </span>
          Spend here counts everything captured — direct API/SDK usage and Claude Code /
          Codex / Gemini via <span className="font-semibold">tokenfin setup</span>.
          At <span className="font-semibold">Warn %</span>, alerts fire for all of it.
          <span className="font-semibold"> Throttle %</span> and <span className="font-semibold">Block %</span> only
          apply to direct API/SDK calls through <code className="font-mono">/api/v1/ingest</code> — TokenFin sits
          outside Claude Code / Codex / Gemini&apos;s request path by design, so it can warn about their
          usage but can&apos;t stop it.
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
          channels={status}
          canAlert={canAlert}
          onCreated={row => { setLimits(prev => [row, ...prev]); showToast('Limit created'); router.refresh() }}
          onUpdated={row => { setLimits(prev => prev.map(l => l.id === row.id ? row : l)); showToast('Limit updated') }}
        />
      )}

      {/* Alert modal */}
      {alertForLimit && (
        <AddAlertModal
          limit={alertForLimit}
          orgId={orgId}
          status={status}
          onClose={() => setAlertForLimit(null)}
          onCreated={kind => {
            showToast(`${kind === 'forecast' ? 'Forecast alert' : 'Alert'} created for ${alertForLimit.scopeName}`)
            router.refresh()
          }}
        />
      )}

      {/* Delete confirm */}
      {deleteId && deleteTarget && (
        <Dialog open bare ariaLabel="Delete limit" size="sm" onClose={() => setDeleteId(null)}>
          <div className="p-6 space-y-4">
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
              <input aria-label="Type delete to confirm" data-autofocus value={deleteInput} onChange={e => setDeleteInput(e.target.value)} placeholder="delete"
                className="w-full px-3 py-2 rounded-lg border border-[var(--red)]/30 text-[12.5px] bg-[var(--bg)] text-[var(--fg)] focus:outline-none focus:border-[var(--red)]" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setDeleteId(null)} className="btn-secondary flex-1">Cancel</button>
              <button disabled={deleteInput !== 'delete' || deleting} onClick={handleDelete}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--red)] text-white text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--red)]/90 transition-colors">
                <Trash2 size={13} aria-hidden="true" /> Delete limit
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Toast */}
      <div className={cn('fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-3 bg-[var(--fg)] text-[var(--bg)] rounded-2xl shadow-2xl text-[13px] font-semibold transition-all duration-300 z-50',
        toast ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none')}>
        <Check size={14} className="text-teal" /> {toast}
      </div>
    </div>
  )
}
