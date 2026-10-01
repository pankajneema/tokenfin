'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Shield, Plus, AlertTriangle, Ban, Bell, BellOff, BellPlus,
  Trash2, Pencil, PauseCircle, PlayCircle, MoreHorizontal, Check,
  Building2, FolderOpen, Users, User, Zap, Activity, TrendingUp, Cpu, Shuffle,
} from 'lucide-react'
import { cn, readApiError } from '@/lib/utils'
import { can, type Role } from '@/lib/rbac'
import { Dialog } from '@/components/ui/dialog'
import type { LimitRow, LimitScope, LimitPeriod, ScopeOption } from './page'
import type { ChannelStatus } from '../alerts/_types'
import { RoutesPanel, type RouteRow, type BlockRow } from '../analytics/quality-cost/_routes'
import { formatAmount, type Metric, type Basis, type AutoAction } from '@/lib/alerts/model-limits'

type ChannelMap = Map<ChannelStatus['id'], ChannelStatus>
/** Default channels for a new budget alert: in-app plus email only if the server can send it. */
const defaultChannels = (ch: ChannelMap) => ({ email: !!ch.get('email')?.deliverable, slack: false, webhook: false, inapp: true })


/* ── Helpers ─────────────────────────────────────────────────── */

type LimitStatus = 'healthy' | 'warning' | 'throttled' | 'blocked'

function getStatus(l: LimitRow): LimitStatus {
  if (!l.isActive) return 'healthy'
  const pct = l.budgetUsd > 0 ? (l.spentUsd / l.budgetUsd) * 100 : 0
  if (!l.legacyBudget) {
    // Per-model / token / request limits: notify → over (no ingest throttle/block).
    if (pct >= 100) return 'blocked'
    if (l.notifyAt != null && pct >= l.notifyAt) return 'warning'
    return 'healthy'
  }
  if (pct >= l.blockAt)    return 'blocked'
  if (pct >= l.throttleAt) return 'throttled'
  if (pct >= l.warnAt)     return 'warning'
  return 'healthy'
}

function fmtUsd(n: number) {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : n > 0 && n < 10 ? `$${n.toFixed(2)}` : `$${n.toFixed(0)}`
}
/** A limit amount / usage in its metric's units. */
function fmtAmt(l: { metric: Metric }, n: number) {
  return l.metric === 'cost_usd' ? fmtUsd(n) : formatAmount(l.metric, n)
}
const METRIC_LABEL: Record<Metric, string> = { cost_usd: 'Spend (USD)', tokens: 'Tokens', requests: 'Requests' }
const BASIS_LABEL: Record<Basis, string> = { all: 'All usage', metered: 'Metered API only', notional: 'Subscription (notional) only' }
const ACTION_LABEL: Record<AutoAction, string> = { none: 'Notify only', switch_model: 'Switch model', block_sdk: 'Block in SDKs' }
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Locale-independent (no hydration mismatch). */
function fmtWhen(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCDate()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
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
  healthy:   { label: 'OK',        color: 'text-teal',           bg: 'bg-[var(--green-bg)]', dot: 'bg-teal'           },
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
  // Legacy dollar budgets: warn / throttle. Every limit: the notify marker (90%).
  const markers = Array.from(new Set([
    ...(limit.legacyBudget ? [limit.warnAt, limit.throttleAt] : []),
    ...(limit.notifyAt != null && limit.notifyAt < 100 ? [limit.notifyAt] : []),
  ])).filter(t => t > 0 && t < 100).sort((a, b) => a - b)
  return (
    <div className="space-y-1.5">
      <div className="relative h-2 rounded-full bg-[var(--bg-tertiary)] overflow-visible">
        <div className={cn('absolute left-0 top-0 h-full rounded-full transition-all duration-500', fill)} style={{ width: `${pct}%` }} />
        {markers.map((t, i) => (
          <div key={i} className="absolute top-1/2 -translate-y-1/2 w-px h-3.5 bg-[var(--border-strong)]" style={{ left: `${t}%` }} />
        ))}
      </div>
      <div className="relative h-3">
        {markers.map((t, i) => (
          <span key={i} className="absolute text-[9.5px] text-[var(--fg-tertiary)] -translate-x-1/2" style={{ left: `${t}%` }}>{t}%</span>
        ))}
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
  const pct       = limit.budgetUsd > 0 ? (limit.spentUsd / limit.budgetUsd) * 100 : 0

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
              <p className="text-[13.5px] font-bold text-[var(--fg)] truncate">{limit.model ? <span className="font-mono">{limit.model}</span> : limit.scopeName}</p>
              {!limit.isActive && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]">Paused</span>}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={cn('text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md', sm.bg, sm.color)}>{sm.label}</span>
              <span className="text-[10.5px] text-[var(--fg-tertiary)]">·</span>
              <span className="text-[10.5px] text-[var(--fg-tertiary)]">{PERIOD_LABEL[limit.period]}</span>
              {limit.model && <><span className="text-[10.5px] text-[var(--fg-tertiary)]">·</span><span className="text-[10.5px] text-[var(--fg-tertiary)] truncate">{limit.scopeName}</span></>}
              {limit.basis !== 'all' && <><span className="text-[10.5px] text-[var(--fg-tertiary)]">·</span><span className="text-[10.5px] text-[var(--fg-tertiary)]">{limit.basis}</span></>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className={cn('flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-semibold', stm.bg, stm.color)}>
            <span className={cn('w-1.5 h-1.5 rounded-full', stm.dot)} />{!limit.legacyBudget && status === 'blocked' ? 'Over limit' : !limit.legacyBudget && status === 'warning' ? 'Near limit' : stm.label}
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
                    ...(canAlert && limit.scope !== 'member' && limit.legacyBudget ? [{ icon: BellPlus, label: 'Create alert for this budget', danger: false, fn: () => { onAddAlert(limit); setMenuOpen(false) } }] : []),
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
          <p className="text-[22px] font-bold text-[var(--fg)] leading-none">{limit.measurable ? fmtAmt(limit, limit.spentUsd) : '—'}</p>
          <p className="text-[11px] text-[var(--fg-tertiary)] mt-1">
            {limit.measurable
              ? <>of {fmtAmt(limit, limit.budgetUsd)} {limit.metric === 'cost_usd' ? 'budget' : 'limit'} · {pct.toFixed(1)}%</>
              : <>Not measurable — this member limit has no member. Recreate it and pick one.</>}
          </p>
        </div>
        {limit.state !== 'ok' && (
          <span data-testid="limit-state" className={cn('text-[10.5px] font-semibold px-2 py-1 rounded-full whitespace-nowrap',
            limit.state === 'action' ? 'bg-[var(--red-bg)] text-[var(--red)]' : 'bg-[var(--amber-bg)] text-[var(--amber)]')}>
            {limit.state === 'action' ? 'Action taken' : 'Notified'} this period
          </span>
        )}
      </div>

      <ThresholdBar limit={limit} />

      {limit.isActive && <ForecastRow limit={limit} />}

      {/* Footer */}
      <div className="pt-1 border-t border-[var(--border)] space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-[var(--fg-tertiary)]">
          {limit.notifyAt != null
            ? <span className="flex items-center gap-1"><Bell size={9} aria-hidden="true" />Notify {limit.notifyAt}% · {[limit.notifyChannels.inapp && 'in-app', limit.notifyChannels.email && 'email'].filter(Boolean).join(' + ') || 'no channel'}</span>
            : <span className="flex items-center gap-1"><BellOff size={9} aria-hidden="true" />No notification</span>}
          {limit.autoAction !== 'none' && (
            <span className="flex items-center gap-1 text-[var(--fg-secondary)]">
              {limit.autoAction === 'switch_model' ? <Shuffle size={9} aria-hidden="true" /> : <Ban size={9} aria-hidden="true" />}
              At {limit.autoActionAt}%: {limit.autoAction === 'switch_model' ? <>switch to <span className="font-mono">{limit.switchTo}</span></> : 'block in SDKs'}
            </span>
          )}
          {limit.resetsAt && <span>Resets {fmtWhen(limit.resetsAt)}</span>}
        </div>
        {limit.legacyBudget && (
          <div className="flex items-center gap-3 text-[10.5px] text-[var(--fg-tertiary)]">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)] inline-block" />Warn {limit.warnAt}%</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[var(--red)] inline-block" />Throttle {limit.throttleAt}%</span>
            <span className="flex items-center gap-1"><Ban size={9} />Block {limit.blockAt}%</span>
          </div>
        )}
        {limit.events.length > 0 && (
          <ul className="text-[10.5px] text-[var(--fg-tertiary)] space-y-0.5" aria-label="Last limit events">
            {limit.events.slice(0, 3).map((e, i) => (
              <li key={i}>
                <span className={cn('font-semibold', e.level === 'action' ? 'text-[var(--red)]' : 'text-[var(--amber)]')}>{e.level === 'action' ? (limit.autoAction === 'block_sdk' ? 'Blocked in SDKs' : 'Switched model') : 'Notified'}</span>
                {e.pct != null && <> at {Math.floor(e.pct)}%</>} · {fmtWhen(e.firedAt)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Alert rules watching this budget (same matching as the alert engine) */}
      {limit.legacyBudget && <div className="rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] px-3 py-2.5 space-y-1.5">
        {limit.scope === 'member' && !limit.userId ? (
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
      </div>}
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
  initial, projects, teams, members, models, orgId, onClose, onCreated, onUpdated, channels, canAlert,
}: {
  channels:   ChannelMap
  canAlert:   boolean
  initial?:   LimitRow | null
  projects:   ScopeOption[]
  teams:      ScopeOption[]
  members:    ScopeOption[]
  models:     string[]
  orgId:      string
  onClose:    () => void
  onCreated:  (l: LimitRow) => void
  onUpdated:  (l: LimitRow) => void
}) {
  const isEdit = !!initial

  const [scope,        setScope]        = useState<LimitScope>(initial?.scope ?? 'org')
  const [targetId,     setTargetId]     = useState<string>(initial?.scopeTargetId ?? '')
  const [period,       setPeriod]       = useState<LimitPeriod>(initial?.period ?? 'monthly')
  const [budget,       setBudget]       = useState(initial?.budgetUsd?.toString() ?? '')
  const [model,        setModel]        = useState(initial?.model ?? '')
  const [metric,       setMetric]       = useState<Metric>(initial?.metric ?? 'cost_usd')
  const [basis,        setBasis]        = useState<Basis>(initial?.basis ?? 'all')
  const [notifyOn,     setNotifyOn]     = useState(initial ? initial.notifyAt != null : true)
  const [notifyAt,     setNotifyAt]     = useState(initial?.notifyAt ?? 90)
  const [notifyCh,     setNotifyCh]     = useState(initial?.notifyChannels ?? { inapp: true, email: true })
  const [autoAction,   setAutoAction]   = useState<AutoAction>(initial?.autoAction ?? 'none')
  const [switchTo,     setSwitchTo]     = useState(initial?.switchTo ?? '')
  const [autoAt,       setAutoAt]       = useState(initial?.autoActionAt ?? 100)
  const [warnAt,       setWarnAt]       = useState(initial?.warnAt ?? 70)
  const [throttleAt,   setThrottleAt]   = useState(initial?.throttleAt ?? 90)
  const [blockAt,      setBlockAt]      = useState(initial?.blockAt ?? 100)
  const [createAlert,  setCreateAlert]  = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState<string | null>(null)

  const trimmedModel = model.trim()
  // Only a model-less dollar limit is a legacy budget (drives the SDK ingest throttle / block).
  const legacy = !trimmedModel && metric === 'cost_usd'

  const scopeOptions: ScopeOption[] =
    scope === 'project' ? projects :
    scope === 'team'    ? teams    :
    scope === 'member'  ? members  : []

  const scopeName = (() => {
    if (scope === 'org') return 'Entire org'
    return scopeOptions.find(o => o.id === targetId)?.name ?? ''
  })()

  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral'
  const labelCls = 'text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2'

  async function handleSave() {
    setSaving(true); setError(null)
    try {
      const common: Record<string, unknown> = {
        period,
        amount:          Number(budget),
        model:           trimmedModel || null,
        metric, basis,
        notify_at:       notifyOn ? notifyAt : null,
        notify_channels: notifyCh,
        auto_action:     trimmedModel ? autoAction : 'none',
        switch_to:       autoAction === 'switch_model' ? switchTo.trim() || null : null,
        auto_action_at:  autoAt,
        ...(legacy ? { warn_at: warnAt, throttle_at: throttleAt, block_at: blockAt } : {}),
      }
      let data: Record<string, unknown>
      if (isEdit) {
        const res = await fetch('/api/v1/limits', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: initial!.id, ...common }) })
        if (!res.ok) throw new Error(await readApiError(res))
        data = await res.json()
      } else {
        const body: Record<string, unknown> = { org_id: orgId, scope, ...common }
        if (scope === 'project') body.project_id = targetId || null
        if (scope === 'team')    body.team_id    = targetId || null
        if (scope === 'member')  body.user_id    = targetId || null
        const res = await fetch('/api/v1/limits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        if (!res.ok) throw new Error(await readApiError(res))
        data = await res.json()
      }
      const row: LimitRow = {
        ...(initial ?? {
          id: String(data.id), scope, scopeName, scopeTargetId: targetId || null, spentUsd: 0, isActive: true,
          hasAlert: false, hasForecastAlert: false, alertRules: [], forecast: null, userId: scope === 'member' ? targetId : null,
          measurable: true, resetsAt: null, periodKey: null, state: 'ok' as const, events: [],
        }),
        period:         data.period as LimitPeriod,
        budgetUsd:      Number(data.value ?? data.budget_usd),
        warnAt:         Number(data.warn_at), throttleAt: Number(data.throttle_at), blockAt: Number(data.block_at),
        model:          (data.model as string | null) ?? null,
        metric:         data.metric as Metric, basis: data.basis as Basis,
        notifyAt:       data.notify_at == null ? null : Number(data.notify_at),
        notifyChannels: (data.notify_channels as LimitRow['notifyChannels']) ?? notifyCh,
        autoAction:     data.auto_action as AutoAction, switchTo: (data.switch_to as string | null) ?? null,
        autoActionAt:   Number(data.auto_action_at ?? 100),
        legacyBudget:   !data.model && data.metric === 'cost_usd',
        // A new period / metric changes the numbers — the server refresh recomputes them.
        forecast:       isEdit && data.period === initial!.period && data.metric === initial!.metric ? initial!.forecast : null,
      }
      if (isEdit) onUpdated(row)
      else {
        // Optionally create an alert rule that watches this (legacy dollar) limit
        if (createAlert && legacy) {
          const ar = await fetch('/api/v1/alerts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              org_id: orgId, project_id: scope === 'project' ? targetId : null,
              name: `${scopeName} budget warn`, trigger_type: 'limit_breach', condition: `spend >= ${warnAt}%`,
              scope: scopeName, threshold: warnAt, cooldown_hours: 4, channels: defaultChannels(channels),
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

  const actionOk = autoAction !== 'switch_model' || (!!switchTo.trim() && switchTo.trim().toLowerCase() !== trimmedModel.toLowerCase())
  const valid = budget && Number(budget) > 0 && (scope === 'org' || isEdit || !!targetId) && (!trimmedModel || /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,119}$/.test(trimmedModel)) && actionOk
  const unit = metric === 'cost_usd' ? '$' : metric === 'tokens' ? 'tok' : 'req'

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? 'Edit limit' : 'New limit'}
      description="Per-model or whole-scope · notify at 90% · optional automatic model switch"
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
              <span className={labelCls}>Scope</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {SCOPE_OPTIONS.map(opt => {
                  const sm     = SCOPE_META[opt.value]
                  const Icon   = opt.icon
                  const active = scope === opt.value
                  return (
                    <button key={opt.value} type="button" aria-pressed={active} onClick={() => { setScope(opt.value); setTargetId('') }}
                      className={cn('flex flex-col items-center gap-1.5 py-3 rounded-xl border text-center transition-all',
                        active ? `${sm.bg} ${sm.color} border-current/30` : 'border-[var(--border)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]')}>
                      <Icon size={15} aria-hidden="true" />
                      <span className="text-[11px] font-semibold">{opt.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Scope target */}
          {!isEdit && scope !== 'org' && scopeOptions.length > 0 && (
            <div>
              <label htmlFor="limit-target" className={labelCls}>{scope === 'project' ? 'Project' : scope === 'team' ? 'Team' : 'Member'}</label>
              <select id="limit-target" value={targetId} onChange={e => setTargetId(e.target.value)} className={inputCls}>
                <option value="">Select {scope}…</option>
                {scopeOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
          {!isEdit && scope !== 'org' && scopeOptions.length === 0 && (
            <div className="text-[12px] text-[var(--amber)] bg-[var(--amber-bg)] p-3 rounded-xl">
              No {scope}s found. Create one first.
            </div>
          )}

          {/* Model + metric */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="limit-model" className={labelCls}><Cpu size={10} className="inline mr-1" aria-hidden="true" />Model (optional)</label>
              <input id="limit-model" list="limit-models" value={model} onChange={e => setModel(e.target.value)} placeholder="All models — or e.g. claude-opus" className={inputCls} />
              <datalist id="limit-models">{models.map(m => <option key={m} value={m} />)}</datalist>
              <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-1">An id or a prefix: <span className="font-mono">claude-opus</span> covers every Opus version.</p>
            </div>
            <div>
              <label htmlFor="limit-metric" className={labelCls}>Measure</label>
              <select id="limit-metric" value={metric} onChange={e => setMetric(e.target.value as Metric)} className={inputCls}>
                {(Object.keys(METRIC_LABEL) as Metric[]).map(m => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}
              </select>
              <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-1">Subscription users usually care about tokens or requests.</p>
            </div>
          </div>

          {/* Period + amount + basis */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <span className={labelCls}>Period</span>
              <div className="flex gap-1 p-1 bg-[var(--bg-secondary)] rounded-xl" role="group" aria-label="Period">
                {PERIOD_OPTIONS.map(p => (
                  <button key={p.value} type="button" aria-pressed={period === p.value} onClick={() => setPeriod(p.value)}
                    className={cn('flex-1 py-1.5 rounded-lg text-[11.5px] font-semibold transition-all',
                      period === p.value ? 'bg-white dark:bg-[#1E1E35] text-[var(--fg)] shadow-sm' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-1">Calendar day / ISO week / month in the workspace time zone.</p>
            </div>
            <div>
              <label htmlFor="limit-amount" className={labelCls}>Limit ({metric === 'cost_usd' ? 'USD' : metric})</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-[var(--fg-tertiary)] font-semibold" aria-hidden="true">{unit}</span>
                <input id="limit-amount" type="number" min={0} value={budget} onChange={e => setBudget(e.target.value)} placeholder={metric === 'cost_usd' ? '500' : metric === 'tokens' ? '20000000' : '5000'}
                  className={cn(inputCls, metric === 'cost_usd' ? 'pl-7' : 'pl-11')} />
              </div>
            </div>
          </div>
          <div>
            <label htmlFor="limit-basis" className={labelCls}>Counts</label>
            <select id="limit-basis" value={basis} onChange={e => setBasis(e.target.value as Basis)} className={inputCls}>
              {(Object.keys(BASIS_LABEL) as Basis[]).map(b => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}
            </select>
          </div>

          {/* Notify */}
          <div className="p-4 bg-[var(--bg-secondary)] rounded-xl space-y-3">
            <label className="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--fg)]">
              <input type="checkbox" checked={notifyOn} onChange={e => setNotifyOn(e.target.checked)} className="accent-[var(--accent)]" />
              <Bell size={13} aria-hidden="true" /> Notify once per period at
              <input type="number" aria-label="Notify at percent" min={1} max={1000} value={notifyAt} disabled={!notifyOn}
                onChange={e => setNotifyAt(Math.max(1, Math.min(1000, Number(e.target.value) || 90)))}
                className="w-16 px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[12.5px] disabled:opacity-50" />%
            </label>
            {notifyOn && (
              <div className="flex flex-wrap gap-3 pl-6 text-[12px] text-[var(--fg-secondary)]">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={notifyCh.inapp} onChange={e => setNotifyCh(c => ({ ...c, inapp: e.target.checked }))} className="accent-[var(--accent)]" /> In-app (bell)</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={notifyCh.email} onChange={e => setNotifyCh(c => ({ ...c, email: e.target.checked }))} className="accent-[var(--accent)]" />
                  Email{channels.get('email')?.deliverable ? '' : ' (email isn’t set up on this server)'}</label>
              </div>
            )}
            <p className="text-[10.5px] text-[var(--fg-tertiary)] pl-6">Owners and admins{scope === 'member' ? ' plus the member' : ''}; personal notification settings and quiet hours apply.</p>
          </div>

          {/* Auto action */}
          <div className="p-4 bg-[var(--bg-secondary)] rounded-xl space-y-3">
            <span className="text-[12.5px] font-semibold text-[var(--fg)] flex items-center gap-2"><Shuffle size={13} aria-hidden="true" /> Automatic action {trimmedModel ? '' : <span className="font-normal text-[var(--fg-tertiary)]">— pick a model first</span>}</span>
            <div className="flex flex-wrap gap-1 p-1 bg-[var(--bg)] rounded-xl" role="radiogroup" aria-label="Automatic action">
              {(Object.keys(ACTION_LABEL) as AutoAction[]).map(a => (
                <button key={a} type="button" role="radio" aria-checked={autoAction === a} disabled={!trimmedModel && a !== 'none'} onClick={() => setAutoAction(a)}
                  className={cn('flex-1 py-1.5 px-2 rounded-lg text-[11.5px] font-semibold transition-all disabled:opacity-40',
                    autoAction === a ? 'bg-white dark:bg-[#1E1E35] text-[var(--fg)] shadow-sm' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
                  {ACTION_LABEL[a]}
                </button>
              ))}
            </div>
            {trimmedModel && autoAction !== 'none' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {autoAction === 'switch_model' && (
                  <div>
                    <label htmlFor="limit-switch-to" className={labelCls}>Switch to</label>
                    <input id="limit-switch-to" list="limit-models" value={switchTo} onChange={e => setSwitchTo(e.target.value)} placeholder="e.g. claude-sonnet-4-6" className={inputCls} />
                  </div>
                )}
                <div>
                  <label htmlFor="limit-auto-at" className={labelCls}>At % of the limit</label>
                  <input id="limit-auto-at" type="number" min={1} max={1000} value={autoAt} onChange={e => setAutoAt(Math.max(1, Math.min(1000, Number(e.target.value) || 100)))} className={inputCls} />
                </div>
              </div>
            )}
            {trimmedModel && autoAction === 'switch_model' && (
              <p className="text-[10.5px] text-[var(--fg-tertiary)]">Activates a route <span className="font-mono">{trimmedModel}*</span> → <span className="font-mono">{switchTo || '…'}</span> that apps using the TokenFin SDK wrappers apply within 60 s, and queues the model change for Claude Code / OpenCode machines (Agents page). It stays on until an admin reverts it.</p>
            )}
            {trimmedModel && autoAction === 'block_sdk' && (
              <p className="text-[10.5px] text-[var(--fg-tertiary)]">Apps that enabled <span className="font-mono">enforcePolicy</span> in the TokenFin SDK refuse <span className="font-mono">{trimmedModel}</span> calls with a TokenFinPolicyError. Others are not affected.</p>
            )}
          </div>

          {/* Legacy thresholds: only a whole-scope dollar budget gates SDK ingest */}
          {legacy && (
            <div>
              <span className={cn(labelCls, 'mb-3')}>Ingest guardrails (dollar budgets)</span>
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
                    <input type="range" min={1} max={100} value={t.value} aria-label={`${t.label} threshold`}
                      onChange={e => t.set(Number(e.target.value))}
                      className="flex-1 accent-[var(--accent)] h-1.5" />
                    <div className="w-10 text-right">
                      <span className="text-[13px] font-bold text-[var(--fg)]">{t.value}%</span>
                    </div>
                  </div>
                ))}
                <p className="text-[10.5px] text-[var(--fg-tertiary)]">Throttle and block apply to org-wide monthly budgets on direct SDK / API ingest only.</p>
              </div>
            </div>
          )}

          {/* Create alert toggle (create only, legacy dollar budgets) */}
          {!isEdit && canAlert && legacy && scope !== 'member' && (
            <button type="button" role="checkbox" aria-checked={createAlert} onClick={() => setCreateAlert(v => !v)}
              className={cn('w-full flex items-center gap-3 p-4 rounded-xl border transition-all text-left',
                createAlert ? 'border-teal bg-[var(--green-bg)]' : 'border-[var(--border)] hover:border-[var(--border-strong)] bg-[var(--bg-secondary)]')}>
              <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors', createAlert ? 'bg-teal/20' : 'bg-[var(--bg-tertiary)]')}>
                <Bell size={16} className={createAlert ? 'text-teal' : 'text-[var(--fg-tertiary)]'} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn('text-[12.5px] font-semibold', createAlert ? 'text-[var(--green)]' : 'text-[var(--fg)]')}>Also create an alert rule at the warn threshold</p>
                <p className="text-[11px] text-[var(--fg-tertiary)]">
                  Repeats every 4 h while over (Slack / webhook too) — the notify setting above fires once per period.
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
  members:       ScopeOption[]
  /** models seen in the last 30 days (model picker) */
  models:        string[]
  timezone:      string
  routes:        RouteRow[]
  blocks:        BlockRow[]
  /** API keys that have fetched the SDK policy at least once */
  sdkKeys:       number
  orgId:         string
  role:          Role
  channels:      ChannelStatus[]
}

export function LimitsClient({ initialLimits, projects, teams, members, models, timezone, routes, blocks, sdkKeys, orgId, role, channels }: Props) {
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
  const totalBudget = limits.filter(l => l.isActive && l.metric === 'cost_usd' && !l.model).reduce((s, l) => s + l.budgetUsd * PER_MONTH[l.period], 0)
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
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">Per-model and whole-scope limits · notify at 90% · optional automatic model switch · periods in {timezone}</p>
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
          { label: 'At risk',             value: atRisk.toString(),                            icon: AlertTriangle, color: 'text-[var(--amber)]',  bg: 'bg-[var(--amber-bg)]' },
          { label: 'Over limit',          value: blocked.toString(),                           icon: Ban,           color: 'text-[var(--red)]',    bg: 'bg-[var(--red-bg)]'   },
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
          Each limit notifies once per period at its notify % (in-app + email). A limit on a model can also
          <span className="font-semibold"> switch</span> it to another model or <span className="font-semibold">block</span> it: apps using the
          TokenFin SDK wrappers apply that within 60 s, and Claude Code / OpenCode machines get a pending model change on the Agents page.
          <span className="font-semibold"> Throttle %</span> and <span className="font-semibold">Block %</span> apply only to org-wide monthly
          dollar budgets on direct API/SDK calls through <code className="font-mono">/api/v1/ingest</code> — TokenFin sits
          outside Claude Code / Codex / Gemini&apos;s request path by design.
        </div>
      </div>

      <RoutesPanel orgId={orgId} models={models} recommended={null} routes={routes} blocks={blocks}
        canWrite={can(role, 'limits:write')} title={`Model routes & blocks · ${sdkKeys} SDK key${sdkKeys === 1 ? '' : 's'} polling the policy`} />

      {/* Create/Edit modal */}
      {showModal && (
        <LimitModal
          initial={editTarget}
          projects={projects}
          teams={teams}
          members={members}
          models={models}
          orgId={orgId}
          onClose={() => { setShowModal(false); setEditTarget(null) }}
          channels={status}
          canAlert={canAlert}
          onCreated={row => { setLimits(prev => [row, ...prev]); showToast('Limit created'); router.refresh() }}
          onUpdated={row => { setLimits(prev => prev.map(l => l.id === row.id ? row : l)); showToast('Limit updated'); router.refresh() }}
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
