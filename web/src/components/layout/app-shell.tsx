'use client'
/**
 * Client shell for the dashboard: desktop sidebar, mobile drawer, topbar and
 * the ⌘K command palette. Owns the open/closed state they share.
 */
import { useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { Sidebar, MobileNavDrawer } from './sidebar'
import { Topbar } from './topbar'
import { CommandPalette } from './command-palette'

type TopbarNotifs = Parameters<typeof Topbar>[0]['notifications']

export function AppShell({ user, notifications, children }: {
  user: User
  notifications: TopbarNotifs
  children: React.ReactNode
}) {
  const [navOpen, setNavOpen]         = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const closeNav     = useCallback(() => setNavOpen(false), [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])

  // ⌘K / Ctrl+K toggles the palette from anywhere (also while typing in a field).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setNavOpen(false)
        setPaletteOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-[100dvh] bg-[var(--bg-secondary)] overflow-hidden">
      <Sidebar user={user} />
      <MobileNavDrawer user={user} open={navOpen} onClose={closeNav} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar
          user={user}
          notifications={notifications}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenNav={() => setNavOpen(true)}
          navOpen={navOpen}
        />
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 focus:outline-none">
          {children}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </div>
  )
}
