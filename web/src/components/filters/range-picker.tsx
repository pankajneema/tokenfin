'use client'
/**
 * RangePicker — 7 / 30 / 90 day presets + custom from/to, stored in the URL as
 * ?range=7|30|90|custom&from=YYYY-MM-DD&to=YYYY-MM-DD (see lib/explore.ts).
 */
import { useEffect, useId, useState } from 'react'
import { cn } from '@/lib/utils'
import { useUrlState } from './url-state'

interface Props {
  /** current resolved range (from the server) */
  range: 7 | 30 | 90 | 'custom'
  from: string
  to: string
  presets?: readonly number[]
  maxDays?: number
}

export function RangePicker({ range, from, to, presets = [7, 30, 90], maxDays = 366 }: Props) {
  const { update } = useUrlState()
  const id = useId()
  const [open, setOpen] = useState(range === 'custom')
  const [f, setF] = useState(from)
  const [t, setT] = useState(to)
  useEffect(() => { setF(from); setT(to) }, [from, to])

  const span = f && t ? Math.round((Date.parse(t) - Date.parse(f)) / 86_400_000) + 1 : 0
  const error = !f || !t ? 'Pick both dates' : f > t ? '"From" is after "to"' : span > maxDays ? `Max ${maxDays} days` : null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="Date range" className="inline-flex rounded-lg border border-[var(--border)] p-0.5">
        {presets.map(p => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={range === p}
            onClick={() => { setOpen(false); update({ range: p === 30 ? null : p, from: null, to: null }) }}
            className={cn(
              'rounded-md px-2.5 py-1 text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue)]',
              range === p ? 'bg-[var(--bg-tertiary)] text-[var(--fg)]' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]',
            )}
          >
            {p}d
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={range === 'custom'}
          onClick={() => setOpen(o => !o)}
          className={cn(
            'rounded-md px-2.5 py-1 text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue)]',
            range === 'custom' ? 'bg-[var(--bg-tertiary)] text-[var(--fg)]' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]',
          )}
        >
          Custom
        </button>
      </div>
      {open && (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={e => { e.preventDefault(); if (!error) update({ range: 'custom', from: f, to: t }) }}
        >
          <label htmlFor={`${id}-from`} className="sr-only">From</label>
          <input id={`${id}-from`} type="date" value={f} max={t || undefined} onChange={e => setF(e.target.value)}
            className="h-8 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-[12px] text-[var(--fg)]" />
          <span className="text-[12px] text-[var(--fg-tertiary)]" aria-hidden>→</span>
          <label htmlFor={`${id}-to`} className="sr-only">To</label>
          <input id={`${id}-to`} type="date" value={t} min={f || undefined} onChange={e => setT(e.target.value)}
            className="h-8 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-[12px] text-[var(--fg)]" />
          <button type="submit" disabled={!!error}
            className="h-8 rounded-lg border border-[var(--border)] px-2.5 text-[12px] font-medium text-[var(--fg)] disabled:opacity-50">
            Apply
          </button>
          {error && <span role="status" className="text-[11.5px] text-[var(--red)]">{error}</span>}
        </form>
      )}
    </div>
  )
}
