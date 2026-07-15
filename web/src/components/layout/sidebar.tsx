'use client'
import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import {
  Zap, LayoutDashboard, BarChart3,
  Layers, Users, UserPlus, Key, Shield, Bell, GitBranch, Settings,
  ChevronLeft, ChevronRight, ChevronDown, HelpCircle, Puzzle, Gauge, Plug,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ── Nav structure ─────────────────────────────────────────────── */
type NavItem = {
  label:    string
  href?:    string
  icon:     React.ElementType
  children?: { label: string; href: string }[]
}

type NavGroup = {
  label?: string
  items:  NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { label: 'Overview', href: '/dashboard',  icon: LayoutDashboard },
      { label: 'My Usage', href: '/dashboard/my-usage', icon: Gauge },
      { label: 'Projects', href: '/dashboard/projects', icon: Layers },
      { label: 'Teams',    href: '/dashboard/teams',    icon: Users },
      { label: 'Provision', href: '/dashboard/provision', icon: UserPlus },
    ],
  },
  {
    label: 'Analytics',
    items: [
      {
        label: 'Analytics',
        icon:  BarChart3,
        children: [
          { label: 'Usage',        href: '/dashboard/analytics'          },
          { label: 'By Model',     href: '/dashboard/analytics/models'   },
          { label: 'By Project',   href: '/dashboard/analytics/projects' },
          { label: 'Cost Reports', href: '/dashboard/analytics/costs'    },
          { label: 'Prompts',      href: '/dashboard/analytics/prompts'  },
          { label: 'Savings',      href: '/dashboard/analytics/savings'  },
        ],
      },
    ],
  },
  // ── Beta (hidden from the live sidebar — uncomment to re-enable) ──
  // {
  //   label: 'Beta',
  //   items: [
  //     { label: 'Traces',      href: '/dashboard/traces',      icon: Waypoints },
  //     { label: 'Evals',       href: '/dashboard/evals',       icon: ShieldCheck },
  //     { label: 'Quality × Cost', href: '/dashboard/analytics/quality-cost', icon: Scale },
  //     { label: 'Datasets',    href: '/dashboard/datasets',    icon: Database },
  //     { label: 'Pairwise',    href: '/dashboard/pairwise',    icon: GitCompare },
  //     { label: 'Annotations', href: '/dashboard/annotations', icon: ClipboardCheck },
  //   ],
  // },
  {
    label: 'Manage',
    items: [
      { label: 'API Keys',     href: '/dashboard/keys',         icon: Key },
      // { label: 'Models',    href: '/dashboard/models',       icon: Cpu },   // TODO: model registry (reserved for future)
      { label: 'Limits',       href: '/dashboard/limits',       icon: Shield },
      { label: 'Alerts',       href: '/dashboard/alerts',       icon: Bell },
    ],
  },
  {
    label: 'More',
    items: [
      { label: 'Setup',        href: '/dashboard/setup',        icon: Plug },
      { label: 'MCP',          href: '/dashboard/mcp',          icon: Puzzle },
      { label: 'Integrations', href: '/dashboard/integrations', icon: GitBranch },
      { label: 'Settings',     href: '/dashboard/settings',     icon: Settings },
    ],
  },
]

/* ── Tooltip for collapsed mode ────────────────────────────────── */
function NavTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="group/tip relative flex">
      {children}
      <div className="pointer-events-none absolute left-full ml-2.5 top-1/2 -translate-y-1/2 z-50 opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150">
        <div className="whitespace-nowrap bg-[var(--fg)] text-[var(--bg)] text-[11.5px] font-medium px-2.5 py-1.5 rounded-lg shadow-lg">
          {label}
          <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-[var(--fg)]" />
        </div>
      </div>
    </div>
  )
}

/* ── Sub-nav row ───────────────────────────────────────────────── */
function SubNavItem({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-2 pl-[38px] pr-3 py-1.5 rounded-lg text-[12.5px] transition-colors duration-100',
        active
          ? 'text-coral font-semibold bg-coral/8'
          : 'text-[var(--fg-secondary)] hover:text-[var(--fg)] hover:bg-[var(--bg-hover)]'
      )}
    >
      <span className={cn('w-1 h-1 rounded-full flex-shrink-0', active ? 'bg-coral' : 'bg-[var(--border-strong)]')} />
      {label}
    </Link>
  )
}

/* ── Single nav item ───────────────────────────────────────────── */
function NavItemRow({
  item, collapsed, defaultOpen,
}: {
  item: NavItem
  collapsed: boolean
  defaultOpen?: boolean
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(defaultOpen ?? false)
  const Icon = item.icon

  const isParentActive = item.children
    ? item.children.some(c => pathname === c.href || pathname.startsWith(c.href))
    : item.href ? (pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))) : false

  if (item.children) {
    const anyChildActive = item.children.some(c => pathname === c.href || pathname.startsWith(c.href))
    const isOpen = anyChildActive || open

    if (collapsed) {
      return (
        <NavTooltip label={item.label}>
          <button className={cn('nav-item w-full justify-center', anyChildActive && 'nav-item-active')}>
            <Icon size={16} className="flex-shrink-0" />
          </button>
        </NavTooltip>
      )
    }

    return (
      <div>
        <button
          onClick={() => setOpen(v => !v)}
          className={cn(
            'nav-item w-full',
            anyChildActive ? 'nav-item-active' : ''
          )}
        >
          <Icon size={16} className="flex-shrink-0" />
          <span className="flex-1 text-left">{item.label}</span>
          <ChevronDown
            size={13}
            className={cn('transition-transform duration-200 text-[var(--fg-tertiary)]', isOpen && 'rotate-180')}
          />
        </button>
        {isOpen && (
          <div className="mt-0.5 space-y-0.5">
            {item.children.map(c => (
              <SubNavItem key={c.href} {...c} active={pathname === c.href || pathname.startsWith(c.href)} />
            ))}
          </div>
        )}
      </div>
    )
  }

  if (collapsed) {
    return (
      <NavTooltip label={item.label}>
        <Link href={item.href!} className={cn('nav-item justify-center', isParentActive && 'nav-item-active')}>
          <Icon size={16} className="flex-shrink-0" />
        </Link>
      </NavTooltip>
    )
  }

  return (
    <Link href={item.href!} className={cn('nav-item', isParentActive && 'nav-item-active')}>
      <Icon size={16} className="flex-shrink-0" />
      <span>{item.label}</span>
    </Link>
  )
}

/* ═══════════════════════════════════════════════════════════════ */
export function Sidebar({ user }: { user: User }) {
  const [collapsed, setCollapsed] = useState(false)

  const avatarLetter = (user.user_metadata?.full_name ?? user.email ?? 'U')[0].toUpperCase()
  const displayName  = user.user_metadata?.full_name ?? user.email ?? 'User'

  return (
    <aside className={cn(
      'relative flex flex-col bg-[var(--sidebar-bg)] border-r border-[var(--border)] transition-all duration-250 flex-shrink-0 select-none',
      collapsed ? 'w-[60px]' : 'w-[232px]'
    )}>

      {/* ── Logo ── */}
      <div className={cn(
        'flex items-center gap-2.5 px-4 h-[56px] border-b border-[var(--border)] flex-shrink-0',
        collapsed && 'justify-center px-0'
      )}>
        {collapsed ? (
          <Image src="/favicon.svg" alt="TokenFin" width={28} height={28} className="flex-shrink-0" />
        ) : (
          <Image src="/logo.svg" alt="TokenFin" width={120} height={28} className="h-7 w-auto flex-shrink-0" />
        )}
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-5">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi}>
            {!collapsed && group.label && (
              <p className="px-2 pb-1.5 text-[10px] font-semibold tracking-widest text-[var(--fg-tertiary)] uppercase">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map(item => (
                <NavItemRow
                  key={item.label}
                  item={item}
                  collapsed={collapsed}
                  defaultOpen={false}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Bottom: help + user ── */}
      <div className="flex-shrink-0 border-t border-[var(--border)]">

        {/* Help row */}
        {!collapsed && (
          <div className="px-2.5 pt-2.5 pb-1 space-y-0.5">
            <Link href="mailto:hello@curiousdevs.com" className="nav-item text-[12px]">
              <HelpCircle size={14} className="flex-shrink-0" />
              <span>Help & Support</span>
            </Link>
          </div>
        )}

        {/* User row */}
        <div className={cn('px-2.5 py-2.5', collapsed && 'flex justify-center')}>
          {collapsed ? (
            <NavTooltip label={displayName}>
              <Link href="/dashboard/settings/profile">
                <div className="w-8 h-8 rounded-full bg-coral/15 border border-coral/25 flex items-center justify-center cursor-pointer">
                  <span className="text-[12px] font-bold text-coral">{avatarLetter}</span>
                </div>
              </Link>
            </NavTooltip>
          ) : (
            <Link
              href="/dashboard/settings/profile"
              className="flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-[var(--bg-hover)] transition-colors group"
            >
              <div className="w-8 h-8 rounded-full bg-coral/15 border border-coral/25 flex items-center justify-center flex-shrink-0">
                <span className="text-[12px] font-bold text-coral">{avatarLetter}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-semibold text-[var(--fg)] truncate leading-tight">{displayName}</p>
                <p className="text-[10.5px] text-[var(--fg-tertiary)] truncate leading-tight">{user.email}</p>
              </div>
              <Settings size={13} className="text-[var(--fg-tertiary)] group-hover:text-coral transition-colors flex-shrink-0" />
            </Link>
          )}
        </div>
      </div>

      {/* ── Collapse toggle ── */}
      <button
        onClick={() => setCollapsed(v => !v)}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="absolute -right-3 top-[68px] w-6 h-6 bg-[var(--bg)] border border-[var(--border)] rounded-full flex items-center justify-center text-[var(--fg-tertiary)] hover:text-coral hover:border-coral/50 shadow-soft z-20 transition-all duration-150"
      >
        {collapsed ? <ChevronRight size={11} strokeWidth={2.5} /> : <ChevronLeft size={11} strokeWidth={2.5} />}
      </button>
    </aside>
  )
}
