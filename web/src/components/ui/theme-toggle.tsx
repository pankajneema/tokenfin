'use client'
import { useTheme } from 'next-themes'
import { Sun, Moon } from 'lucide-react'
import { useEffect, useState } from 'react'

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return <div className="w-8 h-8" />
  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className={`btn-ghost p-2 ${className ?? ''}`}
      aria-label="Toggle theme"
    >
      {theme === 'dark'
        ? <Sun size={16} className="text-[var(--fg-secondary)]" />
        : <Moon size={16} className="text-[var(--fg-secondary)]" />}
    </button>
  )
}
