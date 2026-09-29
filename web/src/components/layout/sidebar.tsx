'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { ChevronLeft, ChevronRight, HelpCircle, Settings, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFocusTrap, useBodyScrollLock } from '@/components/ui/dialog'
import { NAV_SECTIONS, SIDEBAR_HREFS } from './nav-config'
import { activeHref } from './nav-match'

/* ── Tooltip for collapsed mode ────────────────────────────────── */
function NavTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="group/tip relative flex">
      {children}
      <div role="presentation" className="pointer-events-none absolute left-full ml-2.5 top-1/2 -translate-y-1/2 z-50 opacity-0 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100 transition-opacity duration-150">
        <div className="whitespace-nowrap bg-[var(--fg)] text-[var(--bg)] text-[11.5px] font-medium px-2.5 py-1.5 rounded-lg shadow-lg">
          {label}
          <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-[var(--fg)]" />
        </div>
      </div>
    </div>
  )
}

/* ── Nav list (shared by the desktop rail and the mobile drawer) ── */
function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname() ?? '/dashboard'
  const active   = activeHref(pathname, SIDEBAR_HREFS)

  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto overscroll-contain py-3 px-2.5 space-y-4">
      {NAV_SECTIONS.map(section => {
        const headingId = `nav-sec-${section.id}`
        const single = section.items.length === 1 && section.items[0].label === section.label
        return (
          <div key={section.id} role="group" aria-labelledby={single ? undefined : headingId} aria-label={single ? section.label : undefined}>
            {!collapsed && !single && (
              <p id={headingId} className="px-2 pb-1 text-[10px] font-semibold tracking-widest text-[var(--fg-tertiary)] uppercase">
                {section.label}
              </p>
            )}
            {collapsed && section.id !== 'overview' && <div className="mx-2 mb-2 border-t border-[var(--border)]" aria-hidden="true" />}
            <ul className="space-y-0.5">
              {section.items.map(item => {
                const Icon = item.icon
                const isActive = active === item.href
                const link = (
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={isActive ? 'page' : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    className={cn(isActive ? 'nav-item-active' : 'nav-item', 'py-1.5 text-[13px]', collapsed && 'justify-center px-0 w-full')}
                  >
                    <Icon size={16} className="flex-shrink-0" aria-hidden="true" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                )
                return <li key={item.href}>{collapsed ? <NavTooltip label={item.label}>{link}</NavTooltip> : link}</li>
              })}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/dashboard" aria-label="TokenFin home" className="flex items-center">
      {collapsed
        ? <Image src="/favicon.svg" alt="" width={28} height={28} className="flex-shrink-0" />
        : <Image src="/logo.svg" alt="" width={120} height={28} className="h-7 w-auto flex-shrink-0" />}
    </Link>
  )
}

function UserFooter({ user, collapsed, onNavigate }: { user: User; collapsed: boolean; onNavigate?: () => void }) {
  const avatarLetter = (user.user_metadata?.full_name ?? user.email ?? 'U')[0].toUpperCase()
  const displayName  = user.user_metadata?.full_name ?? user.email ?? 'User'
  return (
    <div className="flex-shrink-0 border-t border-[var(--border)]">
      {!collapsed && (
        <div className="px-2.5 pt-2.5 pb-1">
          <a href="mailto:hello@curiousdevs.com?subject=TokenFin%20support" className="nav-item text-[12px] py-1.5">
            <HelpCircle size={14} className="flex-shrink-0" aria-hidden="true" />
            <span>Help & support</span>
          </a>
        </div>
      )}
      <div className={cn('px-2.5 py-2.5', collapsed && 'flex justify-center')}>
        {collapsed ? (
          <NavTooltip label={displayName}>
            <Link href="/dashboard/settings/profile" onClick={onNavigate} aria-label={`Profile settings for ${displayName}`}
              className="w-8 h-8 rounded-full bg-coral/15 border border-coral/25 flex items-center justify-center">
              <span className="text-[12px] font-bold text-coral" aria-hidden="true">{avatarLetter}</span>
            </Link>
          </NavTooltip>
        ) : (
          <Link href="/dashboard/settings/profile" onClick={onNavigate}
            className="flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-[var(--bg-hover)] transition-colors group">
            <div className="w-8 h-8 rounded-full bg-coral/15 border border-coral/25 flex items-center justify-center flex-shrink-0" aria-hidden="true">
              <span className="text-[12px] font-bold text-coral">{avatarLetter}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12.5px] font-semibold text-[var(--fg)] truncate leading-tight">{displayName}</p>
              <p className="text-[10.5px] text-[var(--fg-tertiary)] truncate leading-tight">{user.email}</p>
            </div>
            <Settings size={13} className="text-[var(--fg-tertiary)] group-hover:text-coral transition-colors flex-shrink-0" aria-hidden="true" />
          </Link>
        )}
      </div>
    </div>
  )
}

const COLLAPSE_KEY = 'tf.sidebar.collapsed'

/* ═══ Desktop rail (md and up) ═══════════════════════════════════ */
export function Sidebar({ user }: { user: User }) {
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    try { if (localStorage.getItem(COLLAPSE_KEY) === '1') setCollapsed(true) } catch { /* storage unavailable */ }
  }, [])
  function toggle() {
    setCollapsed(v => {
      try { localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1') } catch { /* ignore */ }
      return !v
    })
  }

  return (
    <aside
      aria-label="Sidebar"
      className={cn(
        'relative hidden md:flex flex-col bg-[var(--sidebar-bg)] border-r border-[var(--border)] transition-[width] duration-200 flex-shrink-0 select-none',
        collapsed ? 'w-[60px]' : 'w-[232px]',
      )}
    >
      <div className={cn('flex items-center gap-2.5 px-4 h-[56px] border-b border-[var(--border)] flex-shrink-0', collapsed && 'justify-center px-0')}>
        <Brand collapsed={collapsed} />
      </div>
      <SidebarNav collapsed={collapsed} />
      <UserFooter user={user} collapsed={collapsed} />
      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        className="absolute -right-3 top-[68px] w-6 h-6 bg-[var(--bg)] border border-[var(--border)] rounded-full flex items-center justify-center text-[var(--fg-tertiary)] hover:text-coral hover:border-coral/50 shadow-soft z-20 transition-colors duration-150"
      >
        {collapsed ? <ChevronRight size={11} strokeWidth={2.5} aria-hidden="true" /> : <ChevronLeft size={11} strokeWidth={2.5} aria-hidden="true" />}
      </button>
    </aside>
  )
}

/* ═══ Mobile drawer (below md) ═══════════════════════════════════ */
export function MobileNavDrawer({ user, open, onClose }: { user: User; open: boolean; onClose: () => void }) {
  const pathname = usePathname()
  const ref = useFocusTrap<HTMLDivElement>(open, onClose)
  useBodyScrollLock(open)

  // Close on navigation (covers back/forward too, not just link clicks).
  const [lastPath, setLastPath] = useState(pathname)
  useEffect(() => {
    if (pathname !== lastPath) { setLastPath(pathname); if (open) onClose() }
  }, [pathname, lastPath, open, onClose])

  // Close if the viewport grows past md while open.
  useEffect(() => {
    if (!open) return
    const mq = window.matchMedia('(min-width: 768px)')
    const onChange = () => { if (mq.matches) onClose() }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="md:hidden fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        id="mobile-nav"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
        className="absolute inset-y-0 left-0 w-[84vw] max-w-[300px] flex flex-col bg-[var(--sidebar-bg)] border-r border-[var(--border)] shadow-2xl focus:outline-none"
      >
        <div className="flex items-center justify-between gap-2 px-4 h-[56px] border-b border-[var(--border)] flex-shrink-0">
          <Brand collapsed={false} />
          <button type="button" onClick={onClose} aria-label="Close navigation" data-autofocus
            className="w-9 h-9 rounded-lg flex items-center justify-center text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <SidebarNav collapsed={false} onNavigate={onClose} />
        <UserFooter user={user} collapsed={false} onNavigate={onClose} />
      </div>
    </div>
  )
}
