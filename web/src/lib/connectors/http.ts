/** HTTP helper for connectors: timeout, no redirects, errors never include the secret. Server-only. */
import { ConnectorApiError, type ConnectorProvider } from './types'

export const REQUEST_TIMEOUT_MS = 20_000
export const USER_AGENT = 'TokenFin/1.0 (coding-tool-connectors)'

export interface HttpResult { status: number; body: unknown; text: string; headers: Headers }

export interface RequestOpts {
  method?:   'GET' | 'POST'
  headers?:  Record<string, string>
  json?:     unknown
  /** Follow redirects (only for pre-signed download links, which carry no auth header). */
  follow?:   boolean
  /** Parse body as JSON (default true). */
  parseJson?: boolean
  /** Secret that must never appear in error text (belt and braces). */
  secret?:   string
}

function scrub(s: string, secret?: string): string {
  return secret && secret.length >= 6 ? s.split(secret).join('[redacted]') : s
}

export async function request(provider: ConnectorProvider, url: string, opts: RequestOpts = {}): Promise<HttpResult> {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, {
      method:   opts.method ?? 'GET',
      headers:  { 'User-Agent': USER_AGENT, ...(opts.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
      body:     opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
      signal:   ctrl.signal,
      cache:    'no-store',
      redirect: opts.follow ? 'follow' : 'error',
    })
  } catch (e) {
    const msg = (e as Error).name === 'AbortError' ? 'request timed out' : `network error: ${(e as Error).message}`
    throw new ConnectorApiError(provider, 0, scrub(`${provider}: ${msg}`, opts.secret))
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  let body: unknown = null
  if (opts.parseJson !== false) { try { body = text ? JSON.parse(text) : null } catch { /* non-JSON */ } }
  if (!res.ok) {
    const b = body as { error?: { message?: string } | string; message?: string } | null
    const err = b?.error
    const msg = (typeof err === 'string' ? err : err?.message) || b?.message || text || res.statusText
    throw new ConnectorApiError(provider, res.status, scrub(`${provider} API ${res.status}: ${String(msg).slice(0, 300)}`, opts.secret))
  }
  return { status: res.status, body, text, headers: res.headers }
}

export async function requestJson(provider: ConnectorProvider, url: string, opts: RequestOpts = {}): Promise<unknown> {
  const r = await request(provider, url, opts)
  if (r.status === 204) return null
  if (r.body === null) throw new ConnectorApiError(provider, r.status, `${provider} API returned non-JSON`)
  return r.body
}

/** rel="next" URL from a GitHub-style Link header. */
export function nextLink(link: string | null): string | null {
  if (!link) return null
  for (const part of link.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/)
    if (m) return m[1]
  }
  return null
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
