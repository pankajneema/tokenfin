'use client'
import { useState } from 'react'
import {
  Shield, Plus, AlertTriangle, Ban, Bell, BellOff, BellPlus,
  Trash2, Pencil, PauseCircle, PlayCircle, MoreHorizontal, Check, X,
  Building2, FolderOpen, Users, User, Zap, Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ── Types ─────────────────────────────────────────────────── */
type Scope   = 'org' | 'project' | 'team' | 'member'
type Period  = 'daily' | 'weekly' | 'monthly'
type LimitStatus = 'healthy' | 'warning' | 'throttled' | 'blocked'
interface DemoLimit {
  id: string
  scope: Scope
  scopeName: string
  period: Period
  budgetUsd: number
  spentUsd: number
  warnAt: number
  throttleAt: number
  blockAt: number
  isActive: boolean
  hasAlert: boolean
  lastBreachAt?: string
}

/* ── Demo data ─────────────────────────────────────────────── */
const DEMO_LIMITS: DemoLimit[] = [
  { id: '1', scope: 'org',     scopeName: 'Acme Corp',        period: 'monthly', budgetUsd: 5000,  spentUsd: 3420,  warnAt: 70, throttleAt: 90, blockAt: 100, isActive: true,  hasAlert: true },
  { id: '2', scope: 'project', scopeName: 'ChatBot Pro',       period: 'monthly', budgetUsd: 2000,  spentUsd: 1870,  warnAt: 70, throttleAt: 90, blockAt: 100, isActive: true,  hasAlert: true,  lastBreachAt: '2h ago' },
  { id: '3', scope: 'project', scopeName: 'Internal Tools',    period: 'monthly', budgetUsd: 500,   spentUsd: 125,   warnAt: 70, throttleAt: 90, blockAt: 100, isActive: true,  hasAlert: false },
  { id: '4', scope: 'team',    scopeName: 'AI Backend Team',   period: 'monthly', budgetUsd: 1000,  spentUsd: 890,   warnAt: 70, throttleAt: 90, blockAt: 100, isActive: true,  hasAlert: true,  lastBreachAt: '1d ago' },
  { id: '5', scope: 'member',  scopeName: 'Ravi Shankar',      period: 'monthly', budgetUsd: 200,   spentUsd: 205,   warnAt: 70, throttleAt: 90, blockAt: 100, isActive: true,  hasAlert: true,  lastBreachAt: '3h ago' },
  { id: '6', scope: 'project', scopeName: 'Data Pipeline',     period: 'daily',   budgetUsd: 100,   spentUsd: 28,    warnAt: 70, throttleAt: 90, blockAt: 100, isActive: false, hasAlert: false },
  { id: '7', scope: 'team',    scopeName: 'Frontend Team',     period: 'weekly',  budgetUsd: 300,   spentUsd: 48,    warnAt: 60, throttleAt: 85, blockAt: 100, isActive: true,  hasAlert: false },
]

/* ── Helpers ───────────────────────────────────────────────── */
function getStatus(limit: DemoLimit): LimitStatus {
  if (!limit.isActive) return 'healthy'
  const pct = (limit.spentUsd / limit.budgetUsd) * 100
  if (pct >= limit.blockAt)    return 'blocked'
  if (pct >= limit.throttleAt) return 'throttled'
  if (pct >= limit.warnAt)     return 'warning'
  return 'healthy'
}

function fmtUsd(n: number) {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`
}

const SCOPE_META: Record<Scope, { icon: React.ElementType; label: string; color: string; bg: string }> = {
  org:     { icon: Building2,  label: 'Org',     color: 'text-[var(--blue)]',  bg: 'bg-[var(--blue-bg)]' },
  project: { icon: FolderOpen, label: 'Project', color: 'text-[var(--accent)]', bg: 'bg-[var(--red-bg)]' },
  team:    { icon: Users,      label: 'Team',    color: 'text-[#8B5CF6]',       bg: 'bg-[#8B5CF6]/10' },
  member:  { icon: User,       label: 'Member',  color: 'text-teal',            bg: 'bg-[var(--green-bg)]' },
}

const PERIOD_LABEL: Record<Period, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }

const STATUS_META: Record<LimitStatus, { label: string; color: string; bg: string; dot: string }> = {
  healthy:   { label: 'Healthy',   color: 'text-teal',            bg: 'bg-[var(--green-bg)]',  dot: 'bg-teal' },
  warning:   { label: 'Warning',   color: 'text-[var(--amber)]',  bg: 'bg-[var(--amber-bg)]',  dot: 'bg-[var(--amber)]' },
  throttled: { label: 'Throttled', color: 'text-[var(--red)]',    bg: 'bg-[var(--red-bg)]',    dot: 'bg-[var(--red)]' },
  blocked:   { label: 'Blocked',   color: 'text-[var(--red)]',    bg: 'bg-[var(--red-bg)]',    dot: 'bg-[var(--red)]' },
}

/* ── Threshold Progress Bar ──────────────────────────────────── */
function ThresholdBar({ limit }: { limit: DemoLimit }) {
  const pct    = Math.min((limit.spentUsd / limit.budgetUsd) * 100, 100)
  const status = getStatus(limit)

  const fillColor =
    status === 'blocked'   ? 'bg-[var(--red)]' :
    status === 'throttled' ? 'bg-[var(--red)]' :
    status === 'warning'   ? 'bg-[var(--amber)]' :
                             'bg-teal'

  return (
    <div className="space-y-1.5">
      {/* Bar */}
      <div className="relative h-2 rounded-full bg-[var(--bg-tertiary)] overflow-visible">
        {/* Fill */}
        <div
          className={cn('absolute left-0 top-0 h-full rounded-full transition-all duration-500', fillColor)}
          style={{ width: `${pct}%` }}
        />
        {/* Threshold markers */}
        {[limit.warnAt, limit.throttleAt].map((t, i) => (
          <div
            key={i}
            className="absolute top-1/2 -translate-y-1/2 w-px h-3.5 bg-[var(--border-strong)]"
            style={{ left: `${t}%` }}
          />
        ))}
      </div>

      {/* Labels */}
      <div className="relative h-3">
        <span className="absolute text-[9.5px] text-[var(--fg-tertiary)] -translate-x-1/2" style={{ left: `${limit.warnAt}%` }}>
          {limit.warnAt}%
        </span>
        <span className="absolute text-[9.5px] text-[var(--fg-tertiary)] -translate-x-1/2" style={{ left: `${limit.throttleAt}%` }}>
          {limit.throttleAt}%
        </span>
      </div>
    </div>
  )
}

/* ── Limit Card ─────────────────────────────────────────────── */
function LimitCard({
  limit,
  onToggle,
  onDelete,
  onEdit,
  onAddAlert,
}: {
  limit:      DemoLimit
  onToggle:   (id: string) => void
  onDelete:   (id: string) => void
  onEdit:     (limit: DemoLimit) => void
  onAddAlert: (limit: DemoLimit) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const status  = getStatus(limit)
  const sm      = SCOPE_META[limit.scope]
  const stm     = STATUS_META[status]
  const ScopeIcon = sm.icon
  const pct     = Math.min((limit.spentUsd / limit.budgetUsd) * 100, 100)

  return (
    <div className={cn(
      'bg-white dark:bg-[#141428] border rounded-2xl p-5 space-y-4 transition-all',
      !limit.isActive ? 'opacity-60 border-[var(--border)]' :
      status === 'blocked'   ? 'border-[var(--red)]/40 shadow-[0_0_0_1px_var(--red-bg)]' :
      status === 'throttled' ? 'border-[var(--red)]/30' :
      status === 'warning'   ? 'border-[var(--amber)]/40' :
                               'border-[var(--border)]',
    )}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Scope icon */}
          <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', sm.bg)}>
            <ScopeIcon size={16} className={sm.color} />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[13.5px] font-bold text-[var(--fg)] truncate">{limit.scopeName}</p>
              {!limit.isActive && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]">Paused</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={cn('text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md', sm.bg, sm.color)}>
                {sm.label}
              </span>
              <span className="text-[10.5px] text-[var(--fg-tertiary)]">·</span>
              <span className="text-[10.5px] text-[var(--fg-tertiary)]">{PERIOD_LABEL[limit.period]}</span>
            </div>
          </div>
        </div>

        {/* Right: status + menu */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className={cn('flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-semibold', stm.bg, stm.color)}>
            <span className={cn('w-1.5 h-1.5 rounded-full', stm.dot)} />
            {stm.label}
          </div>

          <div className="relative">
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] transition-colors"
            >
              <MoreHorizontal size={15} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-[9]" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-9 w-48 bg-white dark:bg-[#1E1E35] border border-[var(--border)] rounded-xl shadow-2xl z-10 p-1">
                  {([
                    { icon: Pencil,      label: 'Edit limit',    danger: false, fn: () => { onEdit(limit); setMenuOpen(false) } },
                    { icon: limit.isActive ? PauseCircle : PlayCircle, label: limit.isActive ? 'Pause limit' : 'Resume limit', danger: false, fn: () => { onToggle(limit.id); setMenuOpen(false) } },
                    { icon: BellPlus,   label: 'Add alert rule', danger: false, fn: () => { onAddAlert(limit); setMenuOpen(false) } },
                    { icon: Trash2,     label: 'Delete limit',   danger: true,  fn: () => { onDelete(limit.id); setMenuOpen(false) } },
                  ] as { icon: React.ElementType; label: string; danger: boolean; fn: () => void }[]).map((item, i) => (
                    <button
                      key={i}
                      onClick={item.fn}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12.5px] font-medium text-left transition-colors',
                        item.danger
                          ? 'text-[var(--red)] hover:bg-[var(--red-bg)]'
                          : 'text-[var(--fg)] hover:bg-[var(--bg-hover)]',
                      )}
                    >
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

      {/* Spend numbers */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[22px] font-bold text-[var(--fg)] leading-none">{fmtUsd(limit.spentUsd)}</p>
          <p className="text-[11px] text-[var(--fg-tertiary)] mt-1">of {fmtUsd(limit.budgetUsd)} budget · {pct.toFixed(1)}%</p>
        </div>
        {limit.lastBreachAt && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--red)]">
            <AlertTriangle size={11} />
            Breach {limit.lastBreachAt}
          </div>
        )}
      </div>

      {/* Progress bar */}
      <ThresholdBar limit={limit} />

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-[var(--border)]">
        {/* Threshold summary */}
        <div className="flex items-center gap-3 text-[10.5px] text-[var(--fg-tertiary)]">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)] inline-block" />
            Warn {limit.warnAt}%
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)] inline-block" />
            Throttle {limit.throttleAt}%
          </span>
          <span className="flex items-center gap-1">
            <Ban size={9} />
            Block {limit.blockAt}%
          </span>
        </div>
        {/* Alert indicator */}
        <button className={cn(
          'flex items-center gap-1 text-[10.5px] font-medium transition-colors',
          limit.hasAlert
            ? 'text-teal hover:text-[var(--green)]'
            : 'text-[var(--fg-tertiary)] hover:text-[var(--fg)]',
        )}>
          {limit.hasAlert ? <Bell size={11} /> : <BellOff size={11} />}
          {limit.hasAlert ? 'Alert on' : 'No alert'}
        </button>
      </div>
    </div>
  )
}

/* ── Create / Edit Modal ─────────────────────────────────────── */
const SCOPE_OPTIONS: { value: Scope; icon: React.ElementType; label: string; desc: string }[] = [
  { value: 'org',     icon: Building2,  label: 'Org',     desc: 'Entire organisation'  },
  { value: 'project', icon: FolderOpen, label: 'Project', desc: 'Single project'       },
  { value: 'team',    icon: Users,      label: 'Team',    desc: 'One team'             },
  { value: 'member',  icon: User,       label: 'Member',  desc: 'Individual user'      },
]

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'daily',   label: 'Daily'   },
  { value: 'weekly',  label: 'Weekly'  },
  { value: 'monthly', label: 'Monthly' },
]

function LimitModal({
  initial,
  onClose,
  onSave,
}: {
  initial?: DemoLimit | null
  onClose: () => void
  onSave: (data: Partial<DemoLimit>) => void
}) {
  const [scope,      setScope]      = useState<Scope>(initial?.scope ?? 'project')
  const [scopeName,  setScopeName]  = useState(initial?.scopeName ?? '')
  const [period,     setPeriod]     = useState<Period>(initial?.period ?? 'monthly')
  const [budget,     setBudget]     = useState(initial?.budgetUsd?.toString() ?? '')
  const [warnAt,     setWarnAt]     = useState(initial?.warnAt ?? 70)
  const [throttleAt, setThrottleAt] = useState(initial?.throttleAt ?? 90)
  const [blockAt,    setBlockAt]    = useState(initial?.blockAt ?? 100)
  const [createAlert,setCreateAlert]= useState(false)
  const [saving,     setSaving]     = useState(false)

  async function handleSave() {
    setSaving(true)
    await new Promise(r => setTimeout(r, 600))
    const resolvedName = scopeName || (SCOPE_OPTIONS.find(o => o.value === scope)?.label ?? scope)
    onSave({ scope, scopeName: resolvedName, period, budgetUsd: Number(budget), warnAt, throttleAt, blockAt, hasAlert: createAlert || (initial?.hasAlert ?? false) })
    setSaving(false)
    onClose()
  }

  const isEdit = !!initial
  const valid  = budget && Number(budget) > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[520px] bg-white dark:bg-[#141428] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-[15px] font-bold text-[var(--fg)]">{isEdit ? 'Edit limit' : 'New budget limit'}</h2>
            <p className="text-[12px] text-[var(--fg-tertiary)] mt-0.5">Set spend guardrails with warn → throttle → block thresholds</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Scope tiles */}
          <div>
            <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Scope</label>
            <div className="grid grid-cols-4 gap-2">
              {SCOPE_OPTIONS.map(opt => {
                const Icon    = opt.icon
                const sm      = SCOPE_META[opt.value]
                const active  = scope === opt.value
                return (
                  <button
                    key={opt.value}
                    onClick={() => setScope(opt.value)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 py-3 rounded-xl border text-center transition-all',
                      active
                        ? `${sm.bg} ${sm.color} border-current/30`
                        : 'border-[var(--border)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]',
                    )}
                  >
                    <Icon size={15} />
                    <span className="text-[11px] font-semibold">{opt.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Scope target */}
          {scope !== 'org' && (
            <div>
              <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">
                {scope === 'project' ? 'Project' : scope === 'team' ? 'Team' : 'Member'}
              </label>
              <select
                value={scopeName}
                onChange={e => setScopeName(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral"
              >
                <option value="">Select {scope}…</option>
                {scope === 'project' && ['ChatBot Pro','Internal Tools','Data Pipeline'].map(p => <option key={p}>{p}</option>)}
                {scope === 'team'    && ['AI Backend Team','Frontend Team','Data Science'].map(t => <option key={t}>{t}</option>)}
                {scope === 'member'  && ['Ravi Shankar','Priya Patel','Alex Chen'].map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
          )}

          {/* Period + Budget row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Period</label>
              <div className="flex gap-1 p-1 bg-[var(--bg-secondary)] rounded-xl">
                {PERIOD_OPTIONS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => setPeriod(p.value)}
                    className={cn(
                      'flex-1 py-1.5 rounded-lg text-[11.5px] font-semibold transition-all',
                      period === p.value
                        ? 'bg-white dark:bg-[#1E1E35] text-[var(--fg)] shadow-sm'
                        : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Budget (USD)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[var(--fg-tertiary)] font-semibold">$</span>
                <input
                  type="number"
                  value={budget}
                  onChange={e => setBudget(e.target.value)}
                  placeholder="500"
                  className="w-full pl-7 pr-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral"
                />
              </div>
            </div>
          </div>

          {/* Thresholds */}
          <div>
            <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-3">Thresholds</label>
            <div className="space-y-3 p-4 bg-[var(--bg-secondary)] rounded-xl">
              {[
                { label: 'Warn',     value: warnAt,     set: setWarnAt,     color: 'text-[var(--amber)]', desc: 'Send alert' },
                { label: 'Throttle', value: throttleAt, set: setThrottleAt, color: 'text-[var(--red)]',   desc: 'Rate-limit calls' },
                { label: 'Block',    value: blockAt,    set: setBlockAt,    color: 'text-[var(--red)]',   desc: 'Reject all calls' },
              ].map(t => (
                <div key={t.label} className="flex items-center gap-3">
                  <div className="w-[72px] text-right">
                    <p className={cn('text-[12px] font-bold', t.color)}>{t.label}</p>
                    <p className="text-[9.5px] text-[var(--fg-tertiary)]">{t.desc}</p>
                  </div>
                  <input
                    type="range" min={1} max={100} value={t.value}
                    onChange={e => t.set(Number(e.target.value))}
                    className="flex-1 accent-[var(--accent)] h-1.5"
                  />
                  <div className="w-10 text-right">
                    <span className="text-[13px] font-bold text-[var(--fg)]">{t.value}%</span>
                  </div>
                </div>
              ))}

              {/* Preview bar */}
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

          {/* Alert integration */}
          {!isEdit && (
            <button
              onClick={() => setCreateAlert(v => !v)}
              className={cn(
                'w-full flex items-center gap-3 p-4 rounded-xl border transition-all text-left',
                createAlert
                  ? 'border-teal bg-[var(--green-bg)]'
                  : 'border-[var(--border)] hover:border-[var(--border-strong)] bg-[var(--bg-secondary)]',
              )}
            >
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
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!valid || saving}
            className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving
              ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Saving…</>
              : <><Check size={13} /> {isEdit ? 'Save changes' : 'Create limit'}</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Add Alert Modal (triggered from a limit card) ──────────── */
function AddAlertModal({ limit, onClose, onCreated }: {
  limit:     DemoLimit
  onClose:   () => void
  onCreated: (scopeName: string) => void
}) {
  const [channels, setChannels] = useState<('email'|'inapp')[]>(['email', 'inapp'])
  const [threshold, setThreshold] = useState(limit.warnAt.toString())
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    setSaving(true)
    await new Promise(r => setTimeout(r, 600))
    onCreated(limit.scopeName)
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[440px] bg-white dark:bg-[#141428] rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-[15px] font-bold text-[var(--fg)]">Add alert rule</h2>
            <p className="text-[12px] text-[var(--fg-tertiary)] mt-0.5">
              For <span className="font-semibold text-[var(--fg)]">{limit.scopeName}</span> · {PERIOD_LABEL[limit.period]} · ${limit.budgetUsd.toLocaleString()} budget
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)]">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Pre-filled context */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
            <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', SCOPE_META[limit.scope].bg)}>
              {(() => { const Icon = SCOPE_META[limit.scope].icon; return <Icon size={14} className={SCOPE_META[limit.scope].color} /> })()}
            </div>
            <div className="text-[12px]">
              <p className="font-semibold text-[var(--fg)]">{limit.scopeName}</p>
              <p className="text-[var(--fg-tertiary)]">Budget: ${limit.budgetUsd.toLocaleString()} / {PERIOD_LABEL[limit.period].toLowerCase()}</p>
            </div>
          </div>

          {/* Trigger threshold */}
          <div>
            <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Fire alert when spend reaches</label>
            <div className="flex gap-1 p-1 bg-[var(--bg-secondary)] rounded-xl">
              {[
                { v: limit.warnAt.toString(),     label: `${limit.warnAt}% · Warn`     },
                { v: limit.throttleAt.toString(), label: `${limit.throttleAt}% · Throttle` },
                { v: '100',                        label: '100% · Block'                 },
              ].map(opt => (
                <button
                  key={opt.v}
                  onClick={() => setThreshold(opt.v)}
                  className={cn(
                    'flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all',
                    threshold === opt.v
                      ? 'bg-white dark:bg-[#1E1E35] text-[var(--fg)] shadow-sm'
                      : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]',
                  )}
                >
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
                const active = channels.includes(ch as 'email'|'inapp')
                const labels: Record<string, string> = { email: 'Email', slack: 'Slack', webhook: 'Webhook', inapp: 'In-app' }
                const colors: Record<string, string> = { email: 'text-[var(--blue)] bg-[var(--blue-bg)]', slack: 'text-[#8B5CF6] bg-[#8B5CF6]/10', webhook: 'text-[var(--amber)] bg-[var(--amber-bg)]', inapp: 'text-teal bg-[var(--green-bg)]' }
                return (
                  <button
                    key={ch}
                    onClick={() => {
                      if (ch === 'inapp') return
                      setChannels(prev => prev.includes(ch as 'email') ? prev.filter(c => c !== ch) : [...prev, ch as 'email'])
                    }}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[12px] font-semibold transition-all',
                      active ? `${colors[ch]} border-current/30` : 'border-[var(--border)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)]',
                      ch === 'inapp' && 'opacity-70 cursor-default',
                    )}
                  >
                    {active ? <Check size={12} className="text-current" /> : <span className="w-3 h-3 rounded border-2 border-[var(--border-strong)]" />}
                    {labels[ch]}
                    {ch === 'inapp' && <span className="text-[9.5px] ml-auto opacity-70">always</span>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="btn-primary disabled:opacity-40"
          >
            {saving
              ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Creating…</>
              : <><Bell size={13} /> Create alert rule</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Page ───────────────────────────────────────────────────── */
export default function LimitsPage() {
  const [limits,       setLimits]       = useState<DemoLimit[]>(DEMO_LIMITS)
  const [scopeFilter,  setScopeFilter]  = useState<Scope | 'all'>('all')
  const [showModal,    setShowModal]    = useState(false)
  const [editTarget,   setEditTarget]   = useState<DemoLimit | null>(null)
  const [deleteId,     setDeleteId]     = useState<string | null>(null)
  const [deleteInput,  setDeleteInput]  = useState('')
  const [alertForLimit,setAlertForLimit]= useState<DemoLimit | null>(null)
  const [toast,        setToast]        = useState('')

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  function handleSave(data: Partial<DemoLimit>) {
    if (editTarget) {
      setLimits(prev => prev.map(l => l.id === editTarget.id ? { ...l, ...data } : l))
      showToast('Limit updated')
    } else {
      const newLimit: DemoLimit = {
        id: Date.now().toString(), isActive: true, spentUsd: 0,
        lastBreachAt: undefined, ...data,
      } as DemoLimit
      setLimits(prev => [...prev, newLimit])
      showToast('Limit created')
    }
    setEditTarget(null)
  }

  function handleToggle(id: string) {
    setLimits(prev => prev.map(l => l.id === id ? { ...l, isActive: !l.isActive } : l))
  }

  function confirmDelete() {
    setLimits(prev => prev.filter(l => l.id !== deleteId))
    setDeleteId(null)
    setDeleteInput('')
    showToast('Limit deleted')
  }

  const filtered = scopeFilter === 'all' ? limits : limits.filter(l => l.scope === scopeFilter)

  /* Stats */
  const totalBudget   = limits.filter(l => l.isActive).reduce((s, l) => s + l.budgetUsd, 0)
  const atRisk        = limits.filter(l => { const s = getStatus(l); return s === 'warning' || s === 'throttled' }).length
  const blocked       = limits.filter(l => getStatus(l) === 'blocked').length
  const activeCount   = limits.filter(l => l.isActive).length

  return (
    <div className="space-y-6 max-w-[1100px]">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Budget Limits</h1>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">
            Spend guardrails · warn → throttle → block pipeline
          </p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setShowModal(true) }}
          className="btn-primary flex-shrink-0"
        >
          <Plus size={14} /> New limit
        </button>
      </div>

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total budget capped', value: `$${(totalBudget / 1000).toFixed(1)}k / mo`, icon: Shield,        color: 'text-[var(--blue)]',  bg: 'bg-[var(--blue-bg)]'  },
          { label: 'Active limits',        value: activeCount.toString(),                      icon: Activity,      color: 'text-teal',            bg: 'bg-[var(--green-bg)]' },
          { label: 'At risk (>70%)',        value: atRisk.toString(),                           icon: AlertTriangle, color: 'text-[var(--amber)]',  bg: 'bg-[var(--amber-bg)]' },
          { label: 'Blocked scopes',       value: blocked.toString(),                          icon: Ban,           color: 'text-[var(--red)]',    bg: 'bg-[var(--red-bg)]'   },
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

      {/* ── Scope filter ── */}
      <div className="flex items-center gap-2">
        {([['all', 'All'], ['org','Org'], ['project','Project'], ['team','Team'], ['member','Member']] as const).map(([v, label]) => {
          const active = scopeFilter === v
          const sm     = v !== 'all' ? SCOPE_META[v as Scope] : null
          const count  = v === 'all' ? limits.length : limits.filter(l => l.scope === v).length
          return (
            <button
              key={v}
              onClick={() => setScopeFilter(v as Scope | 'all')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[12.5px] font-semibold transition-all',
                active
                  ? 'bg-[var(--fg)] text-[var(--bg)] border-[var(--fg)]'
                  : 'border-[var(--border)] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]',
              )}
            >
              {sm && <sm.icon size={11} />}
              {label}
              <span className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-md font-semibold',
                active
                  ? 'bg-white/20 text-[var(--bg)]'
                  : 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]',
              )}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Limit cards grid ── */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl py-20 text-center">
          <Shield size={36} className="text-[var(--fg-tertiary)] mx-auto mb-4" />
          <p className="text-[14px] font-semibold text-[var(--fg)]">No limits for this scope</p>
          <p className="text-[12.5px] text-[var(--fg-secondary)] mt-1">Create a budget limit to add spend guardrails</p>
          <button onClick={() => setShowModal(true)} className="btn-primary mt-5">
            <Plus size={13} /> New limit
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(limit => (
            <LimitCard
              key={limit.id}
              limit={limit}
              onToggle={handleToggle}
              onDelete={id => { setDeleteId(id); setDeleteInput('') }}
              onEdit={l => { setEditTarget(l); setShowModal(true) }}
              onAddAlert={l => setAlertForLimit(l)}
            />
          ))}
        </div>
      )}

      {/* ── How thresholds work callout ── */}
      <div className="flex items-start gap-4 p-4 bg-[var(--blue-bg)] border border-[var(--blue)]/20 rounded-2xl">
        <Zap size={16} className="text-[var(--blue)] mt-0.5 flex-shrink-0" />
        <div className="text-[12px] text-[var(--blue)]">
          <span className="font-bold">How limits work: </span>
          When spend hits <span className="font-semibold">Warn %</span>, alerts fire.
          At <span className="font-semibold">Throttle %</span>, API responses are rate-limited to 10% of normal quota.
          At <span className="font-semibold">Block %</span>, all API calls are rejected until the period resets or the budget is increased.
        </div>
      </div>

      {/* ── Create / Edit modal ── */}
      {showModal && (
        <LimitModal
          initial={editTarget}
          onClose={() => { setShowModal(false); setEditTarget(null) }}
          onSave={handleSave}
        />
      )}

      {/* ── Add alert for limit modal ── */}
      {alertForLimit && (
        <AddAlertModal
          limit={alertForLimit}
          onClose={() => setAlertForLimit(null)}
          onCreated={scopeName => {
            setLimits(prev => prev.map(l => l.id === alertForLimit.id ? { ...l, hasAlert: true } : l))
            showToast(`Alert rule created for ${scopeName}`)
          }}
        />
      )}

      {/* ── Delete confirm ── */}
      {deleteId && (() => {
        const target = limits.find(l => l.id === deleteId)
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setDeleteId(null)} />
            <div className="relative w-full max-w-[400px] bg-white dark:bg-[#141428] rounded-2xl shadow-2xl p-6 space-y-4">
              <div className="w-10 h-10 rounded-2xl bg-[var(--red-bg)] flex items-center justify-center">
                <Trash2 size={18} className="text-[var(--red)]" />
              </div>
              <div>
                <h3 className="text-[15px] font-bold text-[var(--fg)]">Delete limit?</h3>
                <p className="text-[12.5px] text-[var(--fg-secondary)] mt-1">
                  <span className="font-semibold text-[var(--fg)]">{target?.scopeName}</span> will have no spend cap after deletion.
                </p>
              </div>
              <div className="p-3 bg-[var(--red-bg)] rounded-xl">
                <p className="text-[11.5px] text-[var(--fg-secondary)] mb-2">
                  Type <span className="font-mono font-bold text-[var(--fg)]">delete</span> to confirm
                </p>
                <input
                  value={deleteInput}
                  onChange={e => setDeleteInput(e.target.value)}
                  placeholder="delete"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--red)]/30 text-[12.5px] bg-[var(--bg)] text-[var(--fg)] focus:outline-none focus:border-[var(--red)]"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setDeleteId(null)} className="btn-secondary flex-1">Cancel</button>
                <button
                  disabled={deleteInput !== 'delete'}
                  onClick={confirmDelete}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--red)] text-white text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--red)]/90 transition-colors"
                >
                  <Trash2 size={13} /> Delete limit
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Toast ── */}
      <div className={cn(
        'fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-3 bg-[var(--fg)] text-[var(--bg)] rounded-2xl shadow-2xl text-[13px] font-semibold transition-all duration-300 z-50',
        toast ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none',
      )}>
        <Check size={14} className="text-teal" /> {toast}
      </div>
    </div>
  )
}
