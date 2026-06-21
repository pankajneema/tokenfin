'use client'
import { useState } from 'react'
import { AlertTriangle, X, Info, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

type Severity = 'info' | 'warning' | 'error'

interface Props {
  message?: string
  severity?: Severity
  title?: string
}

const STYLES = {
  info: {
    wrap:      'bg-[var(--blue-bg)] border-[var(--blue)]/20',
    iconClass: 'text-[var(--blue)]',
    text:      'text-[var(--blue)]',
    Icon:      Info,
  },
  warning: {
    wrap:      'bg-[var(--amber-bg)] border-[var(--amber)]/20',
    iconClass: 'text-[var(--amber)]',
    text:      'text-[var(--amber)]',
    Icon:      AlertTriangle,
  },
  error: {
    wrap:      'bg-[var(--red-bg)] border-[var(--red)]/20',
    iconClass: 'text-[var(--red)]',
    text:      'text-[var(--red)]',
    Icon:      AlertCircle,
  },
}

export function AlertBanner({ message, severity = 'warning', title }: Props) {
  const [dismissed, setDismissed] = useState(false)
  if (!message || dismissed) return null

  const s  = STYLES[severity]
  const Icon = s.Icon

  return (
    <div className={cn('flex items-start gap-3 px-4 py-3.5 border rounded-xl text-[12.5px]', s.wrap)}>
      <Icon size={15} className={cn(s.iconClass, 'flex-shrink-0 mt-0.5')} />
      <div className="flex-1 min-w-0">
        {title && <p className={cn('font-semibold mb-0.5', s.text)}>{title}</p>}
        <p className={s.text}>{message}</p>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className={cn('flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity', s.iconClass)}
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
}
