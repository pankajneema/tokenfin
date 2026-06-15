'use client'
import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

interface Props { message?: string }

export function AlertBanner({ message }: Props) {
  const [dismissed, setDismissed] = useState(false)
  if (!message || dismissed) return null
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-[var(--amber-bg)] border border-[var(--amber)]/20 rounded-xl text-sm">
      <AlertTriangle size={15} className="text-[var(--amber)] flex-shrink-0" />
      <p className="text-[var(--amber)] flex-1">{message}</p>
      <button onClick={() => setDismissed(true)} className="text-[var(--amber)] hover:opacity-70 transition-opacity">
        <X size={14} />
      </button>
    </div>
  )
}
