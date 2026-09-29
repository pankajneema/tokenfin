'use client'
/**
 * Accessible modal primitives.
 *
 * useFocusTrap — keeps Tab/Shift+Tab inside a container, closes on Escape,
 * focuses the first field on open and restores focus to the opener on close.
 * useBodyScrollLock — stops the page behind an overlay from scrolling.
 * Dialog — overlay + panel with role="dialog" aria-modal, built on both.
 */
import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(el => !el.hasAttribute('inert') && el.getClientRects().length > 0)
}

export function useFocusTrap<T extends HTMLElement>(active: boolean, onEscape?: () => void) {
  const ref = useRef<T>(null)
  const escRef = useRef(onEscape)
  escRef.current = onEscape

  useEffect(() => {
    if (!active) return
    const root = ref.current
    if (!root) return
    const opener = document.activeElement as HTMLElement | null

    // Focus the first autofocus / field / focusable, else the container.
    const first = root.querySelector<HTMLElement>('[autofocus],[data-autofocus]') ?? focusables(root)[0]
    ;(first ?? root).focus({ preventScroll: true })

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (escRef.current) { e.stopPropagation(); escRef.current() }
        return
      }
      if (e.key !== 'Tab' || !root) return
      const els = focusables(root)
      if (els.length === 0) { e.preventDefault(); root.focus(); return }
      const firstEl = els[0], lastEl = els[els.length - 1]
      const cur = document.activeElement
      if (e.shiftKey && (cur === firstEl || !root.contains(cur))) { e.preventDefault(); lastEl.focus() }
      else if (!e.shiftKey && (cur === lastEl || !root.contains(cur))) { e.preventDefault(); firstEl.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true })
    }
  }, [active])

  return ref
}

let locks = 0
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    locks++
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      locks--
      if (locks === 0) document.body.style.overflow = prev
    }
  }, [active])
}

interface DialogProps {
  open:         boolean
  onClose:      () => void
  /** Visible title; also the accessible name. Omit only if `ariaLabel` is given. */
  title?:       React.ReactNode
  description?: React.ReactNode
  ariaLabel?:   string
  children:     React.ReactNode
  footer?:      React.ReactNode
  /** Tailwind max-width class for the panel. */
  size?:        'sm' | 'md' | 'lg'
  className?:   string
  /** Hide the built-in header (render your own inside children). */
  bare?:        boolean
}

const SIZES = { sm: 'max-w-[400px]', md: 'max-w-[480px]', lg: 'max-w-[560px]' }

export function Dialog({ open, onClose, title, description, ariaLabel, children, footer, size = 'lg', className, bare }: DialogProps) {
  const ref = useFocusTrap<HTMLDivElement>(open, onClose)
  useBodyScrollLock(open)
  const titleId = useId()
  const descId  = useId()
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title && !bare ? titleId : undefined}
        aria-label={!title || bare ? ariaLabel : undefined}
        aria-describedby={description && !bare ? descId : undefined}
        tabIndex={-1}
        className={cn('relative w-full bg-[var(--bg)] border border-[var(--border)] rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col focus:outline-none', SIZES[size], className)}
      >
        {!bare && (
          <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-[var(--border)]">
            <div className="min-w-0">
              <h2 id={titleId} className="text-[15px] font-bold text-[var(--fg)]">{title}</h2>
              {description && <p id={descId} className="text-[12px] text-[var(--fg-tertiary)] mt-0.5">{description}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close dialog"
              className="w-8 h-8 rounded-xl flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] flex-shrink-0">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        <div className={cn(!bare && 'overflow-y-auto', bare && 'flex flex-col min-h-0')}>{children}</div>
        {footer && <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between gap-2">{footer}</div>}
      </div>
    </div>
  )
}
