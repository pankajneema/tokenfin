'use client'
import { useState } from 'react'
import {
  Bell, Mail, Slack, Smartphone, Save, Check,
  AlertTriangle, TrendingUp, Users, Zap, Shield,
  Clock, ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ── Types ── */
interface ChannelState { email: boolean; inApp: boolean; slack: boolean }
interface NotifSetting {
  id: string
  label: string
  desc: string
  icon: React.ElementType
  iconColor: string
  iconBg: string
  channels: ChannelState
  frequency?: 'instant' | 'daily' | 'weekly'
  critical?: boolean
}

/* ── Toggle ── */
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={cn(
        'w-10 h-5.5 rounded-full relative transition-colors duration-200 flex-shrink-0',
        on ? 'bg-coral' : 'bg-[var(--bg-tertiary)]',
      )}
      style={{ height: 22, width: 40 }}
    >
      <span className={cn(
        'absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow-sm transition-all duration-200',
        on ? 'left-[18px]' : 'left-[2px]',
      )} style={{ width: 18, height: 18 }} />
    </button>
  )
}

/* ── Section card ── */
function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--border)]">
        <h2 className="text-[13.5px] font-bold text-[var(--fg)]">{title}</h2>
        {desc && <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">{desc}</p>}
      </div>
      <div>{children}</div>
    </div>
  )
}

/* ── Channel header ── */
function ChannelHeaders() {
  return (
    <div className="grid grid-cols-[1fr_90px_90px_90px] gap-2 px-6 py-2.5 border-b border-[var(--border)] bg-[var(--bg-secondary)]/60">
      <div />
      {[
        { icon: Mail,       label: 'Email'  },
        { icon: Bell,       label: 'In-app' },
        { icon: Slack,      label: 'Slack'  },
      ].map(c => (
        <div key={c.label} className="flex flex-col items-center gap-1">
          <c.icon size={13} className="text-[var(--fg-tertiary)]" />
          <span className="text-[10px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider">{c.label}</span>
        </div>
      ))}
    </div>
  )
}

/* ── Frequency selector ── */
function FreqSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="pl-2 pr-6 py-1 rounded-lg border border-[var(--border)] text-[11px] text-[var(--fg-secondary)] bg-[var(--bg)] focus:outline-none focus:border-coral appearance-none cursor-pointer hover:border-[var(--border-strong)] transition-colors"
      >
        <option value="instant">Instantly</option>
        <option value="daily">Daily digest</option>
        <option value="weekly">Weekly summary</option>
      </select>
      <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)] pointer-events-none" />
    </div>
  )
}

/* ── Row ── */
function NotifRow({
  setting, onChange, onFreqChange,
}: {
  setting: NotifSetting
  onChange: (id: string, channel: keyof ChannelState, val: boolean) => void
  onFreqChange: (id: string, val: string) => void
}) {
  const Icon = setting.icon
  const anyOn = setting.channels.email || setting.channels.inApp || setting.channels.slack

  return (
    <div className={cn('grid grid-cols-[1fr_90px_90px_90px] gap-2 items-center px-6 py-4 border-b border-[var(--border)] last:border-0 transition-colors', !anyOn && 'opacity-50')}>
      {/* Info */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: setting.iconBg }}>
          <Icon size={14} strokeWidth={1.75} style={{ color: setting.iconColor }} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[12.5px] font-semibold text-[var(--fg)]">{setting.label}</p>
            {setting.critical && (
              <span className="px-1.5 py-0.5 bg-[var(--red-bg)] text-[var(--red)] text-[9.5px] font-bold rounded-full">Critical</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-[11.5px] text-[var(--fg-tertiary)] truncate">{setting.desc}</p>
            {anyOn && setting.frequency && (
              <FreqSelect value={setting.frequency} onChange={v => onFreqChange(setting.id, v)} />
            )}
          </div>
        </div>
      </div>

      {/* Email */}
      <div className="flex justify-center">
        <Toggle on={setting.channels.email} onChange={v => onChange(setting.id, 'email', v)} />
      </div>
      {/* In-app */}
      <div className="flex justify-center">
        <Toggle on={setting.channels.inApp} onChange={v => onChange(setting.id, 'inApp', v)} />
      </div>
      {/* Slack */}
      <div className="flex justify-center">
        <Toggle on={setting.channels.slack} onChange={v => onChange(setting.id, 'slack', v)} />
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════ */
const DEFAULT_SETTINGS: NotifSetting[] = [
  // Budget & Spend
  {
    id: 'budget_warn', label: 'Budget warning', icon: AlertTriangle,
    desc: 'When a team or project hits warn threshold',
    iconColor: '#F59E0B', iconBg: '#FFF8E7',
    channels: { email: true, inApp: true, slack: true },
    frequency: 'instant', critical: true,
  },
  {
    id: 'budget_throttle', label: 'Budget limit reached', icon: Shield,
    desc: 'When throttle threshold is crossed',
    iconColor: '#E8533A', iconBg: '#FDF0EE',
    channels: { email: true, inApp: true, slack: true },
    frequency: 'instant', critical: true,
  },
  {
    id: 'usage_spike', label: 'Usage spike', icon: TrendingUp,
    desc: 'Sudden increase in tokens or cost (>3×)',
    iconColor: '#8B5CF6', iconBg: '#F5F3FF',
    channels: { email: true, inApp: true, slack: false },
    frequency: 'instant',
  },
  {
    id: 'cost_report', label: 'Cost report', icon: Zap,
    desc: 'Periodic cost breakdown by project & team',
    iconColor: '#00C48C', iconBg: '#E6FAF4',
    channels: { email: true, inApp: false, slack: false },
    frequency: 'weekly',
  },
  // Team & Members
  {
    id: 'member_joined', label: 'New member joined', icon: Users,
    desc: 'When someone accepts an invite',
    iconColor: '#60A5FA', iconBg: '#E6F1FB',
    channels: { email: false, inApp: true, slack: false },
    frequency: 'instant',
  },
  {
    id: 'key_created', label: 'API key created', icon: Shield,
    desc: 'When a team member creates a key',
    iconColor: '#0C447C', iconBg: '#E6F1FB',
    channels: { email: false, inApp: true, slack: false },
    frequency: 'instant',
  },
  // System
  {
    id: 'price_refresh', label: 'Price refresh', icon: Clock,
    desc: 'Model pricing updated from providers',
    iconColor: '#9898B0', iconBg: '#F1EFE9',
    channels: { email: false, inApp: true, slack: false },
    frequency: 'instant',
  },
  {
    id: 'weekly_digest', label: 'Weekly digest', icon: Mail,
    desc: 'Summary of your top insights each Monday',
    iconColor: '#E8533A', iconBg: '#FDECEA',
    channels: { email: true, inApp: false, slack: true },
    frequency: 'weekly',
  },
]

const GROUPS = [
  { key: 'budget',  label: 'Budget & Spend',  ids: ['budget_warn','budget_throttle','usage_spike','cost_report'] },
  { key: 'team',    label: 'Team & Members',   ids: ['member_joined','key_created'] },
  { key: 'system',  label: 'System',           ids: ['price_refresh','weekly_digest'] },
]

export default function NotificationsPage() {
  const [settings,  setSettings]  = useState(DEFAULT_SETTINGS)
  const [slackUrl,  setSlackUrl]  = useState('')
  const [saving,    setSaving]    = useState(false)
  const [toast,     setToast]     = useState(false)
  const [quietFrom, setQuietFrom] = useState('22:00')
  const [quietTo,   setQuietTo]   = useState('08:00')
  const [quietOn,   setQuietOn]   = useState(true)

  function handleChange(id: string, channel: keyof ChannelState, val: boolean) {
    setSettings(prev => prev.map(s => s.id === id ? { ...s, channels: { ...s.channels, [channel]: val } } : s))
  }

  function handleFreqChange(id: string, val: string) {
    setSettings(prev => prev.map(s => s.id === id ? { ...s, frequency: val as any } : s))
  }

  function toggleGroup(ids: string[], channel: keyof ChannelState, targetOn: boolean) {
    setSettings(prev => prev.map(s => ids.includes(s.id) ? { ...s, channels: { ...s.channels, [channel]: targetOn } } : s))
  }

  async function handleSave() {
    setSaving(true)
    await new Promise(r => setTimeout(r, 700))
    setSaving(false)
    setToast(true)
    setTimeout(() => setToast(false), 2500)
  }

  return (
    <>
      {/* ── Delivery channels ── */}
      <Section title="Delivery channels" desc="Connect where you want to receive alerts">
        <div className="divide-y divide-[var(--border)]">

          {/* Email */}
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[var(--blue-bg)] flex items-center justify-center">
                <Mail size={16} className="text-[var(--blue)]" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-[var(--fg)]">Email</p>
                <p className="text-[11.5px] text-[var(--fg-tertiary)]">pankaj200321@gmail.com</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[var(--green-bg)] text-[var(--green)]">Connected</span>
            </div>
          </div>

          {/* In-app */}
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[var(--bg-secondary)] flex items-center justify-center">
                <Bell size={16} className="text-[var(--fg-secondary)]" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-[var(--fg)]">In-app</p>
                <p className="text-[11.5px] text-[var(--fg-tertiary)]">Notification bell in the header</p>
              </div>
            </div>
            <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[var(--green-bg)] text-[var(--green)]">Always on</span>
          </div>

          {/* Slack */}
          <div className="flex items-start justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#FFF0F0] flex items-center justify-center">
                <Slack size={16} className="text-[#E01E5A]" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-[var(--fg)]">Slack</p>
                <p className="text-[11.5px] text-[var(--fg-tertiary)]">Post alerts to a Slack channel</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {slackUrl ? (
                <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[var(--green-bg)] text-[var(--green)]">Connected</span>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    value={slackUrl}
                    onChange={e => setSlackUrl(e.target.value)}
                    placeholder="Paste Slack webhook URL"
                    className="text-[12px] px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] focus:outline-none focus:border-coral w-52 transition-colors"
                  />
                  <button className="btn-primary text-[12px] py-1.5">Connect</button>
                </div>
              )}
            </div>
          </div>

          {/* Mobile push */}
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[var(--bg-secondary)] flex items-center justify-center">
                <Smartphone size={16} className="text-[var(--fg-tertiary)]" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-[var(--fg)]">Mobile push</p>
                <p className="text-[11.5px] text-[var(--fg-tertiary)]">Push notifications via TokenFin app</p>
              </div>
            </div>
            <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]">Coming soon</span>
          </div>
        </div>
      </Section>

      {/* ── Notification rules by group ── */}
      {GROUPS.map(group => {
        const groupSettings = settings.filter(s => group.ids.includes(s.id))
        const allEmail  = groupSettings.every(s => s.channels.email)
        const allInApp  = groupSettings.every(s => s.channels.inApp)
        const allSlack  = groupSettings.every(s => s.channels.slack)

        return (
          <Section key={group.key} title={group.label}>
            {/* Group-level bulk toggle header */}
            <div className="grid grid-cols-[1fr_90px_90px_90px] gap-2 px-6 py-2.5 border-b border-[var(--border)] bg-[var(--bg-secondary)]/60">
              <p className="text-[10.5px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider self-center">
                Notification
              </p>
              {([
                { key: 'email', label: 'Email', icon: Mail, allOn: allEmail },
                { key: 'inApp', label: 'In-app', icon: Bell, allOn: allInApp },
                { key: 'slack', label: 'Slack',  icon: Slack, allOn: allSlack },
              ] as const).map(ch => (
                <div key={ch.key} className="flex flex-col items-center gap-1">
                  <ch.icon size={13} className="text-[var(--fg-tertiary)]" />
                  <button
                    onClick={() => toggleGroup(group.ids, ch.key as keyof ChannelState, !ch.allOn)}
                    className="text-[9px] font-semibold text-coral hover:underline"
                  >
                    {ch.allOn ? 'None' : 'All'}
                  </button>
                </div>
              ))}
            </div>

            {groupSettings.map(s => (
              <NotifRow
                key={s.id}
                setting={s}
                onChange={handleChange}
                onFreqChange={handleFreqChange}
              />
            ))}
          </Section>
        )
      })}

      {/* ── Quiet hours ── */}
      <Section title="Quiet hours" desc="Pause non-critical notifications during these hours">
        <div className="px-6 py-2 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-semibold text-[var(--fg)]">Enable quiet hours</p>
              <p className="text-[11.5px] text-[var(--fg-tertiary)] mt-0.5">Critical budget alerts are always delivered</p>
            </div>
            <Toggle on={quietOn} onChange={setQuietOn} />
          </div>

          {quietOn && (
            <div className="flex items-center gap-4">
              <div>
                <p className="text-[11px] font-semibold text-[var(--fg-secondary)] mb-1.5">From</p>
                <input
                  type="time"
                  value={quietFrom}
                  onChange={e => setQuietFrom(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:border-coral transition-colors"
                />
              </div>
              <div className="text-[var(--fg-tertiary)] mt-5">→</div>
              <div>
                <p className="text-[11px] font-semibold text-[var(--fg-secondary)] mb-1.5">To</p>
                <input
                  type="time"
                  value={quietTo}
                  onChange={e => setQuietTo(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:border-coral transition-colors"
                />
              </div>
              <div className="flex-1" />
              <div className="text-right">
                <p className="text-[11px] text-[var(--fg-tertiary)]">Your timezone</p>
                <p className="text-[12px] font-semibold text-[var(--fg)]">Asia/Kolkata (IST)</p>
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* ── Save ── */}
      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving
            ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Saving…</>
            : <><Save size={13}/> Save preferences</>
          }
        </button>
      </div>

      {/* ── Toast ── */}
      <div className={cn(
        'fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2.5 px-4 py-3 bg-[var(--fg)] text-[var(--bg)] rounded-2xl shadow-2xl text-[13px] font-semibold transition-all duration-300 z-50',
        toast ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none',
      )}>
        <Check size={15} className="text-teal" /> Preferences saved
      </div>
    </>
  )
}
