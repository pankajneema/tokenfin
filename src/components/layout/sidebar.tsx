'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import {
  Zap, LayoutDashboard, BarChart3, Users, Key, Bell,
  Settings, ChevronLeft, ChevronRight, Layers, Shield, GitBranch, Cpu
} from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV = [
  { label: 'Overview',     href: '/dashboard',             icon: LayoutDashboard },
  { label: 'Analytics',    href: '/dashboard/analytics',   icon: BarChart3 },
  { label: 'Projects',     href: '/dashboard/projects',    icon: Layers },
  { label: 'Teams',        href: '/dashboard/teams',       icon: Users },
  { label: 'API Keys',     href: '/dashboard/keys',        icon: Key },
  { label: 'Models',       href: '/dashboard/models',      icon: Cpu },
  { label: 'Limits',       href: '/dashboard/limits',      icon: Shield },
  { label: 'Alerts',       href: '/dashboard/alerts',      icon: Bell },
  { label: 'Integrations', href: '/dashboard/integrations',icon: GitBranch },
  { label: 'Settings',     href: '/dashboard/settings',    icon: Settings },
]

export function Sidebar({ user }: { user: User }) {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()

  return (
    <aside className={cn(
      'relative flex flex-col bg-[var(--sidebar-bg)] border-r border-[var(--border)] transition-all duration-200 flex-shrink-0',
      collapsed ? 'w-16' : 'w-60'
    )}>
      {/* Logo */}
      <div className={cn('flex items-center gap-2.5 px-4 py-4 border-b border-[var(--border)]', collapsed && 'justify-center')}>
        <div className="w-8 h-8 bg-coral rounded-lg flex items-center justify-center flex-shrink-0">
          <Zap size={16} className="text-white" strokeWidth={2.5} />
        </div>
        {!collapsed && <span className="font-semibold text-[var(--fg)] text-sm">TokenFin</span>}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {NAV.map(({ label, href, icon: Icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link key={href} href={href} title={collapsed ? label : undefined}
              className={cn(active ? 'nav-item-active' : 'nav-item', collapsed && 'justify-center')}>
              <Icon size={16} className="flex-shrink-0" />
              {!collapsed && <span>{label}</span>}
            </Link>
          )
        })}
      </nav>

      {/* User */}
      {!collapsed && (
        <div className="p-3 border-t border-[var(--border)]">
          <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] cursor-pointer transition-colors">
            <div className="w-7 h-7 rounded-full bg-coral/10 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-semibold text-coral">
                {(user.user_metadata?.full_name ?? user.email ?? 'U')[0].toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-[var(--fg)] truncate">{user.user_metadata?.full_name ?? 'User'}</p>
              <p className="text-[10px] text-[var(--fg-tertiary)] truncate">{user.email}</p>
            </div>
          </div>
        </div>
      )}

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(v => !v)}
        className="absolute -right-3 top-[72px] w-6 h-6 bg-[var(--bg)] border border-[var(--border)] rounded-full flex items-center justify-center text-[var(--fg-secondary)] hover:text-[var(--fg)] shadow-soft z-10 transition-colors"
        aria-label={collapsed ? 'Expand' : 'Collapse'}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
    </aside>
  )
}
