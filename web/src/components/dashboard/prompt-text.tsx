'use client'
import { useState } from 'react'
import { Check, Copy, WrapText } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A captured prompt, shown in FULL — no clamping, no max height, whitespace and
 * line breaks preserved. Long single-line content wraps by default; "No wrap"
 * switches to horizontal scrolling for code / logs.
 */
export function PromptText({ text, previewOnly, label }: { text: string; previewOnly?: boolean; label?: string }) {
  const [copied, setCopied] = useState(false)
  const [wrap, setWrap] = useState(true)
  const lines = text.split('\n').length

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked — the text is selectable */ }
  }

  return (
    <div className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-1.5">
        <span className="text-[11px] text-[var(--fg-tertiary)] tabular-nums">
          {label && <span className="mr-1.5 font-semibold uppercase tracking-wide">{label}</span>}
          {previewOnly
            ? 'Preview only — the full prompt text was not captured for this call'
            : `${text.length.toLocaleString('en-US')} characters · ${lines.toLocaleString('en-US')} line${lines !== 1 ? 's' : ''}`}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setWrap(w => !w)} aria-pressed={!wrap}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--fg-secondary)] hover:bg-[var(--bg-tertiary)]">
            <WrapText size={12} /> {wrap ? 'No wrap' : 'Wrap'}
          </button>
          <button type="button" onClick={copy} aria-label="Copy prompt"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--fg-secondary)] hover:bg-[var(--bg-tertiary)]">
            {copied ? <Check size={12} className="text-teal" /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <pre className={cn(
        'px-3.5 py-3 font-sans text-[13px] leading-relaxed text-[var(--fg)] select-text',
        wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre overflow-x-auto',
      )}>{text}</pre>
    </div>
  )
}
