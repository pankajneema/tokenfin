'use client'
import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { Bell, Search, LogOut, ChevronRight, Settings, User as UserIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ThemeToggle } from '@/components/ui/theme-toggle'

const LABELS: Record<string, string> = {
  dashboard: 'Overview', analytics: 'Analytics', projects: 'Projects',
  teams: 'Teams', keys: 'API Keys', models: 'Models',
  limits: 'Limits', alerts: 'Alerts', integrations: 'Integrations', settings: 'Settings',
}

export function Topbar({ user }: { user: User }) {
  const router    = useRouter()
  const pathname  = usePathname()
  const supabase  = createClient()
  const [menuOpen, setMenuOpen]   = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)

  const crumbs = pathname.split('/').filter(Boolean).map((seg, i, arr) => ({
    label: LABELS[seg] ?? seg,
    href:  '/' + arr.slice(0, i + 1).join('/'),
    last:  i === arr.length - 1,
  }))

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login'); router.refresh()
  }

  return (
    <header className="flex items-center justify-between px-6 py-3 bg-[var(--bg)] border-b border-[var(--border)] flex-shrink-0">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm">
        {crumbs.map((c, i) => (
          <span key={c.href} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={13} className="text-[var(--fg-tertiary)]" />}
            <span className={c.last ? 'font-medium text-[var(--fg)]' : 'text-[var(--fg-secondary)] cursor-pointer hover:text-[var(--fg)] transition-colors'}>
              {c.label}
            </span>
          </span>
        ))}
      </nav>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button className="btn-ghost p-2" aria-label="Search"><Search size={16} /></button>
        <ThemeToggle />

        {/* Notifications */}
        <div className="relative">
          <button onClick={() => setNotifOpen(v => !v)} className="btn-ghost p-2 relative" aria-label="Notifications">
            <Bell size={16} />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-coral rounded-full" />
          </button>
          {notifOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setNotifOpen(false)} />
              <div className="absolute right-0 top-full mt-1.5 w-80 card py-2 z-20 shadow-card-lg animate-slide-up">
                <div className="px-4 py-2 border-b border-[var(--border)] flex items-center justify-between">
                  <span className="text-sm font-semibold text-[var(--fg)]">Notifications</span>
                  <button className="text-xs text-coral hover:underline">Mark all read</button>
                </div>
                <div className="px-4 py-8 text-center">
                  <p className="text-sm text-[var(--fg-secondary)]">You're all caught up 🎉</p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* User menu */}
        <div className="relative ml-1">
          <button onClick={() => setMenuOpen(v => !v)}
            className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg hover:bg-[var(--bg-hover)] transition-colors">
            <div className="w-7 h-7 rounded-full bg-coral/10 flex items-center justify-center">
              <span className="text-xs font-semibold text-coral">
                {(user.user_metadata?.full_name ?? user.email ?? 'U')[0].toUpperCase()}
              </span>
            </div>
            <span className="text-sm font-medium text-[var(--fg)] hidden sm:block max-w-[120px] truncate">
              {user.user_metadata?.full_name ?? user.email}
            </span>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1.5 w-52 card py-1 z-20 shadow-card-lg animate-slide-up">
                <div className="px-3 py-2 border-b border-[var(--border)] mb-1">
                  <p className="text-xs font-medium text-[var(--fg)] truncate">{user.user_metadata?.full_name}</p>
                  <p className="text-[11px] text-[var(--fg-tertiary)] truncate">{user.email}</p>
                </div>
                <button onClick={() => { setMenuOpen(false); router.push('/dashboard/settings') }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] transition-colors">
                  <Settings size={14} /> Settings
                </button>
                <button onClick={() => { setMenuOpen(false); router.push('/dashboard/settings/profile') }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] transition-colors">
                  <UserIcon size={14} /> Profile
                </button>
                <div className="divider my-1" />
                <button onClick={signOut}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-[var(--red)] hover:bg-[var(--red-bg)] transition-colors">
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
