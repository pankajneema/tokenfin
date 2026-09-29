'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Bell, Plus, Zap, Mail, AlertTriangle, Check, Trash2,
  Clock, CheckCircle2, XCircle, Shield,
  MoreHorizontal, Activity, Webhook, ArrowRight,
  Search, RefreshCw, Link2, Pencil, Copy, PlayCircle, Moon,
} from 'lucide-react'
import { cn, readApiError } from '@/lib/utils'
import { TimeAgo, relTime } from '@/components/ui/time-ago'
import { Dialog } from '@/components/ui/dialog'
import { can, type Role } from '@/lib/rbac'
import type { AlertRuleRow, AlertHistoryRow, TriggerType, AnomalyScope, ChannelStatus, AlertChannelId, ProjectOption } from './_types'

/* ── Local types ── */
type AlertChannel    = AlertChannelId
type PageTab         = 'rules' | 'history' | 'channels'
type HistorySeverity = 'info' | 'warning' | 'critical'

const CHANNEL_INFO: Record<AlertChannel, { label: string; desc: string; icon: React.ElementType }> = {
  inapp:   { label: 'In-app',  desc: 'Notification bell in the dashboard (always on)', icon: Bell },
  email:   { label: 'Email',   desc: 'Emailed to the organization’s owners and admins', icon: Mail },
  slack:   { label: 'Slack',   desc: 'Posted to a Slack channel via incoming webhook', icon: Zap },
  webhook: { label: 'Webhook', desc: 'JSON POST to your HTTPS endpoint',               icon: Webhook },
}

/** Channels users ask for that TokenFin does not deliver yet — shown disabled, never selectable. */
const COMING_SOON = ['Microsoft Teams', 'PagerDuty', 'SMS']

/* ── Meta maps ── */
const TRIGGER_META: Record<TriggerType, { label: string; color: string; bg: string }> = {
  threshold:    { label: 'Threshold',    color: 'text-[var(--amber)]', bg: 'bg-[var(--amber-bg)]' },
  anomaly:      { label: 'Anomaly',      color: 'text-[#8B5CF6]',      bg: 'bg-[#8B5CF6]/10'      },
  limit_breach: { label: 'Limit breach', color: 'text-[var(--red)]',   bg: 'bg-[var(--red-bg)]'   },
  member:       { label: 'Member spend', color: 'text-teal',            bg: 'bg-[var(--green-bg)]' },
  forecast:     { label: 'Forecast',     color: 'text-[var(--blue)]',  bg: 'bg-[var(--blue-bg)]'  },
}

const ANOMALY_SCOPE_META: Record<AnomalyScope, { label: string; desc: string }> = {
  org:     { label: 'Whole org',   desc: 'Total daily spend' },
  project: { label: 'Per project', desc: 'Each project vs its own baseline' },
  member:  { label: 'Per member',  desc: 'Each person vs their own baseline' },
  model:   { label: 'Per model',   desc: 'Each model vs its own baseline' },
}

const CHANNEL_META: Record<AlertChannel, { label: string; color: string; bg: string }> = {
  email:   { label: 'Email',   color: 'text-[var(--blue)]',  bg: 'bg-[var(--blue-bg)]'  },
  slack:   { label: 'Slack',   color: 'text-[#8B5CF6]',      bg: 'bg-[#8B5CF6]/10'      },
  webhook: { label: 'Webhook', color: 'text-[var(--amber)]', bg: 'bg-[var(--amber-bg)]' },
  inapp:   { label: 'In-app',  color: 'text-teal',            bg: 'bg-[var(--green-bg)]' },
}

const SEVERITY_META: Record<HistorySeverity, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  info:     { icon: CheckCircle2,  color: 'text-teal',           bg: 'bg-[var(--green-bg)]', label: 'Info'     },
  warning:  { icon: AlertTriangle, color: 'text-[var(--amber)]', bg: 'bg-[var(--amber-bg)]', label: 'Warning'  },
  critical: { icon: XCircle,       color: 'text-[var(--red)]',   bg: 'bg-[var(--red-bg)]',   label: 'Critical' },
}


function severityFromType(type: string): HistorySeverity {
  if (type.includes('critical') || type.includes('block')) return 'critical'
  if (type.includes('warn') || type.includes('alert'))     return 'warning'
  return 'info'
}

function activeChannels(ch: AlertRuleRow['channels']): AlertChannel[] {
  const out: AlertChannel[] = []
  if (ch.email)   out.push('email')
  if (ch.slack)   out.push('slack')
  if (ch.webhook) out.push('webhook')
  if (ch.inapp)   out.push('inapp')
  return out
}

/* ── Toggle ── */
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={e => { e.stopPropagation(); onChange(!on) }}
      className={cn('relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 focus:outline-none overflow-hidden', on ? 'bg-teal' : 'bg-[var(--border-strong)]')}>
      <span className={cn('absolute top-[3px] left-[3px] w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-200', on ? 'translate-x-[16px]' : 'translate-x-0')} />
    </button>
  )
}

/* ── RuleCard ── */
function RuleCard({
  rule, onToggle, onDelete, onEdit, onDuplicate, readOnly = false, status, projectName,
}: {
  rule:        AlertRuleRow
  status:      Map<AlertChannel, ChannelStatus>
  projectName: (id: string | null) => string
  onToggle:    (id: string) => void
  onDelete:    (id: string) => void
  onEdit:      (r: AlertRuleRow) => void
  onDuplicate: (r: AlertRuleRow) => void
  readOnly?:   boolean
}) {
  const [menu, setMenu] = useState(false)
  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent' | 'err'>('idle')
  const tm  = TRIGGER_META[rule.triggerType]
  const chs = activeChannels(rule.channels)

  async function testFire() {
    setMenu(false); setTestState('sending')
    try {
      const res = await fetch('/api/v1/alerts/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: rule.id }),
      })
      setTestState(res.ok ? 'sent' : 'err')
    } catch { setTestState('err') }
    setTimeout(() => setTestState('idle'), 3000)
  }

  return (
    <div id={`rule-${rule.id}`} className={cn('bg-white dark:bg-[#141428] border rounded-2xl p-5 space-y-4 transition-all scroll-mt-4 target:ring-2 target:ring-coral/40',
      !rule.isActive ? 'opacity-60 border-[var(--border)]' : 'border-[var(--border)] hover:border-[var(--border-strong)]')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13.5px] font-bold text-[var(--fg)] leading-snug">{rule.name}</p>
            <span className={cn('text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md', tm.bg, tm.color)}>{tm.label}</span>
            {testState === 'sending' && <span className="text-[10.5px] font-semibold text-[var(--fg-tertiary)]">Sending test…</span>}
            {testState === 'sent'    && <span className="text-[10.5px] font-semibold text-teal">✓ Test sent</span>}
            {testState === 'err'     && <span className="text-[10.5px] font-semibold text-[var(--red)]">Test failed</span>}
          </div>
          <p className="text-[11.5px] text-[var(--fg-secondary)] mt-1">{rule.condition || '—'}</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {!readOnly && <Toggle on={rule.isActive} onChange={() => onToggle(rule.id)} label={`${rule.isActive ? 'Pause' : 'Resume'} ${rule.name}`} />}
          {!readOnly && <div className="relative">
            <button type="button" onClick={() => setMenu(v => !v)} aria-label={`Actions for ${rule.name}`} aria-haspopup="menu" aria-expanded={menu}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] transition-colors">
              <MoreHorizontal size={15} aria-hidden="true" />
            </button>
            {menu && (
              <>
                <div className="fixed inset-0 z-[9]" onClick={() => setMenu(false)} />
                <div role="menu" className="absolute right-0 top-9 w-44 bg-white dark:bg-[#1E1E35] border border-[var(--border)] rounded-xl shadow-2xl z-10 p-1">
                  {([
                    { icon: Pencil,     label: 'Edit rule',   danger: false, fn: () => { onEdit(rule); setMenu(false) } },
                    { icon: Copy,       label: 'Duplicate',   danger: false, fn: () => { onDuplicate(rule); setMenu(false) } },
                    { icon: PlayCircle, label: 'Test fire',   danger: false, fn: testFire },
                    { icon: Trash2,     label: 'Delete rule', danger: true,  fn: () => { onDelete(rule.id); setMenu(false) } },
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

      <div className="flex items-center gap-1.5 flex-wrap">
        {chs.map(ch => {
          const cm = CHANNEL_META[ch]
          const ok = status.get(ch)?.deliverable ?? false
          return ok ? (
            <span key={ch} className={cn('text-[10.5px] font-semibold px-2 py-0.5 rounded-lg', cm.bg, cm.color)}>{cm.label}</span>
          ) : (
            <span key={ch} title={status.get(ch)?.detail} className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-lg bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)] line-through decoration-1">
              <AlertTriangle size={10} className="no-underline" aria-hidden="true" />{cm.label}<span className="sr-only"> (not delivered: {status.get(ch)?.detail})</span>
            </span>
          )
        })}
        <span className="text-[10.5px] text-[var(--fg-tertiary)] ml-auto flex-shrink-0">{projectName(rule.projectId)}</span>
      </div>

      {(rule.triggerType === 'limit_breach' || rule.triggerType === 'forecast') && (
        <div className="text-[11px] rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] px-3 py-2">
          {rule.budgets.length === 0 ? (
            <span className="text-[var(--fg-secondary)]">
              Watches no budget yet — <Link href="/dashboard/limits?new=1" className="font-semibold text-coral hover:underline">set a limit</Link> for it to fire.
            </span>
          ) : (
            <span className="flex items-center gap-1.5 flex-wrap text-[var(--fg-secondary)]">
              <Shield size={11} aria-hidden="true" /> Watches
              {rule.budgets.slice(0, 3).map(b => (
                <Link key={b.id} href={`/dashboard/limits#limit-${b.id}`} className="font-semibold text-[var(--fg)] hover:text-coral hover:underline">{b.label}</Link>
              ))}
              {rule.budgets.length > 3 && <Link href="/dashboard/limits" className="hover:underline">+{rule.budgets.length - 3} more</Link>}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
        <div className="flex items-center gap-4 text-[11px] text-[var(--fg-tertiary)]">
          <span className="flex items-center gap-1"><Activity size={11} />{rule.firedCount} fires</span>
          {rule.lastFiredAt && (
            <span className="flex items-center gap-1"><Clock size={11} />Last <TimeAgo value={rule.lastFiredAt} format={relTime} /></span>
          )}
          <span className="flex items-center gap-1"><RefreshCw size={11} />{rule.cooldownHours}h cooldown</span>
        </div>
        <span className={cn('inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full',
          rule.isActive ? 'bg-[var(--green-bg)] text-[var(--green)]' : 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]')}>
          <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', rule.isActive ? 'bg-teal' : 'bg-[var(--border-strong)]')} />
          {rule.isActive ? 'Active' : 'Paused'}
        </span>
      </div>
    </div>
  )
}

/* ── HistoryRow ── */
function HistoryRow({ event }: { event: AlertHistoryRow }) {
  const severity = severityFromType(event.type)
  const sm       = SEVERITY_META[severity]
  const SevIcon  = sm.icon

  return (
    <div className="flex items-start gap-4 py-4 border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-hover)] -mx-5 px-5 transition-colors">
      <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5', sm.bg)}>
        <SevIcon size={14} className={sm.color} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[12.5px] font-semibold text-[var(--fg)]">{event.title}</p>
          <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-md', sm.bg, sm.color)}>{sm.label}</span>
        </div>
        {event.body && <p className="text-[11.5px] text-[var(--fg-secondary)] mt-0.5 leading-snug">{event.body}</p>}
      </div>
      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
        <span className={cn('text-[10.5px] font-semibold', event.isRead ? 'text-[var(--fg-tertiary)]' : 'text-teal')}>
          {event.isRead ? 'Read' : 'Unread'}
        </span>
        <span className="text-[10.5px] text-[var(--fg-tertiary)]"><TimeAgo value={event.createdAt} format={relTime} /></span>
      </div>
    </div>
  )
}

/* ── ChannelCard — real status only; setup lives on Integrations ── */
function ChannelCard({ channel, rulesUsing }: { channel: ChannelStatus; rulesUsing: number }) {
  const info = CHANNEL_INFO[channel.id]
  const Icon = info.icon
  const ok = channel.deliverable
  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5">
      <div className="flex items-start gap-4">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', ok ? 'bg-[var(--green-bg)]' : 'bg-[var(--bg-secondary)]')} aria-hidden="true">
          <Icon size={18} className={ok ? 'text-teal' : 'text-[var(--fg-tertiary)]'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[13.5px] font-bold text-[var(--fg)]">{info.label}</h3>
            <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full',
              ok ? 'bg-[var(--green-bg)] text-[var(--green)]' : 'bg-[var(--amber-bg)] text-[var(--amber)]')}>
              <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', ok ? 'bg-teal' : 'bg-[var(--amber)]')} aria-hidden="true" />
              {ok ? 'Delivering' : 'Not set up'}
            </span>
          </div>
          <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">{info.desc}</p>
          <p className={cn('text-[11.5px] mt-1.5 px-2 py-1 rounded-lg inline-block bg-[var(--bg-secondary)]', ok && channel.id !== 'inapp' && channel.id !== 'email' ? 'font-mono text-[var(--fg-secondary)]' : 'text-[var(--fg-secondary)]')}>{channel.detail}</p>
          {channel.lastAt && (
            <p className={cn('text-[11px] mt-1.5', channel.lastOk ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
              Last delivery {channel.lastOk ? 'succeeded' : 'failed'} <TimeAgo value={channel.lastAt} format={relTime} />
              {channel.lastOk === false && channel.lastDetail ? ` — ${channel.lastDetail}` : ''}
            </p>
          )}
          <p className="text-[11px] text-[var(--fg-tertiary)] mt-1.5">{rulesUsing} rule{rulesUsing === 1 ? '' : 's'} use this channel</p>
        </div>
        {(channel.id === 'slack' || channel.id === 'webhook') && (
          <Link href="/dashboard/integrations" className={cn('flex-shrink-0 text-[12px] py-1.5', ok ? 'btn-secondary' : 'btn-primary')}>
            <Link2 size={12} aria-hidden="true" /> {ok ? 'Manage' : 'Set up'}
          </Link>
        )}
      </div>
    </div>
  )
}

/* ── CreateRuleModal ── */
type Window = 'daily' | 'weekly' | 'monthly'
/** Mirrors lib/alerts/engine inferWindow(): the window is read from the condition text. */
function windowOf(condition: string | null | undefined): Window {
  const c = (condition || '').toLowerCase()
  return c.includes('day') ? 'daily' : c.includes('week') ? 'weekly' : 'monthly'
}
const WINDOW_LABEL: Record<Window, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }

const TEMPLATES = [
  { name: 'Daily spend alert', trigger: 'threshold'    as TriggerType, desc: 'When daily total > $X',  channels: { email: true, slack: false, webhook: false, inapp: true }, threshold: '200' },
  { name: 'Budget warning',    trigger: 'limit_breach' as TriggerType, desc: 'On limit warn threshold', channels: { email: true, slack: true,  webhook: false, inapp: true }, threshold: '' },
  { name: 'Cost spike',        trigger: 'anomaly'      as TriggerType, desc: 'Today far above usual',   channels: { email: false, slack: true, webhook: false, inapp: true }, threshold: '' },
  { name: 'Projected overspend', trigger: 'forecast'   as TriggerType, desc: 'Run-rate will beat budget', channels: { email: true, slack: false, webhook: false, inapp: true }, threshold: '' },
]

function CreateRuleModal({ initial, orgId, onClose, onSaved, status, projects }: {
  initial?:  AlertRuleRow | null
  orgId:     string
  onClose:   () => void
  onSaved:   (r: AlertRuleRow, isEdit: boolean) => void
  status:    Map<AlertChannel, ChannelStatus>
  projects:  ProjectOption[]
}) {
  const isEdit = !!initial
  const deliverable = (ch: AlertChannel) => status.get(ch)?.deliverable ?? false
  const onlyDeliverable = (c: AlertRuleRow['channels']) => ({
    email: c.email && deliverable('email'), slack: c.slack && deliverable('slack'), webhook: c.webhook && deliverable('webhook'), inapp: true,
  })
  const [projectId, setProjectId] = useState<string | null>(initial?.projectId ?? null)
  const [windowSel, setWindowSel] = useState<Window>(initial ? windowOf(initial.condition) : 'daily')
  const [name,      setName]      = useState(initial?.name ?? '')
  const [trigger,   setTrigger]   = useState<TriggerType>(initial?.triggerType ?? 'threshold')
  const [threshold, setThreshold] = useState(initial?.threshold != null ? String(initial.threshold) : '')
  const [anomalyScope, setAnomalyScope] = useState<AnomalyScope>(initial?.anomalyScope ?? 'org')
  const [channels,  setChannels]  = useState(
    initial?.channels ?? onlyDeliverable({ email: true, slack: false, webhook: false, inapp: true })
  )
  const [cooldown,  setCooldown]  = useState(initial?.cooldownHours?.toString() ?? '4')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  function applyTemplate(t: typeof TEMPLATES[0]) {
    setName(t.name); setTrigger(t.trigger); setChannels(onlyDeliverable(t.channels)); setThreshold(t.threshold)
    if (t.trigger === 'threshold') setWindowSel('daily')
  }

  function toggleChannel(ch: AlertChannel) {
    if (ch === 'inapp') return
    // A channel that can't deliver can be switched off, never on.
    if (!channels[ch] && !deliverable(ch)) return
    setChannels(prev => ({ ...prev, [ch]: !prev[ch] }))
  }

  const scopeLabel = projectId ? (projects.find(p => p.id === projectId)?.name ?? 'Project') : 'All projects'

  function buildCondition(): string {
    // The engine reads the threshold window from this text (daily/weekly/monthly).
    if (trigger === 'threshold') return `${WINDOW_LABEL[windowSel]} spend > $${threshold || '0'}`
    if (trigger === 'anomaly')   return `Today's spend is a robust outlier (${ANOMALY_SCOPE_META[anomalyScope].label.toLowerCase()}, 28-day baseline)`
    if (trigger === 'limit_breach') return 'Limit threshold reached'
    if (trigger === 'forecast')  return 'Projected to exceed a budget this period'
    if (trigger === 'member')    return threshold ? `Any member > $${threshold} this month` : 'Member spend threshold'
    return name
  }

  async function handleSave() {
    setSaving(true); setError(null)
    try {
      const body = {
        org_id:         orgId,
        name:           name || 'Unnamed rule',
        trigger_type:   trigger,
        condition:      buildCondition(),
        scope:          trigger === 'member' ? 'All members' : scopeLabel,
        project_id:     trigger === 'member' ? null : projectId,
        cooldown_hours: Number(cooldown) || 4,
        channels,
        threshold:      (trigger === 'threshold' || trigger === 'member') && threshold ? Number(threshold) : null,
        anomaly_scope:  anomalyScope,
      }

      let row: AlertRuleRow
      if (isEdit) {
        const res = await fetch('/api/v1/alerts', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: initial!.id,
            name: body.name,
            condition: body.condition,
            scope: body.scope,
            project_id: body.project_id,
            cooldown_hours: body.cooldown_hours,
            channels: body.channels,
            ...(trigger === 'anomaly' ? { anomaly_scope: anomalyScope } : {}),
            ...((trigger === 'threshold' || trigger === 'member') && threshold ? { threshold: Number(threshold) } : {}),
          }),
        })
        if (!res.ok) throw new Error(await readApiError(res))
        const data = await res.json()
        row = {
          ...initial!,
          name:          data.name,
          condition:     data.condition,
          scope:         data.scope,
          threshold:     data.threshold == null ? null : Number(data.threshold),
          anomalyScope:  data.anomaly_scope ?? initial!.anomalyScope,
          channels:      data.channels,
          cooldownHours: data.cooldown_hours,
          projectId:     data.project_id ?? null,
        }
      } else {
        const res = await fetch('/api/v1/alerts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error(await readApiError(res))
        const data = await res.json()
        row = {
          id:            data.id,
          name:          data.name,
          triggerType:   data.trigger_type,
          condition:     data.condition,
          scope:         data.scope,
          threshold:     data.threshold == null ? null : Number(data.threshold),
          anomalyScope:  data.anomaly_scope ?? 'org',
          channels:      data.channels,
          isActive:      data.is_active,
          firedCount:    data.fired_count ?? 0,
          lastFiredAt:   data.last_fired_at ?? null,
          cooldownHours: data.cooldown_hours,
          createdAt:     data.created_at,
          projectId:     data.project_id ?? null,
          budgets:       [],   // filled in by the server refresh below
        }
      }
      onSaved(row, isEdit)
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save rule')
    } finally {
      setSaving(false)
    }
  }

  const needsThreshold = trigger === 'threshold' || trigger === 'member'
  const canSave = !!name && !saving && (!needsThreshold || Number(threshold) > 0)

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? 'Edit alert rule' : 'New alert rule'}
      description="Get notified when spend events happen"
      footer={<>
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="button" onClick={handleSave} disabled={!canSave} className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
          {saving
            ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" aria-hidden="true" /> {isEdit ? 'Saving…' : 'Creating…'}</>
            : <><Bell size={13} aria-hidden="true" /> {isEdit ? 'Save changes' : 'Create rule'}</>}
        </button>
      </>}
    >
        <div className="px-6 py-5 space-y-5">
          {/* Templates */}
          {!isEdit && (
            <fieldset>
              <legend className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Quick start</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {TEMPLATES.map(t => (
                  <button key={t.name} type="button" onClick={() => applyTemplate(t)} aria-pressed={name === t.name}
                    className={cn('flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all',
                      name === t.name ? 'border-coral bg-[var(--red-bg)]' : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]')}>
                    <Zap size={13} aria-hidden="true" className={cn('mt-0.5 flex-shrink-0', name === t.name ? 'text-coral' : 'text-[var(--fg-tertiary)]')} />
                    <div>
                      <p className={cn('text-[12px] font-semibold', name === t.name ? 'text-coral' : 'text-[var(--fg)]')}>{t.name}</p>
                      <p className="text-[10.5px] text-[var(--fg-tertiary)]">{t.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {/* Name */}
          <div>
            <label htmlFor="rule-name" className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Rule name</label>
            <input id="rule-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Daily spend over $200" data-autofocus
              className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral" />
          </div>

          {/* Trigger */}
          {!isEdit && (
            <fieldset>
              <legend className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Trigger</legend>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(TRIGGER_META) as TriggerType[]).map(t => {
                  const tm     = TRIGGER_META[t]
                  const active = trigger === t
                  return (
                    <button key={t} type="button" onClick={() => setTrigger(t)} aria-pressed={active}
                      className={cn('flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[12.5px] font-semibold transition-all text-left',
                        active ? `${tm.bg} ${tm.color} border-current/30` : 'border-[var(--border)] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]')}>
                      <span className={cn('w-2 h-2 rounded-full', active ? 'bg-current' : 'bg-[var(--border-strong)]')} aria-hidden="true" />
                      {tm.label}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          )}

          {/* Anomaly scope */}
          {trigger === 'anomaly' && (
            <fieldset>
              <legend className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Detect spikes</legend>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(ANOMALY_SCOPE_META) as AnomalyScope[]).map(sc => (
                  <button key={sc} type="button" onClick={() => setAnomalyScope(sc)} aria-pressed={anomalyScope === sc}
                    className={cn('flex flex-col items-start px-3 py-2 rounded-xl border text-left transition-all',
                      anomalyScope === sc ? 'border-coral bg-[var(--red-bg)]' : 'border-[var(--border)] hover:bg-[var(--bg-hover)]')}>
                    <span className={cn('text-[12px] font-semibold', anomalyScope === sc ? 'text-coral' : 'text-[var(--fg)]')}>{ANOMALY_SCOPE_META[sc].label}</span>
                    <span className="text-[10.5px] text-[var(--fg-tertiary)]">{ANOMALY_SCOPE_META[sc].desc}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[var(--fg-tertiary)] mt-2">
                Fires when today&apos;s spend is a robust outlier (median + MAD over the previous 28 days, z &gt; 3.5) and above $1. Needs 7 days of history.
              </p>
            </fieldset>
          )}

          {(trigger === 'forecast' || trigger === 'limit_breach') && (
            <p className="text-[11.5px] text-[var(--fg-secondary)] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl px-3 py-2.5">
              {trigger === 'forecast'
                ? 'Warns when a budget limit is projected to be exceeded before its period ends, using the 14-day run-rate weighted to the last 7 days.'
                : 'Fires when a budget limit reaches its warn %.'}
              {' '}It watches every budget {projectId ? 'on the chosen project' : 'in the org'} — see them on{' '}
              <Link href="/dashboard/limits" className="font-semibold text-coral hover:underline">Limits</Link>.
            </p>
          )}

          {/* Threshold (+ window) */}
          {needsThreshold && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="rule-threshold" className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">{trigger === 'member' ? 'Per-member monthly $' : 'Threshold $'}</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[var(--fg-tertiary)]" aria-hidden="true">$</span>
                  <input id="rule-threshold" type="number" min={0} value={threshold} onChange={e => setThreshold(e.target.value)} placeholder="200"
                    className="w-full pl-7 pr-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral" />
                </div>
              </div>
              {trigger === 'threshold' && (
                <div>
                  <label htmlFor="rule-window" className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Window</label>
                  <select id="rule-window" value={windowSel} onChange={e => setWindowSel(e.target.value as Window)}
                    className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral">
                    <option value="daily">Today (daily)</option>
                    <option value="weekly">Last 7 days (weekly)</option>
                    <option value="monthly">This month (monthly)</option>
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Project filter — the engine filters by project_id (not editable after creation) */}
          {trigger !== 'member' && (
            <div>
              <label htmlFor="rule-project" className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Project</label>
              <select id="rule-project" value={projectId ?? ''} onChange={e => setProjectId(e.target.value || null)} disabled={isEdit}
                className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral disabled:opacity-60">
                <option value="">All projects</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {isEdit && <p className="text-[11px] text-[var(--fg-tertiary)] mt-1">The project can&apos;t be changed after creation — duplicate the rule instead.</p>}
            </div>
          )}

          {/* Channels — only ones that actually deliver can be switched on */}
          <fieldset>
            <legend className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Notify via</legend>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(CHANNEL_META) as AlertChannel[]).map(ch => {
                const cm     = CHANNEL_META[ch]
                const active = channels[ch]
                const isInApp = ch === 'inapp'
                const ok = deliverable(ch)
                const blocked = !ok && !active
                return (
                  <button key={ch} type="button" role="checkbox" aria-checked={active} onClick={() => toggleChannel(ch)}
                    aria-disabled={isInApp || blocked}
                    title={!ok ? status.get(ch)?.detail : undefined}
                    className={cn('flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[12.5px] font-semibold transition-all text-left',
                      active && ok ? `${cm.bg} ${cm.color} border-current/30` :
                      active && !ok ? 'border-[var(--amber)]/50 bg-[var(--amber-bg)] text-[var(--amber)]' :
                      'border-[var(--border)] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]',
                      (isInApp || blocked) && 'cursor-not-allowed', blocked && 'opacity-60')}>
                    {active ? <Check size={13} className="text-current" aria-hidden="true" /> : <span className="w-3.5 h-3.5 rounded border-2 border-[var(--border-strong)]" aria-hidden="true" />}
                    {cm.label}
                    {isInApp && <span className="text-[9.5px] ml-auto opacity-80">always</span>}
                    {!ok && <span className="text-[9.5px] ml-auto">{active ? 'won’t send' : 'not set up'}</span>}
                  </button>
                )
              })}
              {COMING_SOON.map(label => (
                <button key={label} type="button" disabled aria-disabled="true"
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-[var(--border)] text-[12.5px] font-semibold text-[var(--fg-tertiary)] cursor-not-allowed text-left">
                  <Clock size={12} aria-hidden="true" /> {label}
                  <span className="text-[9.5px] ml-auto">coming soon</span>
                </button>
              ))}
            </div>
            {(['slack', 'webhook', 'email'] as const).some(c => !deliverable(c)) && (
              <p className="text-[11px] text-[var(--fg-tertiary)] mt-2">
                Channels marked “not set up” can&apos;t deliver yet. Add Slack or webhook URLs in{' '}
                <Link href="/dashboard/integrations" className="font-semibold text-coral hover:underline">Integrations</Link>.
              </p>
            )}
          </fieldset>

          {/* Cooldown */}
          <fieldset>
            <legend className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Cooldown</legend>
            <div className="flex gap-2">
              {[['1', '1h'], ['4', '4h'], ['24', '24h'], ['168', '1 week']].map(([v, label]) => (
                <button key={v} type="button" onClick={() => setCooldown(v)} aria-pressed={cooldown === v}
                  className={cn('flex-1 py-2 rounded-xl border text-[11.5px] font-semibold transition-all',
                    cooldown === v ? 'bg-[var(--fg)] text-[var(--bg)] border-[var(--fg)]' : 'border-[var(--border)] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]')}>
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          {error && <p role="alert" className="text-[12px] text-[var(--red)] bg-[var(--red-bg)] border border-[var(--red)]/20 px-3 py-2 rounded-lg">{error}</p>}
        </div>
    </Dialog>
  )
}

/* ══════════════════════════════════════════════════════════════
   MAIN CLIENT
══════════════════════════════════════════════════════════════ */
interface Props {
  initialRules:   AlertRuleRow[]
  initialHistory: AlertHistoryRow[]
  orgId:          string
  userEmail:      string
  role:           Role
  channels:       ChannelStatus[]
  projects:       ProjectOption[]
}

export function AlertsClient({ initialRules, initialHistory, orgId, role, channels, projects }: Props) {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [tab,        setTab]        = useState<PageTab>('rules')
  const [rules,      setRules]      = useState<AlertRuleRow[]>(initialRules)
  // Re-sync after router.refresh() (server recomputes budget links).
  useEffect(() => { setRules(initialRules) }, [initialRules])
  const [history]                   = useState<AlertHistoryRow[]>(initialHistory)
  const [showModal,  setShowModal]  = useState(false)
  const [editTarget, setEditTarget] = useState<AlertRuleRow | null>(null)
  const [filterType, setFilterType] = useState<TriggerType | 'all'>('all')
  const [search,     setSearch]     = useState('')
  const [sevFilter,  setSevFilter]  = useState<HistorySeverity | 'all'>('all')
  const [toast,      setToast]      = useState('')
  const [toggling,   setToggling]   = useState<string | null>(null)

  const status = new Map(channels.map(c => [c.id, c]))
  const projectName = (id: string | null) => id ? (projects.find(p => p.id === id)?.name ?? 'Project') : 'All projects'

  // ⌘K "New alert rule" → /dashboard/alerts?new=1
  useEffect(() => {
    if (searchParams?.get('new') === '1' && can(role, 'alerts:write')) {
      setShowModal(true)
      router.replace('/dashboard/alerts', { scroll: false })
    }
  }, [searchParams, role, router])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  async function handleToggle(id: string) {
    const rule = rules.find(r => r.id === id)
    if (!rule) return
    setToggling(id)
    try {
      const res = await fetch('/api/v1/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: !rule.isActive }),
      })
      if (!res.ok) { showToast(await readApiError(res)); return }
      setRules(prev => prev.map(r => r.id === id ? { ...r, isActive: !r.isActive } : r))
    } finally {
      setToggling(null)
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/v1/alerts?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok) { showToast(await readApiError(res)); return }
    setRules(prev => prev.filter(r => r.id !== id))
    showToast('Rule deleted')
  }

  function handleSaved(rule: AlertRuleRow, isEdit: boolean) {
    if (isEdit) {
      setRules(prev => prev.map(r => r.id === rule.id ? rule : r))
      showToast('Rule updated')
    } else {
      setRules(prev => [rule, ...prev])
      showToast('Alert rule created')
    }
    setEditTarget(null)
    router.refresh()
  }

  async function handleDuplicate(rule: AlertRuleRow) {
    const res = await fetch('/api/v1/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        org_id:         orgId,
        name:           `${rule.name} (copy)`,
        trigger_type:   rule.triggerType,
        condition:      rule.condition,
        scope:          rule.scope,
        threshold:      rule.threshold,
        anomaly_scope:  rule.anomalyScope,
        cooldown_hours: rule.cooldownHours,
        channels:       rule.channels,
        project_id:     rule.projectId,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      const copy: AlertRuleRow = {
        id:            data.id,
        name:          data.name,
        triggerType:   data.trigger_type,
        condition:     data.condition,
        scope:         data.scope,
        threshold:     data.threshold == null ? null : Number(data.threshold),
        anomalyScope:  data.anomaly_scope ?? 'org',
        channels:      data.channels,
        isActive:      data.is_active,
        firedCount:    0,
        lastFiredAt:   null,
        cooldownHours: data.cooldown_hours,
        createdAt:     data.created_at,
        projectId:     data.project_id ?? null,
        budgets:       rule.budgets,
      }
      setRules(prev => [...prev, copy])
      showToast('Rule duplicated')
    }
  }

  const filteredRules = rules.filter(r => {
    if (filterType !== 'all' && r.triggerType !== filterType) return false
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // Apply toggle optimistically
  const displayRules = filteredRules.map(r =>
    r.id === toggling ? { ...r, isActive: !r.isActive } : r
  )

  const filteredHistory = sevFilter === 'all' ? history : history.filter(e => severityFromType(e.type) === sevFilter)

  const activeRules   = rules.filter(r => r.isActive).length
  const connectedCh   = channels.filter(c => c.deliverable).length
  // Rules whose ONLY enabled external channels can't deliver (in-app still works).
  const undelivered   = rules.filter(r => r.isActive && activeChannels(r.channels).some(ch => !(status.get(ch)?.deliverable)))
  const recentHistory = history.filter(e => (Date.now() - new Date(e.createdAt).getTime()) < 86400_000)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Alerts</h2>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">Rule-based notifications for spend events, anomalies and limit breaches</p>
        </div>
        {can(role, 'alerts:write') && (
          <button type="button" onClick={() => setShowModal(true)} className="btn-primary flex-shrink-0">
            <Plus size={14} aria-hidden="true" /> New rule
          </button>
        )}
      </div>

      {undelivered.length > 0 && (
        <div role="status" className="flex items-start gap-3 px-4 py-3 bg-[var(--amber-bg)] border border-[var(--amber)]/30 rounded-xl">
          <AlertTriangle size={14} className="text-[var(--amber)] flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-[12.5px] text-[var(--amber)] flex-1">
            <span className="font-semibold">{undelivered.length} active rule{undelivered.length > 1 ? 's use' : ' uses'} a channel that isn&apos;t set up</span>
            {' '}(struck through below) — those notifications are skipped; in-app still works.{' '}
            <button type="button" onClick={() => setTab('channels')} className="underline font-semibold">See channels</button>
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: 'Active rules',       value: activeRules.toString(),           icon: Bell,          color: 'text-[var(--blue)]',  bg: 'bg-[var(--blue-bg)]'  },
          { label: 'Notifications (24h)', value: recentHistory.length.toString(),  icon: Activity,      color: 'text-[var(--amber)]', bg: 'bg-[var(--amber-bg)]' },
          { label: 'Critical today',     value: recentHistory.filter(e => severityFromType(e.type) === 'critical').length.toString(), icon: AlertTriangle, color: 'text-[var(--red)]', bg: 'bg-[var(--red-bg)]' },
          { label: 'Channels delivering', value: `${connectedCh}/${channels.length}`, icon: Link2,      color: 'text-teal',           bg: 'bg-[var(--green-bg)]' },
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

      {/* Tabs */}
      <div className="flex items-center gap-0.5 p-1 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl w-fit">
        {([
          { id: 'rules',    label: 'Rules',    badge: rules.length.toString(), badgeAlert: false },
          { id: 'history',  label: 'History',  badge: recentHistory.length > 0 ? `${recentHistory.length} today` : null, badgeAlert: true },
          { id: 'channels', label: 'Channels', badge: null, badgeAlert: false },
        ] as const).map(t => {
          const isActive = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold transition-all',
                isActive ? 'bg-[var(--bg-secondary)] text-[var(--fg)] shadow-sm' : 'text-[var(--fg-tertiary)] hover:text-[var(--fg)] hover:bg-[var(--bg-hover)]')}>
              {t.label}
              {t.badge && (
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md font-semibold',
                  t.badgeAlert ? 'bg-[var(--red-bg)] text-[var(--red)]' :
                  isActive ? 'bg-[var(--border)] text-[var(--fg-secondary)]' : 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]')}>
                  {t.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Rules tab */}
      {tab === 'rules' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-[280px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search rules…"
                className="w-full pl-8 pr-3 py-2 rounded-xl border border-[var(--border)] text-[12.5px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral" />
            </div>
            <div className="flex items-center gap-1.5">
              {([['all', 'All'], ['threshold', 'Threshold'], ['anomaly', 'Anomaly'], ['limit_breach', 'Limit'], ['forecast', 'Forecast']] as const).map(([v, label]) => (
                <button key={v} onClick={() => setFilterType(v as TriggerType | 'all')}
                  className={cn('px-3 py-1.5 rounded-xl border text-[12px] font-semibold transition-all',
                    filterType === v ? 'bg-[var(--fg)] text-[var(--bg)] border-[var(--fg)]' : 'border-[var(--border)] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]')}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {displayRules.length === 0 ? (
            <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl py-20 text-center">
              <Bell size={36} className="text-[var(--fg-tertiary)] mx-auto mb-4" />
              <p className="text-[14px] font-semibold text-[var(--fg)]">No rules match</p>
              <p className="text-[12.5px] text-[var(--fg-secondary)] mt-1">Try changing your filter or create a new rule</p>
              {can(role, 'alerts:write') && (
                <button onClick={() => setShowModal(true)} className="btn-primary mt-5"><Plus size={13} /> New rule</button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {displayRules.map(rule => (
                <RuleCard key={rule.id} rule={rule} status={status} projectName={projectName}
                  onToggle={can(role, 'alerts:write') ? handleToggle : () => {}}
                  onDelete={can(role, 'alerts:write') ? handleDelete : () => {}}
                  onEdit={can(role, 'alerts:write') ? r => { setEditTarget(r); setShowModal(true) } : () => {}}
                  onDuplicate={handleDuplicate}
                  readOnly={!can(role, 'alerts:write')}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* History tab */}
      {tab === 'history' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            {([['all', 'All'], ['critical', 'Critical'], ['warning', 'Warning'], ['info', 'Info']] as const).map(([v, label]) => {
              const sm      = v !== 'all' ? SEVERITY_META[v as HistorySeverity] : null
              const isAct   = sevFilter === v
              const count   = v === 'all' ? history.length : history.filter(e => severityFromType(e.type) === v).length
              return (
                <button key={v} onClick={() => setSevFilter(v as HistorySeverity | 'all')}
                  className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[12px] font-semibold transition-all',
                    isAct ? 'bg-[var(--fg)] text-[var(--bg)] border-[var(--fg)]' : 'border-[var(--border)] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]')}>
                  {sm && <sm.icon size={11} className={isAct ? 'text-[var(--bg)]' : sm.color} />}
                  {label}
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md font-semibold',
                    isAct ? 'bg-white/20 text-[var(--bg)]' : 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]')}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl px-5">
            {filteredHistory.length === 0 ? (
              <div className="py-16 text-center">
                <CheckCircle2 size={32} className="text-teal mx-auto mb-3" />
                <p className="text-[13px] text-[var(--fg-secondary)]">No notifications yet</p>
                <p className="text-[12px] text-[var(--fg-tertiary)] mt-1">Alerts will appear here when they fire</p>
              </div>
            ) : (
              filteredHistory.map(event => <HistoryRow key={event.id} event={event} />)
            )}
          </div>
          {filteredHistory.length > 0 && (
            <p className="text-[11.5px] text-[var(--fg-tertiary)] text-center">
              Showing last {filteredHistory.length} events · History retained for 30 days
            </p>
          )}
        </div>
      )}

      {/* Channels tab */}
      {tab === 'channels' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {channels.map(ch => (
              <ChannelCard key={ch.id} channel={ch} rulesUsing={rules.filter(r => r.channels[ch.id]).length} />
            ))}
          </div>

          <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5">
            <h3 className="text-[13.5px] font-bold text-[var(--fg)]">Coming soon</h3>
            <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">Not delivered yet — they can&apos;t be selected on a rule until they are.</p>
            <ul className="flex flex-wrap gap-2 mt-3">
              {COMING_SOON.map(c => (
                <li key={c} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2.5 py-1 rounded-lg border border-dashed border-[var(--border)] text-[var(--fg-tertiary)]">
                  <Clock size={11} aria-hidden="true" /> {c}
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link href="/dashboard/settings/notifications"
              className="group bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 flex items-start gap-3 hover:border-[var(--border-strong)]">
              <Moon size={16} className="text-[var(--fg-secondary)] mt-0.5 flex-shrink-0" aria-hidden="true" />
              <div className="flex-1">
                <p className="text-[13.5px] font-bold text-[var(--fg)]">Quiet hours & email opt-outs</p>
                <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">Per person, in Settings → Notifications. Critical (block-level) alerts still go through.</p>
              </div>
              <ArrowRight size={14} className="text-[var(--fg-tertiary)] group-hover:text-coral mt-1" aria-hidden="true" />
            </Link>
            <div className="bg-[var(--blue-bg)] border border-[var(--blue)]/20 rounded-2xl p-5 flex items-start gap-3">
              <PlayCircle size={16} className="text-[var(--blue)] mt-0.5 flex-shrink-0" aria-hidden="true" />
              <div>
                <p className="text-[13.5px] font-bold text-[var(--blue)]">Test a channel</p>
                <p className="text-[12px] text-[var(--blue)] mt-0.5">Open a rule&apos;s ⋯ menu and choose <span className="font-semibold">Test fire</span> — it sends through that rule&apos;s channels and records the result on Integrations.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <CreateRuleModal
          initial={editTarget}
          orgId={orgId}
          onClose={() => { setShowModal(false); setEditTarget(null) }}
          onSaved={handleSaved}
          status={status}
          projects={projects}
        />
      )}

      {/* Toast */}
      <div className={cn('fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-3 bg-[var(--fg)] text-[var(--bg)] rounded-2xl shadow-2xl text-[13px] font-semibold transition-all duration-300 z-50',
        toast ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none')}>
        <Check size={14} className="text-teal" /> {toast}
      </div>
    </div>
  )
}
