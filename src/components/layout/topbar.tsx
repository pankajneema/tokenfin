'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import {
  Bell, Search, LogOut, Settings, User as UserIcon,
  ChevronRight, Moon, Sun, Check, Sparkles,
  LayoutDashboard, Layers, Users, Key, BarChart3,
  Shield, AlertTriangle, Zap, Clock, Hash,
  TrendingUp, ArrowUpRight, Info, X, ChevronDown,
  DollarSign, Activity, CreditCard, HelpCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'

/* ══════════════════════════════════════════════════════════════
   TYPES
══════════════════════════════════════════════════════════════ */
type NotifType = 'alert' | 'info' | 'success' | 'warning'
type NotifCategory = 'budget' | 'team' | 'system' | 'usage'

interface Notif {
  id: number; type: NotifType; category: NotifCategory
  title: string; body: string; time: string; timeMs: number; read: boolean
}

interface SearchResult {
  type: 'page' | 'project' | 'key' | 'action'
  label: string; desc?: string; href?: string; icon: React.ElementType
  shortcut?: string
}

/* ══════════════════════════════════════════════════════════════
   PAGE META
══════════════════════════════════════════════════════════════ */
const PAGE_META: Record<string, { label: string; desc?: string }> = {
  dashboard:    { label: 'Overview',     desc: 'All projects · last 30 days'       },
  analytics:    { label: 'Analytics',    desc: 'Usage, costs & model breakdown'    },
  projects:     { label: 'Projects',     desc: 'Manage your projects'              },
  teams:        { label: 'Teams',        desc: 'Members & permissions'             },
  keys:         { label: 'API Keys',     desc: 'Manage access keys'               },
  limits:       { label: 'Limits',       desc: 'Budget & spend controls'          },
  alerts:       { label: 'Alerts',       desc: 'Notification rules'               },
  settings:     { label: 'Settings',     desc: 'Workspace configuration'          },
  integrations: { label: 'Integrations', desc: 'Connect your tools'              },
  models:       { label: 'Models',       desc: 'LLM model registry & pricing'    },
}

/* ══════════════════════════════════════════════════════════════
   COMMAND PALETTE DATA
══════════════════════════════════════════════════════════════ */
const NAV_RESULTS: SearchResult[] = [
  { type: 'page',   label: 'Overview',     desc: 'Dashboard home',          href: '/dashboard',          icon: LayoutDashboard },
  { type: 'page',   label: 'Projects',     desc: 'All your projects',       href: '/dashboard/projects', icon: Layers          },
  { type: 'page',   label: 'Teams',        desc: 'Members & permissions',   href: '/dashboard/teams',    icon: Users           },
  { type: 'page',   label: 'API Keys',     desc: 'Manage access keys',      href: '/dashboard/keys',     icon: Key             },
  { type: 'page',   label: 'Analytics',    desc: 'Usage & costs',           href: '/dashboard/analytics',icon: BarChart3       },
  { type: 'page',   label: 'Limits',       desc: 'Budget controls',         href: '/dashboard/limits',   icon: Shield          },
  { type: 'page',   label: 'Alerts',       desc: 'Notification rules',      href: '/dashboard/alerts',   icon: Bell            },
  { type: 'page',   label: 'Settings',     desc: 'Workspace settings',      href: '/dashboard/settings', icon: Settings        },
  { type: 'action', label: 'New Project',  desc: 'Create a project',        href: '/dashboard/projects', icon: Layers,         shortcut: '⌘N' },
  { type: 'action', label: 'Invite Member',desc: 'Add to your team',        href: '/dashboard/teams',    icon: Users                         },
  { type: 'action', label: 'View Usage',   desc: 'Cost breakdown',          href: '/dashboard/analytics',icon: TrendingUp                    },
]

const RECENT_PAGES = [
  { label: 'Overview',  href: '/dashboard',          icon: LayoutDashboard },
  { label: 'Projects',  href: '/dashboard/projects', icon: Layers          },
  { label: 'Teams',     href: '/dashboard/teams',    icon: Users           },
]

/* ══════════════════════════════════════════════════════════════
   MOCK NOTIFICATIONS
══════════════════════════════════════════════════════════════ */
const now = Date.now()
const MOCK_NOTIFS: Notif[] = [
  { id: 1, type: 'alert',   category: 'budget', title: 'Budget threshold reached',
    body: 'Backend API is at 85% of monthly budget ($1,530 / $1,800)',
    time: '2m ago', timeMs: now - 120_000, read: false },
  { id: 2, type: 'warning', category: 'usage',  title: 'Spike in token usage',
    body: 'ML Pipeline usage is 3.2× above 7-day average — possible runaway job',
    time: '18m ago', timeMs: now - 1_080_000, read: false },
  { id: 3, type: 'info',    category: 'team',   title: 'New member joined',
    body: 'alex@company.com accepted your invite and joined Backend Team',
    time: '1h ago', timeMs: now - 3_600_000, read: false },
  { id: 4, type: 'success', category: 'system', title: 'Model prices refreshed',
    body: 'Pricing data synced from Anthropic, OpenAI & Google — 12 models updated',
    time: '3h ago', timeMs: now - 10_800_000, read: true },
  { id: 5, type: 'info',    category: 'team',   title: 'API key created',
    body: 'sam@company.com created key "prod-backend-v3" in Backend API',
    time: '5h ago', timeMs: now - 18_000_000, read: true },
  { id: 6, type: 'success', category: 'system', title: 'Weekly report ready',
    body: 'Your cost attribution report for June 9–15 is ready to view',
    time: 'Yesterday', timeMs: now - 86_400_000, read: true },
]

type NotifTab = 'all' | 'budget' | 'team' | 'system'

const NOTIF_TABS: { key: NotifTab; label: string }[] = [
  { key: 'all',    label: 'All'    },
  { key: 'budget', label: 'Budget' },
  { key: 'team',   label: 'Team'   },
  { key: 'system', label: 'System' },
]

/* ══════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════ */
const NOTIF_ICON_META: Record<NotifType, { icon: React.ElementType; dot: string; bg: string; fg: string }> = {
  alert:   { icon: AlertTriangle, dot: '#E8533A', bg: 'bg-[var(--red-bg)]',   fg: 'text-[var(--red)]'   },
  warning: { icon: Zap,           dot: '#F59E0B', bg: 'bg-[var(--amber-bg)]', fg: 'text-[var(--amber)]' },
  info:    { icon: Info,          dot: '#60A5FA', bg: 'bg-[var(--blue-bg)]',  fg: 'text-[var(--blue)]'  },
  success: { icon: Check,         dot: '#00C48C', bg: 'bg-[var(--green-bg)]', fg: 'text-teal'           },
}

const CATEGORY_BADGE: Record<NotifCategory, string> = {
  budget: 'bg-[var(--red-bg)] text-[var(--red)]',
  usage:  'bg-[var(--amber-bg)] text-[var(--amber)]',
  team:   'bg-[var(--blue-bg)] text-[var(--blue)]',
  system: 'bg-[var(--bg-tertiary)] text-[var(--fg-secondary)]',
}

/* ══════════════════════════════════════════════════════════════
   COMMAND PALETTE
══════════════════════════════════════════════════════════════ */
function CommandPalette({ onClose }: { onClose: () => void }) {
  const router   = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query,   setQuery]   = useState('')
  const [cursor,  setCursor]  = useState(0)

  const results = query.trim()
    ? NAV_RESULTS.filter(r =>
        r.label.toLowerCase().includes(query.toLowerCase()) ||
        (r.desc ?? '').toLowerCase().includes(query.toLowerCase())
      )
    : null

  const shown = results ?? NAV_RESULTS.slice(0, 5)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50) }, [])
  useEffect(() => { setCursor(0) }, [query])

  function go(href?: string) {
    if (href) { router.push(href); onClose() }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, shown.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    if (e.key === 'Enter')     { go(shown[cursor]?.href) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[3px]" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-[560px] bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden">

        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--border)]">
          <Search size={16} className="text-[var(--fg-tertiary)] flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search pages, projects, actions…"
            className="flex-1 bg-transparent text-[14px] text-[var(--fg)] placeholder:text-[var(--fg-tertiary)] focus:outline-none"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-[var(--fg-tertiary)] hover:text-[var(--fg)] transition-colors">
              <X size={14} />
            </button>
          )}
          <kbd className="flex items-center px-1.5 py-0.5 bg-[var(--bg-tertiary)] rounded text-[10px] font-mono text-[var(--fg-tertiary)] border border-[var(--border)] flex-shrink-0">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[360px] overflow-y-auto">
          {!query && (
            <div className="px-4 pt-3 pb-1.5">
              <div className="flex items-center gap-1.5 mb-2">
                <Clock size={11} className="text-[var(--fg-tertiary)]" />
                <span className="text-[10.5px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider">Recent</span>
              </div>
              <div className="flex gap-1.5 flex-wrap mb-3">
                {RECENT_PAGES.map(p => (
                  <button
                    key={p.href}
                    onClick={() => go(p.href)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[11.5px] text-[var(--fg-secondary)] hover:text-[var(--fg)] hover:border-[var(--border-strong)] transition-all"
                  >
                    <p.icon size={11} /> {p.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Hash size={11} className="text-[var(--fg-tertiary)]" />
                <span className="text-[10.5px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider">Navigation</span>
              </div>
            </div>
          )}

          {shown.map((r, i) => {
            const Icon = r.icon
            const isPage   = r.type === 'page'
            const isAction = r.type === 'action'
            return (
              <button
                key={r.label}
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(r.href)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
                  cursor === i ? 'bg-[var(--bg-secondary)]' : 'hover:bg-[var(--bg-hover)]',
                )}
              >
                <div className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                  isAction ? 'bg-coral/10' : 'bg-[var(--bg-tertiary)]'
                )}>
                  <Icon size={15} className={isAction ? 'text-coral' : 'text-[var(--fg-secondary)]'} strokeWidth={1.75} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-[var(--fg)] leading-tight">{r.label}</p>
                  {r.desc && <p className="text-[11.5px] text-[var(--fg-tertiary)] leading-tight mt-0.5">{r.desc}</p>}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {r.shortcut && (
                    <kbd className="px-1.5 py-0.5 bg-[var(--bg-tertiary)] rounded text-[10px] font-mono text-[var(--fg-tertiary)] border border-[var(--border)]">
                      {r.shortcut}
                    </kbd>
                  )}
                  {cursor === i && <ArrowUpRight size={12} className="text-[var(--fg-tertiary)]" />}
                </div>
              </button>
            )
          })}

          {results?.length === 0 && (
            <div className="px-4 py-10 text-center">
              <p className="text-[13px] text-[var(--fg-secondary)]">No results for "<span className="text-[var(--fg)]">{query}</span>"</p>
              <p className="text-[11.5px] text-[var(--fg-tertiary)] mt-1">Try searching for pages, projects, or actions</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--border)] bg-[var(--bg-secondary)]/60">
          <div className="flex items-center gap-3 text-[10.5px] text-[var(--fg-tertiary)]">
            <span className="flex items-center gap-1"><kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border)] rounded px-1">↑↓</kbd> navigate</span>
            <span className="flex items-center gap-1"><kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border)] rounded px-1">↵</kbd> open</span>
          </div>
          <span className="text-[10.5px] text-[var(--fg-tertiary)]">⌘K to toggle</span>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   NOTIFICATIONS PANEL
══════════════════════════════════════════════════════════════ */
function NotificationsPanel({
  notifs, onRead, onReadAll, onClose, router,
}: {
  notifs: Notif[]
  onRead: (id: number) => void
  onReadAll: () => void
  onClose: () => void
  router: ReturnType<typeof useRouter>
}) {
  const [tab, setTab] = useState<NotifTab>('all')

  const filtered = tab === 'all'
    ? notifs
    : notifs.filter(n => n.category === tab || (tab === 'budget' && n.category === 'usage'))

  const unread = notifs.filter(n => !n.read).length

  return (
    <div className="w-[380px] bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[520px]">

      {/* Header */}
      <div className="px-4 pt-4 pb-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-bold text-[var(--fg)]">Notifications</h3>
            {unread > 0 && (
              <span className="px-1.5 py-0.5 bg-coral text-white text-[10px] font-bold rounded-full leading-none">
                {unread}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unread > 0 && (
              <button
                onClick={onReadAll}
                className="flex items-center gap-1 text-[11.5px] text-coral hover:underline font-semibold"
              >
                <Check size={11} /> Mark all read
              </button>
            )}
            <button
              onClick={() => { router.push('/dashboard/settings'); onClose() }}
              className="w-6 h-6 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--fg)] transition-colors"
            >
              <Settings size={12} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5 -mx-1">
          {NOTIF_TABS.map(t => {
            const count = t.key === 'all'
              ? notifs.filter(n => !n.read).length
              : notifs.filter(n => !n.read && (n.category === t.key || (t.key === 'budget' && n.category === 'usage'))).length
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'flex items-center gap-1 px-3 py-2 text-[11.5px] font-semibold rounded-lg transition-all',
                  tab === t.key
                    ? 'text-[var(--fg)] bg-[var(--bg-secondary)]'
                    : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]'
                )}
              >
                {t.label}
                {count > 0 && (
                  <span className={cn('text-[9px] font-bold px-1 rounded-full', tab === t.key ? 'bg-coral text-white' : 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]')}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* List */}
      <div className="overflow-y-auto flex-1 mt-1">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <div className="w-10 h-10 rounded-2xl bg-[var(--bg-secondary)] flex items-center justify-center">
              <Bell size={18} className="text-[var(--fg-tertiary)]" />
            </div>
            <p className="text-[13px] text-[var(--fg-secondary)]">All caught up</p>
            <p className="text-[11.5px] text-[var(--fg-tertiary)]">No notifications in this category</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {filtered.map(n => {
              const m    = NOTIF_ICON_META[n.type]
              const Icon = m.icon
              return (
                <div
                  key={n.id}
                  onClick={() => onRead(n.id)}
                  className={cn(
                    'flex items-start gap-3 px-4 py-3.5 cursor-pointer transition-colors group relative',
                    n.read ? 'hover:bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-secondary)]'
                  )}
                >
                  {/* Unread stripe */}
                  {!n.read && (
                    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-coral rounded-r-full" />
                  )}

                  {/* Icon */}
                  <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5', m.bg)}>
                    <Icon size={14} className={m.fg} strokeWidth={2} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn('text-[12.5px] leading-snug', n.read ? 'text-[var(--fg-secondary)] font-normal' : 'text-[var(--fg)] font-semibold')}>
                        {n.title}
                      </p>
                      {!n.read && <span className="w-2 h-2 rounded-full bg-coral flex-shrink-0 mt-1" />}
                    </div>
                    <p className="text-[11.5px] text-[var(--fg-tertiary)] leading-snug mt-0.5">{n.body}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={cn('text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full', CATEGORY_BADGE[n.category])}>
                        {n.category}
                      </span>
                      <span className="text-[10.5px] text-[var(--fg-tertiary)]">{n.time}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-secondary)]/50">
        <button
          onClick={() => { onClose(); router.push('/dashboard/settings/notifications') }}
          className="w-full flex items-center justify-center gap-1.5 text-[12px] font-semibold text-[var(--fg-secondary)] hover:text-coral transition-colors"
        >
          Notification preferences <Settings size={11} />
        </button>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   PROFILE MENU
══════════════════════════════════════════════════════════════ */
function ProfileMenu({
  user, displayName, avatarLetter, onClose, onSignOut, router,
}: {
  user: User
  displayName: string
  avatarLetter: string
  onClose: () => void
  onSignOut: () => void
  router: ReturnType<typeof useRouter>
}) {
  // Mock usage data
  const usagePct = 68
  const tokensUsed  = '8.4M'
  const tokensLimit = '12M'

  function go(href: string) { onClose(); router.push(href) }

  return (
    <div className="w-[260px] bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden">

      {/* User card */}
      <div className="px-4 py-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div className="relative">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-coral to-[#f07260] flex items-center justify-center flex-shrink-0 shadow-sm">
              <span className="text-[16px] font-bold text-white">{avatarLetter}</span>
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-teal border-2 border-[var(--bg)]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold text-[var(--fg)] truncate">{displayName}</p>
            <p className="text-[11px] text-[var(--fg-tertiary)] truncate">{user.email}</p>
          </div>
        </div>

        {/* Plan badge */}
        <div className="flex items-center justify-between mt-3">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-coral/10 border border-coral/20 text-[10.5px] font-bold text-coral">
            <Sparkles size={9} /> Pro Plan
          </span>
          <button
            onClick={() => go('/dashboard/settings')}
            className="text-[10.5px] font-semibold text-[var(--fg-tertiary)] hover:text-coral transition-colors"
          >
            Manage plan →
          </button>
        </div>

        {/* Token usage bar */}
        <div className="mt-3">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-[10px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider">Monthly tokens</span>
            <span className="text-[10.5px] font-semibold text-[var(--fg-secondary)] tabular-nums">
              {tokensUsed} / {tokensLimit}
            </span>
          </div>
          <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${usagePct}%`,
                background: usagePct >= 90 ? '#E8533A' : usagePct >= 70 ? '#F59E0B' : '#00C48C',
              }}
            />
          </div>
          <p className="text-[10px] text-[var(--fg-tertiary)] mt-1">{usagePct}% used · resets Jul 1</p>
        </div>
      </div>

      {/* Menu items */}
      <div className="py-1.5">
        {[
          { icon: UserIcon,   label: 'Profile',  desc: 'Account info',    href: '/dashboard/settings' },
          { icon: CreditCard, label: 'Billing',  desc: 'Plan & invoices', href: '/dashboard/settings/billing' },
        ].map(({ icon: Icon, label, desc, href }) => (
          <button
            key={label}
            onClick={() => go(href)}
            className="w-full flex items-center gap-3 px-4 py-2 hover:bg-[var(--bg-hover)] transition-colors group"
          >
            <div className="w-7 h-7 rounded-lg bg-[var(--bg-secondary)] flex items-center justify-center flex-shrink-0 group-hover:bg-[var(--bg-tertiary)] transition-colors">
              <Icon size={13} className="text-[var(--fg-secondary)]" strokeWidth={1.75} />
            </div>
            <div className="text-left">
              <p className="text-[12.5px] font-semibold text-[var(--fg)]">{label}</p>
              <p className="text-[10.5px] text-[var(--fg-tertiary)]">{desc}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Divider + signout */}
      <div className="px-3 pt-1 pb-2 border-t border-[var(--border)]">
        <button
          onClick={onSignOut}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[12.5px] font-semibold text-[var(--red)] hover:bg-[var(--red-bg)] transition-colors"
        >
          <div className="w-7 h-7 rounded-lg bg-[var(--red-bg)] flex items-center justify-center flex-shrink-0">
            <LogOut size={13} className="text-[var(--red)]" strokeWidth={1.75} />
          </div>
          Sign out
        </button>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   MAIN TOPBAR
══════════════════════════════════════════════════════════════ */
export function Topbar({ user }: { user: User }) {
  const router   = useRouter()
  const pathname = usePathname()
  const supabase = createClient()
  const { resolvedTheme, setTheme } = useTheme()

  const [searchOpen, setSearchOpen] = useState(false)
  const [notifOpen,  setNotifOpen]  = useState(false)
  const [menuOpen,   setMenuOpen]   = useState(false)
  const [notifs,     setNotifs]     = useState(MOCK_NOTIFS)

  const unread = notifs.filter(n => !n.read).length

  /* ── Global ⌘K shortcut ── */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(v => !v)
        setNotifOpen(false)
        setMenuOpen(false)
      }
      if (e.key === 'Escape') {
        setSearchOpen(false)
        setNotifOpen(false)
        setMenuOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* ── Breadcrumb ── */
  const segments = pathname.split('/').filter(Boolean)
  const lastSeg  = segments[segments.length - 1] ?? 'dashboard'
  const meta     = PAGE_META[lastSeg] ?? { label: lastSeg.charAt(0).toUpperCase() + lastSeg.slice(1) }

  const crumbs = segments
    .filter(s => s !== 'dashboard' || segments.length === 1)
    .map((seg, i, arr) => ({
      label: PAGE_META[seg]?.label ?? seg.charAt(0).toUpperCase() + seg.slice(1),
      last:  i === arr.length - 1,
    }))

  async function signOut() {
    setMenuOpen(false)
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  function closeAll() {
    setNotifOpen(false)
    setMenuOpen(false)
  }

  const displayName  = user.user_metadata?.full_name ?? user.email ?? 'User'
  const avatarLetter = displayName[0].toUpperCase()

  return (
    <>
      <header className="flex items-center justify-between h-[56px] px-5 bg-[var(--bg)] border-b border-[var(--border)] flex-shrink-0 z-20 relative">

        {/* ── Left: breadcrumb ── */}
        <div className="flex flex-col justify-center min-w-0">
          {crumbs.length > 1 && (
            <div className="flex items-center gap-1 mb-0.5">
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight size={10} className="text-[var(--fg-tertiary)]" />}
                  <span className={cn(
                    'text-[10.5px]',
                    c.last ? 'text-[var(--fg-secondary)] font-medium' : 'text-[var(--fg-tertiary)]'
                  )}>
                    {c.label}
                  </span>
                </span>
              ))}
            </div>
          )}
          <h1 className="text-[14.5px] font-bold text-[var(--fg)] leading-tight tracking-tight truncate">
            {meta.label}
          </h1>
        </div>

        {/* ── Right: actions ── */}
        <div className="flex items-center gap-1 flex-shrink-0">

          {/* ── Search ── */}
          <button
            onClick={() => { setSearchOpen(true); closeAll() }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] text-[12px] text-[var(--fg-tertiary)] hover:border-[var(--border-strong)] hover:text-[var(--fg-secondary)] hover:bg-[var(--bg-tertiary)] transition-all"
            aria-label="Search (⌘K)"
          >
            <Search size={13} strokeWidth={1.75} />
            <span className="hidden md:block text-[12px]">Search…</span>
            <kbd className="hidden md:flex items-center gap-0.5 px-1.5 py-0.5 bg-[var(--bg-tertiary)] rounded text-[10px] font-mono text-[var(--fg-tertiary)] border border-[var(--border)]">
              ⌘K
            </kbd>
          </button>

          {/* ── Theme toggle ── */}
          <button
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--fg)] transition-all"
            aria-label="Toggle theme"
          >
            {resolvedTheme === 'dark'
              ? <Sun size={15} strokeWidth={1.75} />
              : <Moon size={15} strokeWidth={1.75} />}
          </button>

          {/* ── Notifications ── */}
          <div className="relative">
            <button
              onClick={() => { setNotifOpen(v => !v); setMenuOpen(false) }}
              className={cn(
                'relative w-8 h-8 rounded-lg flex items-center justify-center transition-all',
                notifOpen
                  ? 'bg-[var(--bg-secondary)] text-[var(--fg)]'
                  : 'text-[var(--fg-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--fg)]'
              )}
              aria-label="Notifications"
            >
              <Bell size={15} strokeWidth={1.75} />
              {unread > 0 && (
                <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-0.5 bg-coral rounded-full text-[9px] font-bold text-white flex items-center justify-center leading-none shadow-sm">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>

            {notifOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setNotifOpen(false)} />
                <div className="absolute right-0 top-full mt-2 z-40 animate-slide-up">
                  <NotificationsPanel
                    notifs={notifs}
                    onRead={id => setNotifs(prev => prev.map(x => x.id === id ? { ...x, read: true } : x))}
                    onReadAll={() => setNotifs(prev => prev.map(x => ({ ...x, read: true })))}
                    onClose={() => setNotifOpen(false)}
                    router={router}
                  />
                </div>
              </>
            )}
          </div>

          {/* Divider */}
          <div className="w-px h-5 bg-[var(--border)] mx-1" />

          {/* ── Profile / User menu ── */}
          <div className="relative">
            <button
              onClick={() => { setMenuOpen(v => !v); setNotifOpen(false) }}
              className={cn(
                'flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 rounded-xl transition-all',
                menuOpen ? 'bg-[var(--bg-secondary)]' : 'hover:bg-[var(--bg-secondary)]'
              )}
            >
              {/* Avatar */}
              <div className="relative">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-coral to-[#f07260] flex items-center justify-center flex-shrink-0 shadow-sm">
                  <span className="text-[11px] font-bold text-white">{avatarLetter}</span>
                </div>
                <span className="absolute -bottom-px -right-px w-2.5 h-2.5 rounded-full bg-teal border-2 border-[var(--bg)]" />
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-[12px] font-semibold text-[var(--fg)] leading-tight max-w-[100px] truncate">
                  {displayName}
                </p>
                <p className="text-[9.5px] text-[var(--fg-tertiary)]">Pro Plan</p>
              </div>
              <ChevronDown size={12} className={cn('text-[var(--fg-tertiary)] transition-transform duration-200', menuOpen && 'rotate-180')} />
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-2 z-40 animate-slide-up">
                  <ProfileMenu
                    user={user}
                    displayName={displayName}
                    avatarLetter={avatarLetter}
                    onClose={() => setMenuOpen(false)}
                    onSignOut={signOut}
                    router={router}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Command Palette (portal-like, rendered outside header) ── */}
      {searchOpen && <CommandPalette onClose={() => setSearchOpen(false)} />}
    </>
  )
}
