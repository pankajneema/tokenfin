/** Shared types + helpers for provider billing sync. Server-only. */

export type BillingProvider = 'anthropic' | 'openai'
export const BILLING_PROVIDERS: readonly BillingProvider[] = ['anthropic', 'openai']

/** One provider_costs row (minus org_id/provider, added by sync). */
export interface ProviderCostRow {
  day:                  string   // YYYY-MM-DD (UTC)
  workspace_or_project: string
  line_item:            string
  model:                string
  cost_usd:             number
  input_tokens:         number
  output_tokens:        number
  cache_read_tokens:    number
}

export interface FetchWindow { start: Date; end: Date }

export class ProviderApiError extends Error {
  constructor(public provider: BillingProvider, public status: number, message: string) {
    super(message)
    this.name = 'ProviderApiError'
  }
}

export const REQUEST_TIMEOUT_MS = 20_000
export const MAX_PAGES = 60

/** GET JSON with a timeout; non-2xx → ProviderApiError with the provider's message (never the key). */
export async function getJson(provider: BillingProvider, url: string, headers: Record<string, string>): Promise<unknown> {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, { headers: { ...headers, 'User-Agent': 'TokenFin/1.0 (billing-reconciliation)' }, signal: ctrl.signal, cache: 'no-store', redirect: 'error' })
  } catch (e) {
    throw new ProviderApiError(provider, 0, (e as Error).name === 'AbortError' ? 'request timed out' : `network error: ${(e as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  let body: unknown = null
  try { body = JSON.parse(text) } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = (body as { error?: { message?: string } | string } | null)?.error
    const msg = typeof err === 'string' ? err : err?.message
    throw new ProviderApiError(provider, res.status, `${provider} API ${res.status}: ${(msg || text || res.statusText).slice(0, 300)}`)
  }
  if (body === null) throw new ProviderApiError(provider, res.status, `${provider} API returned non-JSON`)
  return body
}

/** Sum rows sharing the provider_costs unique key (a single upsert batch may not touch a row twice). */
export function mergeRows(rows: ProviderCostRow[]): ProviderCostRow[] {
  const m = new Map<string, ProviderCostRow>()
  for (const r of rows) {
    const k = [r.day, r.workspace_or_project, r.line_item, r.model].join('\u0000')
    const cur = m.get(k)
    if (!cur) { m.set(k, { ...r }); continue }
    cur.cost_usd          += r.cost_usd
    cur.input_tokens      += r.input_tokens
    cur.output_tokens     += r.output_tokens
    cur.cache_read_tokens += r.cache_read_tokens
  }
  return Array.from(m.values()).map(r => ({ ...r, cost_usd: +r.cost_usd.toFixed(6) }))
}

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN
  return Number.isFinite(n) ? n : 0
}
export const str = (v: unknown): string => (typeof v === 'string' ? v : '')
export const utcDay = (iso: string | number | Date): string => new Date(iso).toISOString().slice(0, 10)

/** Masked key hint: prefix family + last 4 characters. */
export function keyHint(key: string): string {
  const k = key.trim()
  const prefix = k.startsWith('sk-ant-admin') ? 'sk-ant-admin…' : k.startsWith('sk-admin-') ? 'sk-admin-…' : 'sk-…'
  return prefix + k.slice(-4)
}
