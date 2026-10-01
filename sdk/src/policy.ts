/**
 * Org policy enforced client-side by the wrappers: model routes (rewrite
 * `model` before the call) and, when the app opts in with `enforcePolicy`,
 * blocked models. Fetched from GET /api/v1/policy with the client's API key
 * (read or ingest scope), refreshed in the background every `ttl_seconds`
 * (60). Fail open: no policy / an error / an old server → calls go through
 * unchanged.
 */

export interface PolicyRoute {
  from: string
  to: string
  /** "exact" (default) = the whole model id; "prefix" = ids starting with `from`. */
  match?: 'exact' | 'prefix'
}

export interface Policy {
  routes: PolicyRoute[]
  blocked_models: string[]
  version: string
  ttl_seconds?: number
}

/** Thrown by a wrapped client for a blocked model when `enforcePolicy: true`. */
export class TokenFinPolicyError extends Error {
  readonly model: string
  readonly code = 'model_blocked'
  constructor(model: string) {
    super(`TokenFin policy blocks model "${model}" for this organization (a usage limit was reached). ` +
      'Ask an admin to lift the block on the TokenFin Limits page, or use another model.')
    this.name = 'TokenFinPolicyError'
    this.model = model
  }
}

const norm = (m: string) => m.trim().toLowerCase()

/** The route for `model`: exact match first, then the longest prefix route. */
export function findRoute(policy: Policy | null, model: string): PolicyRoute | null {
  if (!policy || !model) return null
  const m = norm(model)
  const exact = policy.routes.find(r => norm(r.from) === m)
  if (exact) return exact
  let best: PolicyRoute | null = null
  for (const r of policy.routes) {
    if (r.match !== 'prefix' || !m.startsWith(norm(r.from))) continue
    if (!best || r.from.length > best.from.length) best = r
  }
  return best
}

export function isModelBlocked(policy: Policy | null, model: string): boolean {
  if (!policy || !model) return false
  const m = norm(model)
  return policy.blocked_models.some(b => m.startsWith(norm(b)))
}

export type PolicyFetchResult =
  | { status: 'ok'; policy: Policy; etag: string | null }
  | { status: 'not_modified' }
  | { status: 'unavailable' }   // 404 (older server) / 401 / 403 — treat as "no policy"
  | { status: 'error' }

const DEFAULT_TTL_MS = 60_000
const ERROR_RETRY_MS = 30_000

/** Background-refreshed policy cache. Never throws. */
export class PolicyManager {
  private policy: Policy | null = null
  private etag: string | null = null
  private fetchedAt = 0
  private nextAt = 0
  private inflight: Promise<void> | null = null
  private attempted = false
  private fetches = 0

  constructor(private readonly fetcher: (etag: string | null) => Promise<PolicyFetchResult>,
              private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  /** The last policy fetched (null until the first successful fetch). */
  current(): Policy | null { return this.policy }

  /** True once the first fetch has finished (successfully or not). */
  get settled(): boolean { return this.attempted }

  get stats() { return { fetches: this.fetches, version: this.policy?.version ?? null, fetchedAt: this.fetchedAt || null } }

  /** Start a refresh when the policy is stale. Returns immediately. */
  refresh(force = false): void {
    if (this.inflight) return
    if (!force && Date.now() < this.nextAt) return
    this.inflight = (async () => {
      try {
        this.fetches++
        const r = await this.fetcher(this.etag)
        const now = Date.now()
        if (r.status === 'ok') {
          this.policy = r.policy; this.etag = r.etag; this.fetchedAt = now
          const ttl = r.policy.ttl_seconds && r.policy.ttl_seconds > 0 ? r.policy.ttl_seconds * 1000 : this.ttlMs
          this.nextAt = now + ttl
        } else if (r.status === 'not_modified') {
          this.fetchedAt = now; this.nextAt = now + this.ttlMs
        } else if (r.status === 'unavailable') {
          this.policy = null; this.etag = null; this.nextAt = now + this.ttlMs
        } else {
          this.nextAt = now + ERROR_RETRY_MS   // keep the last good policy
        }
      } catch {
        this.nextAt = Date.now() + ERROR_RETRY_MS
      } finally {
        this.attempted = true
        this.inflight = null
      }
    })()
  }

  /**
   * Resolves when the first fetch has finished or after `timeoutMs`,
   * whichever comes first. Never rejects.
   */
  ready(timeoutMs = 200): Promise<void> {
    if (this.attempted) return Promise.resolve()
    this.refresh()
    const p = this.inflight ?? Promise.resolve()
    return new Promise<void>(resolve => {
      const t = setTimeout(resolve, Math.max(0, timeoutMs))
      ;(t as { unref?: () => void }).unref?.()
      p.then(() => { clearTimeout(t); resolve() }, () => { clearTimeout(t); resolve() })
    })
  }
}
