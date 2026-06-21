'use client'
import { useState } from 'react'
import {
  Bell, Mail, Save, Check,
  AlertTriangle, TrendingUp, Users, Zap, Shield,
  Clock, ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NotifPrefs } from './page'

/* ── Toggle ── */
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)}
      className={cn('relative flex-shrink-0 transition-colors duration-200',
        on ? 'bg-coral' : 'bg-[var(--bg-tertiary)]')}
      style={{ width: 40, height: 22, borderRadius: 11 }}>
      <span className={cn('absolute top-0.5 rounded-full bg-white shadow-sm transition-all duration-200',
        on ? 'left-[18px]' : 'left-[2px]')}
        style={{ width: 18, height: 18 }} />
    </button>
  )
}

/* ── Section ── */
function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--border)]">
        <h2 className="text-[13.5px] font-bold text-[var(--fg)]">{title}</h2>
        {desc && <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">{desc}</p>}
      </div>
      <div className="divide-y divide-[var(--border)]">{children}</div>
    </div>
  )
}

/* ── Notification row ── */
function NotifRow({ icon: Icon, iconColor, iconBg, label, desc, emailKey, inAppKey, slackKey, critical, prefs, onChange }: {
  icon: React.ElementType; iconColor: string; iconBg: string
  label: string; desc: string
  emailKey:  keyof NotifPrefs
  inAppKey?: keyof NotifPrefs
  slackKey?: keyof NotifPrefs
  critical?: boolean
  prefs:     NotifPrefs
  onChange:  (key: keyof NotifPrefs, val: boolean) => void
}) {
  return (
    <div className="px-6 py-4 flex items-start gap-5">
      <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5', iconBg)}>
        <Icon size={16} className={iconColor} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-semibold text-[var(--fg)]">{label}</p>
          {critical && (
            <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--red-bg)] text-[var(--red)]">Required</span>
          )}
        </div>
        <p className="text-[11.5px] text-[var(--fg-secondary)] mt-0.5 leading-relaxed">{desc}</p>
      </div>
      <div className="flex items-center gap-5 flex-shrink-0 mt-1">
        <div className="flex flex-col items-center gap-1.5">
          <Toggle on={prefs[emailKey] as boolean} onChange={v => onChange(emailKey, v)} />
          <span className="text-[10px] text-[var(--fg-tertiary)] flex items-center gap-0.5"><Mail size={9} /> Email</span>
        </div>
        {inAppKey && (
          <div className="flex flex-col items-center gap-1.5">
            <Toggle on={prefs[inAppKey] as boolean} onChange={v => onChange(inAppKey, v)} />
            <span className="text-[10px] text-[var(--fg-tertiary)] flex items-center gap-0.5"><Bell size={9} /> In-app</span>
          </div>
        )}
        {slackKey && (
          <div className="flex flex-col items-center gap-1.5">
            <Toggle on={prefs[slackKey] as boolean} onChange={v => onChange(slackKey, v)} />
            <span className="text-[10px] text-[var(--fg-tertiary)]">Slack</span>
          </div>
        )}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   CLIENT
══════════════════════════════════════════════════════════════ */
interface Props {
  initialPrefs: NotifPrefs
  userEmail:    string
}

export function NotificationsClient({ initialPrefs, userEmail }: Props) {
  const [prefs,     setPrefs]     = useState<NotifPrefs>(initialPrefs)
  const [saving,    setSaving]    = useState(false)
  const [toast,     setToast]     = useState(false)
  const [quietOpen, setQuietOpen] = useState(false)

  function set(key: keyof NotifPrefs, val: boolean) {
    setPrefs(prev => ({ ...prev, [key]: val }))
  }

  async function save() {
    setSaving(true)
    try {
      await fetch('/api/v1/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      })
      setToast(true); setTimeout(() => setToast(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* Channel overview */}
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5">
        <p className="text-[13.5px] font-bold text-[var(--fg)] mb-4">Delivery channels</p>
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: Mail,  label: 'Email',  value: userEmail,            enabled: true,  color: 'text-coral',         bg: 'bg-coral/10'         },
            { icon: Bell,  label: 'In-app', value: 'Notification center', enabled: true, color: 'text-[var(--blue)]', bg: 'bg-[var(--blue-bg)]' },
            { icon: Zap,   label: 'Slack',  value: 'Not connected',       enabled: false, color: 'text-[#4A154B]',    bg: 'bg-[#4A154B]/10'    },
          ].map(c => {
            const Icon = c.icon
            return (
              <div key={c.label} className={cn('flex items-center gap-3 p-3 rounded-xl border',
                c.enabled ? 'border-[var(--border)]' : 'border-dashed border-[var(--border)] opacity-60')}>
                <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', c.bg)}>
                  <Icon size={14} className={c.color} />
                </div>
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-[var(--fg)]">{c.label}</p>
                  <p className="text-[10.5px] text-[var(--fg-tertiary)] truncate">{c.value}</p>
                </div>
                {c.enabled
                  ? <Check size={13} className="text-teal ml-auto flex-shrink-0" />
                  : <a href="/dashboard/integrations" className="text-[10.5px] font-semibold text-coral ml-auto flex-shrink-0 hover:underline">Connect</a>
                }
              </div>
            )
          })}
        </div>
      </div>

      {/* Notification rules */}
      <Section title="Notification rules" desc="Choose which events you want to be notified about">
        <NotifRow
          icon={AlertTriangle} iconColor="text-[var(--red)]" iconBg="bg-[var(--red-bg)]"
          label="Budget & limit breaches" desc="Alert when a project or team exceeds its spending limit or token budget."
          emailKey="budget_breach_email" slackKey="budget_breach_slack" critical
          prefs={prefs} onChange={set}
        />
        <NotifRow
          icon={TrendingUp} iconColor="text-[var(--amber)]" iconBg="bg-[var(--amber-bg)]"
          label="Spend anomalies" desc="Notify when token usage spikes significantly above historical baseline."
          emailKey="anomaly_email" inAppKey="anomaly_inapp"
          prefs={prefs} onChange={set}
        />
        <NotifRow
          icon={Mail} iconColor="text-coral" iconBg="bg-coral/10"
          label="Weekly digest" desc="Weekly summary of LLM costs, top models, and team breakdowns."
          emailKey="weekly_digest_email" inAppKey="weekly_digest_inapp"
          prefs={prefs} onChange={set}
        />
        <NotifRow
          icon={Users} iconColor="text-[var(--blue)]" iconBg="bg-[var(--blue-bg)]"
          label="Team & member events" desc="New member invitations, role changes, and team updates."
          emailKey="member_events_email" inAppKey="member_events_inapp"
          prefs={prefs} onChange={set}
        />
        <NotifRow
          icon={Shield} iconColor="text-[#8B5CF6]" iconBg="bg-[#8B5CF6]/10"
          label="API & ingest errors" desc="Notify when a connected platform starts failing to send usage data."
          emailKey="api_errors_email" inAppKey="api_errors_inapp"
          prefs={prefs} onChange={set}
        />
      </Section>

      {/* Quiet hours */}
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
        <button onClick={() => setQuietOpen(v => !v)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-[var(--bg-hover)] transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--bg-secondary)] flex items-center justify-center">
              <Clock size={16} className="text-[var(--fg-secondary)]" />
            </div>
            <div className="text-left">
              <p className="text-[13.5px] font-bold text-[var(--fg)]">Quiet hours</p>
              <p className="text-[11.5px] text-[var(--fg-secondary)]">
                Suppress non-critical notifications from {prefs.quiet_start} to {prefs.quiet_end}
              </p>
            </div>
          </div>
          <ChevronDown size={14} className={cn('text-[var(--fg-tertiary)] transition-transform', quietOpen && 'rotate-180')} />
        </button>

        {quietOpen && (
          <div className="px-6 pb-5 pt-2 border-t border-[var(--border)]">
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Start (silence from)', key: 'quiet_start' as const },
                { label: 'End (resume at)',       key: 'quiet_end'   as const },
              ].map(f => (
                <div key={f.label}>
                  <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">{f.label}</label>
                  <input type="time" value={prefs[f.key] as string}
                    onChange={e => setPrefs(prev => ({ ...prev, [f.key]: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral" />
                </div>
              ))}
            </div>
            <p className="text-[11.5px] text-[var(--fg-tertiary)] mt-3">
              Budget breaches and critical alerts are always delivered immediately regardless of quiet hours.
            </p>
          </div>
        )}
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
          {saving
            ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Saving…</>
            : <><Save size={13} /> Save preferences</>
          }
        </button>
      </div>

      {/* Toast */}
      <div className={cn(
        'fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2.5 px-4 py-3 bg-[var(--fg)] text-[var(--bg)] rounded-2xl shadow-2xl text-[13px] font-semibold transition-all duration-300 z-50',
        toast ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none',
      )}>
        <Check size={14} className="text-teal" /> Preferences saved
      </div>
    </>
  )
}
