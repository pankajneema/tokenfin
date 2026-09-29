'use client'
/**
 * FilterBar — reusable URL-backed filters.
 *
 * Reads the current value of each field from the URL searchParams and writes
 * changes with router.replace, so every filtered view is a shareable link.
 * Keyboard accessible: every control is a native <select>/<button> with a label;
 * active filters show as removable chips (Backspace/Delete on a chip removes it).
 *
 *   <FilterBar fields={[{ key: 'model', label: 'Model', options: [{ value: 'gpt-5', label: 'gpt-5' }] }]} />
 */
import { useId } from 'react'
import { X, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUrlState } from './url-state'

export interface FilterOption { value: string; label: string }
export interface FilterField {
  /** URL query key */
  key: string
  label: string
  options: FilterOption[]
}

interface Props {
  fields: FilterField[]
  /** extra URL keys to drop when a filter changes (e.g. a page offset) */
  resetKeys?: string[]
  className?: string
  children?: React.ReactNode
}

export function FilterBar({ fields, resetKeys = [], className, children }: Props) {
  const { params, update, clear, pending } = useUrlState()
  const id = useId()
  const reset = Object.fromEntries(resetKeys.map(k => [k, null]))

  const active = fields
    .map(f => {
      const value = params.get(f.key)
      if (!value) return null
      const label = f.options.find(o => o.value === value)?.label ?? value
      return { field: f, value, label }
    })
    .filter((x): x is { field: FilterField; value: string; label: string } => x !== null)

  return (
    <div
      role="group"
      aria-label="Filters"
      aria-busy={pending || undefined}
      className={cn('rounded-2xl border border-[var(--border)] bg-white p-3 dark:bg-[#141428]', className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SlidersHorizontal size={13} className="text-[var(--fg-tertiary)]" aria-hidden />
        {fields.map(f => {
          const value = params.get(f.key) ?? ''
          const known = !value || f.options.some(o => o.value === value)
          return (
            <label key={f.key} className="flex items-center" htmlFor={`${id}-${f.key}`}>
              <span className="sr-only">{f.label}</span>
              <select
                id={`${id}-${f.key}`}
                value={value}
                onChange={e => update({ ...reset, [f.key]: e.target.value || null })}
                className={cn(
                  'h-8 max-w-[190px] rounded-lg border bg-[var(--bg)] px-2 text-[12.5px] text-[var(--fg)] outline-none',
                  'focus-visible:ring-2 focus-visible:ring-[var(--blue)]',
                  value ? 'border-[var(--blue)]' : 'border-[var(--border)]',
                )}
              >
                <option value="">{`All ${f.label.toLowerCase()}s`}</option>
                {!known && <option value={value}>{value}</option>}
                {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )
        })}
        {children}
      </div>

      {active.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          {active.map(a => (
            <button
              key={a.field.key}
              type="button"
              onClick={() => update({ ...reset, [a.field.key]: null })}
              onKeyDown={e => { if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); update({ ...reset, [a.field.key]: null }) } }}
              aria-label={`Remove filter ${a.field.label}: ${a.label}`}
              className="inline-flex max-w-[280px] items-center gap-1 rounded-full bg-[var(--blue-bg)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--blue)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue)]"
            >
              <span className="text-[var(--fg-tertiary)]">{a.field.label}:</span>
              <span className="truncate">{a.label}</span>
              <X size={11} aria-hidden />
            </button>
          ))}
          <button
            type="button"
            onClick={() => clear([...fields.map(f => f.key), ...resetKeys])}
            className="ml-1 rounded px-1.5 py-1 text-[11.5px] font-medium text-[var(--fg-secondary)] underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--blue)]"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  )
}
