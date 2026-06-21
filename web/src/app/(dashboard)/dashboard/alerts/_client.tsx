'use client'
import { useState } from 'react'
import {
  Bell, Plus, Zap, Mail, AlertTriangle, Check, X, Trash2,
  Clock, CheckCircle2, XCircle,
  MoreHorizontal, Activity, Webhook, ExternalLink,
  Settings, Search, RefreshCw, Link2, Pencil, Copy, PlayCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AlertRuleRow, AlertHistoryRow, TriggerType } from './_types'

/* ── Local types ── */
type AlertChannel    = 'email' | 'slack' | 'webhook' | 'inapp'
type PageTab         = 'rules' | 'history' | 'channels'
type HistorySeverity = 'info' | 'warning' | 'critical'

interface Channel {
  id:        AlertChannel
  label:     string
  desc:      string
  icon:      React.ElementType
  connected: boolean
  detail?:   string
}

/* ── Meta maps ── */
const TRIGGER_META: Record<TriggerType, { label: string; color: string; bg: string }> = {
  threshold:    { label: 'Threshold',    color: 'text-[var(--amber)]', bg: 'bg-[var(--amber-bg)]' },
  anomaly:      { label: 'Anomaly',      color: 'text-[#8B5CF6]',      bg: 'bg-[#8B5CF6]/10'      },
  limit_breach: { label: 'Limit breach', color: 'text-[var(--red)]',   bg: 'bg-[var(--red-bg)]'   },
  member:       { label: 'Member event', color: 'text-teal',            bg: 'bg-[var(--green-bg)]' },
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

function reltime(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60)     return `${Math.round(s)}s ago`
  if (s < 3600)   return `${Math.round(s / 60)}m ago`
  if (s < 86400)  return `${Math.round(s / 3600)}h ago`
  if (s < 604800) return `${Math.round(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
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
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={e => { e.stopPropagation(); onChange(!on) }}
      className={cn('relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 focus:outline-none overflow-hidden', on ? 'bg-teal' : 'bg-[var(--border-strong)]')}>
      <span className={cn('absolute top-[3px] left-[3px] w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-200', on ? 'translate-x-[16px]' : 'translate-x-0')} />
    </button>
  )
}

/* ── RuleCard ── */
function RuleCard({
  rule, onToggle, onDelete, onEdit, onDuplicate,
}: {
  rule:        AlertRuleRow
  onToggle:    (id: string) => void
  onDelete:    (id: string) => void
  onEdit:      (r: AlertRuleRow) => void
  onDuplicate: (r: AlertRuleRow) => void
}) {
  const [menu, setMenu] = useState(false)
  const tm  = TRIGGER_META[rule.triggerType]
  const chs = activeChannels(rule.channels)

  return (
    <div className={cn('bg-white dark:bg-[#141428] border rounded-2xl p-5 space-y-4 transition-all',
      !rule.isActive ? 'opacity-60 border-[var(--border)]' : 'border-[var(--border)] hover:border-[var(--border-strong)]')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13.5px] font-bold text-[var(--fg)] leading-snug">{rule.name}</p>
            <span className={cn('text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md', tm.bg, tm.color)}>{tm.label}</span>
          </div>
          <p className="text-[11.5px] text-[var(--fg-secondary)] mt-1">{rule.condition || '—'}</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <Toggle on={rule.isActive} onChange={() => onToggle(rule.id)} />
          <div className="relative">
            <button onClick={() => setMenu(v => !v)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] transition-colors">
              <MoreHorizontal size={15} />
            </button>
            {menu && (
              <>
                <div className="fixed inset-0 z-[9]" onClick={() => setMenu(false)} />
                <div className="absolute right-0 top-9 w-44 bg-white dark:bg-[#1E1E35] border border-[var(--border)] rounded-xl shadow-2xl z-10 p-1">
                  {([
                    { icon: Pencil,     label: 'Edit rule',   danger: false, fn: () => { onEdit(rule); setMenu(false) } },
                    { icon: Copy,       label: 'Duplicate',   danger: false, fn: () => { onDuplicate(rule); setMenu(false) } },
                    { icon: PlayCircle, label: 'Test fire',   danger: false, fn: () => setMenu(false) },
                    { icon: Trash2,     label: 'Delete rule', danger: true,  fn: () => { onDelete(rule.id); setMenu(false) } },
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

      <div className="flex items-center gap-1.5 flex-wrap">
        {chs.map(ch => {
          const cm = CHANNEL_META[ch]
          return (
            <span key={ch} className={cn('text-[10.5px] font-semibold px-2 py-0.5 rounded-lg', cm.bg, cm.color)}>{cm.label}</span>
          )
        })}
        <span className="text-[10.5px] text-[var(--fg-tertiary)] ml-auto flex-shrink-0">{rule.scope}</span>
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
        <div className="flex items-center gap-4 text-[11px] text-[var(--fg-tertiary)]">
          <span className="flex items-center gap-1"><Activity size={11} />{rule.firedCount} fires</span>
          {rule.lastFiredAt && (
            <span className="flex items-center gap-1"><Clock size={11} />Last {reltime(rule.lastFiredAt)}</span>
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
        <span className="text-[10.5px] text-[var(--fg-tertiary)]">{reltime(event.createdAt)}</span>
      </div>
    </div>
  )
}

/* ── ChannelCard ── */
function ChannelCard({ channel, onConnect }: { channel: Channel; onConnect: (id: AlertChannel) => void }) {
  const [editing,  setEditing]  = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const Icon = channel.icon

  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5">
      <div className="flex items-start gap-4">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', channel.connected ? 'bg-[var(--green-bg)]' : 'bg-[var(--bg-secondary)]')}>
          <Icon size={18} className={channel.connected ? 'text-teal' : 'text-[var(--fg-tertiary)]'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[13.5px] font-bold text-[var(--fg)]">{channel.label}</p>
            <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full',
              channel.connected ? 'bg-[var(--green-bg)] text-[var(--green)]' : 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]')}>
              <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', channel.connected ? 'bg-teal' : 'bg-[var(--border-strong)]')} />
              {channel.connected ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">{channel.desc}</p>
          {channel.detail && (
            <p className="text-[11.5px] font-mono text-[var(--fg-tertiary)] mt-1.5 bg-[var(--bg-secondary)] px-2 py-1 rounded-lg inline-block">{channel.detail}</p>
          )}
        </div>
        <div className="flex-shrink-0">
          {channel.id === 'inapp' ? (
            <span className="text-[11px] text-[var(--fg-tertiary)] px-3 py-2 bg-[var(--bg-secondary)] rounded-xl">Always on</span>
          ) : channel.connected ? (
            <button onClick={() => setEditing(v => !v)} className="btn-secondary text-[12px] py-1.5">
              <Settings size={12} /> Configure
            </button>
          ) : (
            <button onClick={() => channel.id === 'webhook' ? setEditing(true) : onConnect(channel.id)} className="btn-primary text-[12px] py-1.5">
              <Link2 size={12} /> Connect
            </button>
          )}
        </div>
      </div>

      {(channel.id === 'webhook' || channel.id === 'slack') && editing && (
        <div className="mt-4 pt-4 border-t border-[var(--border)]">
          <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">
            {channel.id === 'slack' ? 'Slack Webhook URL' : 'Endpoint URL'}
          </label>
          <div className="flex gap-2">
            <input value={urlInput} onChange={e => setUrlInput(e.target.value)}
              placeholder={channel.id === 'slack' ? 'https://hooks.slack.com/services/…' : 'https://your-endpoint.com/webhook'}
              className="flex-1 px-3 py-2.5 rounded-xl border border-[var(--border)] text-[12.5px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral" />
            <button disabled={!urlInput} onClick={() => { onConnect(channel.id); setEditing(false) }}
              className="btn-primary text-[12px] py-2.5 disabled:opacity-40">Save</button>
          </div>
          {channel.id === 'webhook' && (
            <p className="text-[11px] text-[var(--fg-tertiary)] mt-2">
              We&apos;ll POST <span className="font-mono">{'{ rule, severity, message, fired_at }'}</span> to this URL.
              <a href="#" className="text-[var(--blue)] hover:underline ml-1">See docs <ExternalLink size={10} className="inline" /></a>
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/* ── CreateRuleModal ── */
const TEMPLATES = [
  { name: 'Daily spend alert', trigger: 'threshold'    as TriggerType, desc: 'When daily total > $X',  channels: { email: true, slack: false, webhook: false, inapp: true } },
  { name: 'Budget warning',    trigger: 'limit_breach' as TriggerType, desc: 'On limit warn threshold', channels: { email: true, slack: true,  webhook: false, inapp: true } },
  { name: 'Cost spike',        trigger: 'anomaly'      as TriggerType, desc: 'When cost > 3× avg',      channels: { email: false, slack: true, webhook: false, inapp: true } },
  { name: 'Weekly digest',     trigger: 'threshold'    as TriggerType, desc: 'Scheduled weekly report', channels: { email: true, slack: false, webhook: false, inapp: false } },
]

function CreateRuleModal({ initial, orgId, onClose, onSaved }: {
  initial?:  AlertRuleRow | null
  orgId:     string
  onClose:   () => void
  onSaved:   (r: AlertRuleRow, isEdit: boolean) => void
}) {
  const isEdit = !!initial
  const [name,      setName]      = useState(initial?.name ?? '')
  const [trigger,   setTrigger]   = useState<TriggerType>(initial?.triggerType ?? 'threshold')
  const [threshold, setThreshold] = useState('')
  const [scope,     setScope]     = useState(initial?.scope ?? 'All projects')
  const [condition, setCondition] = useState(initial?.condition ?? '')
  const [channels,  setChannels]  = useState(
    initial?.channels ?? { email: true, slack: false, webhook: false, inapp: true }
  )
  const [cooldown,  setCooldown]  = useState(initial?.cooldownHours?.toString() ?? '4')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  function applyTemplate(t: typeof TEMPLATES[0]) {
    setName(t.name); setTrigger(t.trigger); setChannels(t.channels)
  }

  function toggleChannel(ch: AlertChannel) {
    if (ch === 'inapp') return
    setChannels(prev => ({ ...prev, [ch]: !prev[ch] }))
  }

  function buildCondition(): string {
    if (condition.trim()) return condition
    if (trigger === 'threshold') return threshold ? `Spend > $${threshold}` : 'Threshold reached'
    if (trigger === 'anomaly')   return 'Cost > 3× 7-day average'
    if (trigger === 'limit_breach') return 'Limit threshold reached'
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
        scope,
        cooldown_hours: Number(cooldown) || 4,
        channels,
        threshold:      trigger === 'threshold' && threshold ? Number(threshold) : null,
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
            cooldown_hours: body.cooldown_hours,
            channels: body.channels,
          }),
        })
        if (!res.ok) throw new Error(await res.text())
        const data = await res.json()
        row = {
          ...initial!,
          name:          data.name,
          condition:     data.condition,
          scope:         data.scope,
          channels:      data.channels,
          cooldownHours: data.cooldown_hours,
        }
      } else {
        const res = await fetch('/api/v1/alerts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error(await res.text())
        const data = await res.json()
        row = {
          id:            data.id,
          name:          data.name,
          triggerType:   data.trigger_type,
          condition:     data.condition,
          scope:         data.scope,
          channels:      data.channels,
          isActive:      data.is_active,
          firedCount:    data.fired_count ?? 0,
          lastFiredAt:   data.last_fired_at ?? null,
          cooldownHours: data.cooldown_hours,
          createdAt:     data.created_at,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[560px] bg-white dark:bg-[#141428] rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-[15px] font-bold text-[var(--fg)]">{isEdit ? 'Edit alert rule' : 'New alert rule'}</h2>
            <p className="text-[12px] text-[var(--fg-tertiary)] mt-0.5">Get notified when spend events happen</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)]">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Templates */}
          {!isEdit && (
            <div>
              <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Quick start</label>
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATES.map(t => (
                  <button key={t.name} onClick={() => applyTemplate(t)}
                    className={cn('flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all',
                      name === t.name ? 'border-coral bg-[var(--red-bg)]' : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]')}>
                    <Zap size={13} className={cn('mt-0.5 flex-shrink-0', name === t.name ? 'text-coral' : 'text-[var(--fg-tertiary)]')} />
                    <div>
                      <p className={cn('text-[12px] font-semibold', name === t.name ? 'text-coral' : 'text-[var(--fg)]')}>{t.name}</p>
                      <p className="text-[10.5px] text-[var(--fg-tertiary)]">{t.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Rule name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Daily spend over $200"
              className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral" />
          </div>

          {/* Trigger */}
          {!isEdit && (
            <div>
              <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Trigger</label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(TRIGGER_META) as TriggerType[]).map(t => {
                  const tm     = TRIGGER_META[t]
                  const active = trigger === t
                  return (
                    <button key={t} onClick={() => setTrigger(t)}
                      className={cn('flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[12.5px] font-semibold transition-all text-left',
                        active ? `${tm.bg} ${tm.color} border-current/30` : 'border-[var(--border)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]')}>
                      <span className={cn('w-2 h-2 rounded-full', active ? 'bg-current' : 'bg-[var(--border-strong)]')} />
                      {tm.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Threshold + Scope (threshold trigger) */}
          {trigger === 'threshold' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Threshold</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[var(--fg-tertiary)]">$</span>
                  <input type="number" value={threshold} onChange={e => setThreshold(e.target.value)} placeholder="200"
                    className="w-full pl-7 pr-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral" />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Scope</label>
                <input value={scope} onChange={e => setScope(e.target.value)} placeholder="All projects"
                  className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral" />
              </div>
            </div>
          )}

          {/* Channels */}
          <div>
            <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Notify via</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(CHANNEL_META) as AlertChannel[]).map(ch => {
                const cm     = CHANNEL_META[ch]
                const active = channels[ch]
                const isInApp = ch === 'inapp'
                return (
                  <button key={ch} onClick={() => toggleChannel(ch)}
                    className={cn('flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[12.5px] font-semibold transition-all',
                      active ? `${cm.bg} ${cm.color} border-current/30` : 'border-[var(--border)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]',
                      isInApp && 'opacity-70 cursor-default')}>
                    {active ? <Check size={13} className="text-current" /> : <span className="w-3.5 h-3.5 rounded border-2 border-[var(--border-strong)]" />}
                    {cm.label}
                    {isInApp && <span className="text-[9.5px] ml-auto opacity-70">always</span>}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Cooldown */}
          <div>
            <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">Cooldown</label>
            <div className="flex gap-2">
              {[['1', '1h'], ['4', '4h'], ['24', '24h'], ['168', '1 week']].map(([v, label]) => (
                <button key={v} onClick={() => setCooldown(v)}
                  className={cn('flex-1 py-2 rounded-xl border text-[11.5px] font-semibold transition-all',
                    cooldown === v ? 'bg-[var(--fg)] text-[var(--bg)] border-[var(--fg)]' : 'border-[var(--border)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]')}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-[12px] text-[var(--red)] bg-[var(--red-bg)] border border-[var(--red)]/20 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={!name || saving} className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
            {saving
              ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> {isEdit ? 'Saving…' : 'Creating…'}</>
              : <><Bell size={13} /> {isEdit ? 'Save changes' : 'Create rule'}</>}
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
  initialRules:   AlertRuleRow[]
  initialHistory: AlertHistoryRow[]
  orgId:          string
  userEmail:      string
}

export function AlertsClient({ initialRules, initialHistory, orgId, userEmail }: Props) {
  const [tab,        setTab]        = useState<PageTab>('rules')
  const [rules,      setRules]      = useState<AlertRuleRow[]>(initialRules)
  const [history]                   = useState<AlertHistoryRow[]>(initialHistory)
  const [showModal,  setShowModal]  = useState(false)
  const [editTarget, setEditTarget] = useState<AlertRuleRow | null>(null)
  const [filterType, setFilterType] = useState<TriggerType | 'all'>('all')
  const [search,     setSearch]     = useState('')
  const [sevFilter,  setSevFilter]  = useState<HistorySeverity | 'all'>('all')
  const [toast,      setToast]      = useState('')
  const [toggling,   setToggling]   = useState<string | null>(null)

  const [channels, setChannels] = useState<Channel[]>([
    { id: 'email',   label: 'Email',   desc: 'Send alerts to your account email',              icon: Mail,    connected: true,  detail: userEmail || 'Your email' },
    { id: 'slack',   label: 'Slack',   desc: 'Post to a Slack channel via webhook URL',         icon: Zap,     connected: false },
    { id: 'webhook', label: 'Webhook', desc: 'HTTP POST to your custom endpoint',               icon: Webhook, connected: false },
    { id: 'inapp',   label: 'In-app',  desc: 'Notification bell in the dashboard (always on)', icon: Bell,    connected: true,  detail: 'Always enabled' },
  ])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  async function handleToggle(id: string) {
    const rule = rules.find(r => r.id === id)
    if (!rule) return
    setToggling(id)
    try {
      await fetch('/api/v1/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: !rule.isActive }),
      })
      setRules(prev => prev.map(r => r.id === id ? { ...r, isActive: !r.isActive } : r))
    } finally {
      setToggling(null)
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/v1/alerts?id=${id}`, { method: 'DELETE' })
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
        cooldown_hours: rule.cooldownHours,
        channels:       rule.channels,
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
        channels:      data.channels,
        isActive:      data.is_active,
        firedCount:    0,
        lastFiredAt:   null,
        cooldownHours: data.cooldown_hours,
        createdAt:     data.created_at,
      }
      setRules(prev => [...prev, copy])
      showToast('Rule duplicated')
    }
  }

  function handleConnectChannel(id: AlertChannel) {
    setChannels(prev => prev.map(c => c.id === id ? { ...c, connected: true } : c))
    showToast(`${id} connected`)
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
  const connectedCh   = channels.filter(c => c.connected).length
  const recentHistory = history.filter(e => (Date.now() - new Date(e.createdAt).getTime()) < 86400_000)

  return (
    <div className="space-y-6 max-w-[1100px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Alerts</h1>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">Rule-based notifications for spend events, anomalies and limit breaches</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary flex-shrink-0">
          <Plus size={14} /> New rule
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Active rules',       value: activeRules.toString(),           icon: Bell,          color: 'text-[var(--blue)]',  bg: 'bg-[var(--blue-bg)]'  },
          { label: 'Fired today',        value: recentHistory.length.toString(),  icon: Activity,      color: 'text-[var(--amber)]', bg: 'bg-[var(--amber-bg)]' },
          { label: 'Critical today',     value: recentHistory.filter(e => severityFromType(e.type) === 'critical').length.toString(), icon: AlertTriangle, color: 'text-[var(--red)]', bg: 'bg-[var(--red-bg)]' },
          { label: 'Channels connected', value: `${connectedCh}/${channels.length}`, icon: Link2,      color: 'text-teal',           bg: 'bg-[var(--green-bg)]' },
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
              {([['all', 'All'], ['threshold', 'Threshold'], ['anomaly', 'Anomaly'], ['limit_breach', 'Limit']] as const).map(([v, label]) => (
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
              <button onClick={() => setShowModal(true)} className="btn-primary mt-5"><Plus size={13} /> New rule</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {displayRules.map(rule => (
                <RuleCard key={rule.id} rule={rule}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onEdit={r => { setEditTarget(r); setShowModal(true) }}
                  onDuplicate={handleDuplicate}
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
              <ChannelCard key={ch.id} channel={ch} onConnect={handleConnectChannel} />
            ))}
          </div>

          {/* Quiet hours */}
          <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13.5px] font-bold text-[var(--fg)]">Quiet hours</p>
                <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">Suppress non-critical notifications during these hours</p>
              </div>
              <Toggle on={false} onChange={() => {}} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 opacity-40 pointer-events-none">
              <div>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">From</label>
                <input type="time" defaultValue="22:00" className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)]" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">To</label>
                <input type="time" defaultValue="08:00" className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)]" />
              </div>
            </div>
          </div>

          {/* Test */}
          <div className="p-4 bg-[var(--blue-bg)] border border-[var(--blue)]/20 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Zap size={16} className="text-[var(--blue)] flex-shrink-0" />
              <div>
                <p className="text-[12.5px] font-semibold text-[var(--blue)]">Test your channels</p>
                <p className="text-[11.5px] text-[var(--blue)]/70">Send a test notification to all connected channels</p>
              </div>
            </div>
            <button className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--blue)] text-white text-[12.5px] font-semibold hover:opacity-90 transition-opacity">
              Send test
            </button>
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
