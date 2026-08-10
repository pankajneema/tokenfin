'use client'
import { useState, useEffect } from 'react'

/**
 * Renders a live "Xs/Xm/Xh ago"-style string without a hydration mismatch.
 * Date.now() is never identical between the server render and the client
 * hydration pass, so calling a relative-time formatter directly in JSX
 * mismatches server vs. client text — and React remounts the tree to
 * recover. Rendering nothing until mounted keeps the first client paint
 * identical to the server HTML, then fills in the live value post-hydration.
 *
 * `format` is the page's own formatter (kept per-call-site so each page's
 * exact wording/fallback text — "Never", "never used", bucket rounding —
 * is unchanged); this component only fixes *when* it's safe to render it.
 */
export function TimeAgo<T>({ value, format }: { value: T; format: (v: T) => string }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => { setText(format(value)) }, [value, format])
  return <>{text}</>
}

/** Default formatter for the common "Xs/Xm/Xh/Xd ago" case. */
export function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000)      return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000)   return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000)  return `${Math.round(ms / 3_600_000)}h ago`
  if (ms < 604_800_000) return `${Math.round(ms / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString('en-US')
}
