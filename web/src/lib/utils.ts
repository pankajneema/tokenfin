import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Trim a trailing ".0" so 1.0M reads "1M". */
function compact(n: number, div: number, suffix: string): string {
  const v = (n / div).toFixed(1)
  return `${v.endsWith('.0') ? v.slice(0, -2) : v}${suffix}`
}

/**
 * Dollars, one rule everywhere: "$0.00" for zero, "<$0.01" for tiny non-zero
 * amounts, 2 decimals under $100, whole dollars (grouped) from $100, and a
 * compact "$1.2M" from a million.
 */
export function formatCost(usd: number | null | undefined): string {
  const v = Number(usd ?? 0)
  if (!Number.isFinite(v) || v === 0) return '$0.00'
  const sign = v < 0 ? '-' : ''
  const a = Math.abs(v)
  if (a < 0.01)      return `${sign}<$0.01`
  if (a < 99.995)    return `${sign}$${nf2.format(a)}`
  if (a < 999_999.5) return `${sign}$${nf0.format(a)}`
  return `${sign}$${compact(a, 1_000_000, 'M')}`
}

/** Compact token counts: 950, 12.3K, 1.2M, 3B. */
export function formatTokens(n: number | null | undefined): string {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return '0'
  const sign = v < 0 ? '-' : ''
  const a = Math.abs(v)
  if (a < 1_000)         return `${sign}${Math.round(a)}`
  if (a < 999_950)       return `${sign}${compact(a, 1_000, 'K')}`
  if (a < 999_950_000)   return `${sign}${compact(a, 1_000_000, 'M')}`
  return `${sign}${compact(a, 1_000_000_000, 'B')}`
}

/** Whole numbers with en-US grouping (fixed locale so server and client agree). */
export function formatNumber(n: number | null | undefined): string {
  const v = Number(n ?? 0)
  return nf0.format(Number.isFinite(v) ? v : 0)
}

export function formatDate(d: string | Date, opts?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', ...opts,
  }).format(typeof d === 'string' ? new Date(d) : d)
}

export function pct(part: number, total: number): number {
  if (!total) return 0
  return Math.round((part / total) * 100)
}

export function truncate(s: string, n = 40): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

/** Parse a failed API response ({ error: string } or Zod's { formErrors, fieldErrors })
 *  into one human-readable line instead of dumping raw JSON in the UI. */
export async function readApiError(res: Response): Promise<string> {
  const text = await res.text()
  try {
    const data = JSON.parse(text)
    const err = data?.error
    if (typeof err === 'string') return err
    const fieldMsgs = Object.values(err?.fieldErrors ?? {}).flat() as string[]
    const formMsgs  = (err?.formErrors ?? []) as string[]
    const msgs = [...formMsgs, ...fieldMsgs]
    if (msgs.length) return msgs.join(' ')
  } catch { /* not JSON — fall through to raw text */ }
  return text || `Request failed (${res.status})`
}
