import type { TokenFinConfig, TrackEvent, FlushResult, ClientStats, IngestPayload } from './types'
import { uuidV4, sleep, backoffMs, parseRetryAfter, isRetryableStatus } from './utils'
import { PolicyManager, type Policy, type PolicyFetchResult } from './policy'

export const SDK_VERSION = '0.2.1'

const DEFAULT_BASE_URL        = 'https://tokenfin.curiousdevs.com'
const DEFAULT_TIMEOUT_MS      = 5_000
const DEFAULT_FLUSH_INTERVAL  = 1_000
const DEFAULT_BATCH_SIZE      = 100
const DEFAULT_MAX_QUEUE       = 10_000
const DEFAULT_MAX_RETRIES     = 3
const DEFAULT_MAX_RETRY_AFTER = 30_000
const SERVER_BATCH_CAP        = 500
const SINGLE_CONCURRENCY      = 8

// Circuit breaker: after N consecutive failed sends, drop instead of sending for a cooldown.
const CB_THRESHOLD = 5
const CB_COOLDOWN  = 60_000

/** Result of sending a set of events. `retry` = events that may be retried. */
interface SendOutcome { sent: number; dropped: number; retry: IngestPayload[]; retryAfterMs: number | null }

type HttpResult =
  | { kind: 'response'; status: number; retryAfterMs: number | null; body: unknown }
  | { kind: 'network'; error: string }

/**
 * TokenFin client.
 *
 * Events are queued in memory and sent in batches to `/api/v1/ingest/batch`
 * (falling back to `/api/v1/ingest` on older servers), so `track()` never
 * blocks and never throws.
 *
 * ```ts
 * const tf = new TokenFinClient({ apiKey: process.env.TOKENFIN_API_KEY! })
 * tf.track({ model: 'gpt-4o', inputTokens: 800, outputTokens: 120 })
 * await tf.shutdown()   // drain before exit
 * ```
 */
export class TokenFinClient {
  private readonly apiKey:          string
  private readonly baseUrl:         string
  private readonly timeoutMs:       number
  private readonly batchSize:       number
  private readonly maxQueueSize:    number
  private readonly maxRetries:      number
  private readonly maxRetryAfterMs: number
  private readonly debug:           boolean
  private readonly fetchImpl:       typeof fetch | undefined

  private queue: IngestPayload[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private inflight: Promise<FlushResult> | null = null
  private closed = false
  private batchSupported: boolean | null = null // null = unknown, probe on first send
  private exitHandler: (() => void) | null = null

  private totals = { sent: 0, dropped: 0 }
  private _policy: PolicyManager | null = null
  private readonly policyTtlMs: number
  private cbFailures  = 0
  private cbOpenUntil = 0

  constructor(cfg: TokenFinConfig) {
    this.apiKey          = cfg.apiKey
    this.baseUrl         = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.timeoutMs       = cfg.timeoutMs       ?? DEFAULT_TIMEOUT_MS
    this.batchSize       = Math.max(1, Math.min(cfg.batchSize ?? DEFAULT_BATCH_SIZE, SERVER_BATCH_CAP))
    this.maxQueueSize    = Math.max(1, cfg.maxQueueSize ?? DEFAULT_MAX_QUEUE)
    this.maxRetries      = Math.max(0, cfg.maxRetries ?? DEFAULT_MAX_RETRIES)
    this.maxRetryAfterMs = cfg.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER
    this.debug           = cfg.debug ?? false
    this.fetchImpl       = cfg.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined)
    this.policyTtlMs     = cfg.policyTtlMs ?? 60_000

    const interval = cfg.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL
    if (interval > 0) {
      this.timer = setInterval(() => this._flushBackground(), interval)
      ;(this.timer as { unref?: () => void }).unref?.() // never keep the process alive
    }
    if (cfg.flushOnExit !== false) this._registerExitHooks()
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Enqueue a usage event. Returns immediately and never throws. */
  track(event: TrackEvent): void {
    try {
      if (this.closed) { this.totals.dropped++; return }
      if (!event || !event.model) { this._log('track() ignored: model is required'); return }
      if (this.queue.length >= this.maxQueueSize) {
        this.queue.shift()
        this.totals.dropped++
        this._log('queue full — dropped oldest event')
      }
      this.queue.push(toPayload(event))
      if (this.queue.length >= this.batchSize) this._flushBackground()
    } catch (err) {
      this._log('track() failed', errMsg(err))
    }
  }

  /**
   * The org's SDK policy (model routes / blocked models) from
   * GET /api/v1/policy, refreshed in the background. Used by the wrappers;
   * `await tf.policy().ready()` to wait for the first fetch yourself.
   */
  policy(): PolicyManager {
    if (!this._policy) this._policy = new PolicyManager(etag => this._fetchPolicy(etag), this.policyTtlMs)
    return this._policy
  }

  /** Send everything queued so far and wait for it. Never rejects. */
  async flush(): Promise<FlushResult> {
    const result: FlushResult = { sent: 0, dropped: 0 }
    try {
      // Wait for any in-progress background flush, then drain the rest.
      while (this.inflight) {
        const r = await this.inflight
        result.sent += r.sent; result.dropped += r.dropped
      }
      if (this.queue.length > 0) {
        const r = await this._startFlush()
        result.sent += r.sent; result.dropped += r.dropped
      }
    } catch (err) {
      this._log('flush() failed', errMsg(err))
    }
    return result
  }

  /** Stop the timer, detach exit hooks and drain the queue. Idempotent. */
  async shutdown(): Promise<FlushResult> {
    this._stopTimer()
    this._detachExitHooks()
    const r = await this.flush()
    this.closed = true
    return r
  }

  /** Stop the timer and discard queued events (counted as dropped). */
  destroy(): void {
    this._stopTimer()
    this._detachExitHooks()
    this.totals.dropped += this.queue.length
    this.queue = []
    this.closed = true
  }

  /** Lifetime counters. */
  stats(): ClientStats {
    return { sent: this.totals.sent, dropped: this.totals.dropped, queued: this.queue.length }
  }

  // ─── Flushing ───────────────────────────────────────────────────────────────

  private _flushBackground(): void {
    if (this.inflight || this.queue.length === 0) return
    this._startFlush().catch(() => {})
  }

  private _startFlush(): Promise<FlushResult> {
    const p = this._drain().finally(() => { if (this.inflight === p) this.inflight = null })
    this.inflight = p
    return p
  }

  private async _drain(): Promise<FlushResult> {
    let sent = 0
    let dropped = 0
    while (this.queue.length > 0) {
      if (Date.now() < this.cbOpenUntil) {
        this._log(`circuit open — dropping ${this.queue.length} events`)
        dropped += this.queue.length
        this.queue = []
        break
      }
      const batch = this.queue.splice(0, this.batchSize)
      const r = await this._sendWithRetry(batch)
      sent += r.sent
      dropped += r.dropped
      if (r.failedHard) { this._openCircuit(); break }
      this.cbFailures = 0
    }
    this.totals.sent += sent
    this.totals.dropped += dropped
    return { sent, dropped }
  }

  /** Send a batch; retry only the retryable subset, honouring Retry-After. */
  private async _sendWithRetry(batch: IngestPayload[]): Promise<FlushResult & { failedHard: boolean }> {
    let sent = 0
    let dropped = 0
    let pending = batch
    for (let attempt = 0; attempt <= this.maxRetries && pending.length > 0; attempt++) {
      const r = await this._send(pending)
      sent += r.sent
      dropped += r.dropped
      pending = r.retry
      if (pending.length === 0) break
      if (attempt === this.maxRetries) break
      const wait = r.retryAfterMs !== null ? Math.min(r.retryAfterMs, this.maxRetryAfterMs) : backoffMs(attempt)
      this._log(`${pending.length} events retryable — waiting ${Math.round(wait)}ms (attempt ${attempt + 1})`)
      await sleep(wait)
    }
    // Anything still pending exhausted its retries.
    return { sent, dropped: dropped + pending.length, failedHard: pending.length > 0 && sent === 0 }
  }

  private async _send(events: IngestPayload[]): Promise<SendOutcome> {
    if (this.batchSupported !== false) {
      const r = await this._post('/api/v1/ingest/batch', { events })
      if (r.kind === 'response' && (r.status === 404 || r.status === 405)) {
        this._log('batch endpoint not available — falling back to /api/v1/ingest')
        this.batchSupported = false
      } else {
        if (r.kind === 'response' && r.status < 300) this.batchSupported = true
        return interpretBatch(r, events)
      }
    }
    return this._sendSingles(events)
  }

  private async _sendSingles(events: IngestPayload[]): Promise<SendOutcome> {
    const out: SendOutcome = { sent: 0, dropped: 0, retry: [], retryAfterMs: null }
    for (let i = 0; i < events.length; i += SINGLE_CONCURRENCY) {
      const chunk = events.slice(i, i + SINGLE_CONCURRENCY)
      const results = await Promise.all(chunk.map(e =>
        this._post('/api/v1/ingest', e, { 'Idempotency-Key': e.idempotency_key })))
      results.forEach((r, j) => {
        if (r.kind === 'network' || isRetryableStatus(r.status)) {
          out.retry.push(chunk[j])
          if (r.kind === 'response' && r.retryAfterMs !== null)
            out.retryAfterMs = Math.max(out.retryAfterMs ?? 0, r.retryAfterMs)
        } else if (r.status < 300) {
          out.sent++
        } else {
          this._log(`event rejected with HTTP ${r.status} — dropped`)
          out.dropped++
        }
      })
    }
    return out
  }

  private async _post(path: string, body: unknown, extra: Record<string, string> = {}): Promise<HttpResult> {
    if (!this.fetchImpl) return { kind: 'network', error: 'fetch is not available' }
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null
    ;(timer as { unref?: () => void } | null)?.unref?.()
    try {
      const res = await this.fetchImpl(this.baseUrl + path, {
        method: 'POST',
        headers: {
          'Content-Type':   'application/json',
          'Authorization':  `Bearer ${this.apiKey}`,
          'X-TokenFin-SDK': `ts/${SDK_VERSION}`,
          ...extra,
        },
        body: JSON.stringify(body),
        signal: controller?.signal,
      })
      let parsed: unknown = null
      try { parsed = await res.json() } catch { /* empty / non-JSON body */ }
      return { kind: 'response', status: res.status, retryAfterMs: parseRetryAfter(res.headers.get('retry-after')), body: parsed }
    } catch (err) {
      // Log only the message — never the raw error (may include headers / Bearer token).
      this._log(`request to ${path} failed: ${errMsg(err)}`)
      return { kind: 'network', error: errMsg(err) }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private async _fetchPolicy(etag: string | null): Promise<PolicyFetchResult> {
    if (!this.fetchImpl) return { status: 'error' }
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null
    ;(timer as { unref?: () => void } | null)?.unref?.()
    try {
      const res = await this.fetchImpl(this.baseUrl + '/api/v1/policy', {
        method: 'GET',
        headers: {
          'Authorization':  `Bearer ${this.apiKey}`,
          'X-TokenFin-SDK': `ts/${SDK_VERSION}`,
          ...(etag ? { 'If-None-Match': etag } : {}),
        },
        signal: controller?.signal,
      })
      if (res.status === 304) return { status: 'not_modified' }
      if (res.status === 404 || res.status === 401 || res.status === 403) {
        this._log(`policy unavailable (HTTP ${res.status}) — routing off`)
        return { status: 'unavailable' }
      }
      if (!res.ok) return { status: 'error' }
      const body = await res.json() as Partial<Policy>
      if (!body || !Array.isArray(body.routes)) return { status: 'error' }
      const policy: Policy = {
        routes: body.routes.filter(r => r && typeof r.from === 'string' && typeof r.to === 'string'),
        blocked_models: Array.isArray(body.blocked_models) ? body.blocked_models.filter(m => typeof m === 'string') : [],
        version: String(body.version ?? ''),
        ttl_seconds: typeof body.ttl_seconds === 'number' ? body.ttl_seconds : undefined,
      }
      return { status: 'ok', policy, etag: res.headers.get('etag') }
    } catch (err) {
      this._log(`policy fetch failed: ${errMsg(err)}`)
      return { status: 'error' }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private _openCircuit(): void {
    this.cbFailures++
    if (this.cbFailures >= CB_THRESHOLD) {
      this.cbOpenUntil = Date.now() + CB_COOLDOWN
      this._log(`circuit opened — sending paused for ${CB_COOLDOWN / 1000}s`)
    }
  }

  private _stopTimer(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null }
  }

  /**
   * Flush on `beforeExit` (fires when the event loop drains — pending fetches
   * keep it alive until they finish). We deliberately do NOT register
   * SIGINT/SIGTERM handlers: adding one suppresses Node's default exit.
   */
  private _registerExitHooks(): void {
    const proc = (globalThis as { process?: NodeJS.Process }).process
    if (proc && typeof proc.once === 'function') {
      this.exitHandler = () => { if (this.queue.length > 0) this._flushBackground() }
      proc.on('beforeExit', this.exitHandler)
    }
    const win = (globalThis as { window?: Window }).window
    if (win && typeof win.addEventListener === 'function') {
      win.addEventListener('pagehide', () => this._flushBackground())
    }
  }

  private _detachExitHooks(): void {
    const proc = (globalThis as { process?: NodeJS.Process }).process
    if (this.exitHandler && proc && typeof proc.off === 'function') proc.off('beforeExit', this.exitHandler)
    this.exitHandler = null
  }

  private _log(...args: unknown[]): void {
    if (this.debug) console.debug('[TokenFin]', ...args)
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const OK_WORDS    = new Set(['ok', 'accepted', 'created', 'inserted', 'duplicate', 'deduped', 'skipped', 'success'])
const RETRY_WORDS = new Set(['retry', 'throttled', 'rate_limited', 'unavailable'])

/** Map a batch-endpoint response onto sent / dropped / retry. */
export function interpretBatch(r: HttpResult, events: IngestPayload[]): SendOutcome {
  if (r.kind === 'network') return { sent: 0, dropped: 0, retry: events, retryAfterMs: null }
  if (isRetryableStatus(r.status)) return { sent: 0, dropped: 0, retry: events, retryAfterMs: r.retryAfterMs }
  if (r.status >= 300) return { sent: 0, dropped: events.length, retry: [], retryAfterMs: null }

  const results = (r.body as { results?: unknown } | null)?.results
  if (!Array.isArray(results)) return { sent: events.length, dropped: 0, retry: [], retryAfterMs: null }

  const out: SendOutcome = { sent: 0, dropped: 0, retry: [], retryAfterMs: null }
  events.forEach((ev, i) => {
    const item = (results.find((x: { index?: number }) => x && x.index === i) ?? results[i]) as Record<string, unknown> | undefined
    const verdict = classifyItem(item)
    if (verdict === 'sent') out.sent++
    else if (verdict === 'retry') out.retry.push(ev)
    else out.dropped++
  })
  return out
}

function classifyItem(item: Record<string, unknown> | undefined): 'sent' | 'dropped' | 'retry' {
  if (!item || typeof item !== 'object') return 'sent' // server returned fewer results: assume accepted
  const status = item.status
  if (typeof status === 'number') {
    if (status < 300) return 'sent'
    return isRetryableStatus(status) ? 'retry' : 'dropped'
  }
  if (typeof status === 'string') {
    const s = status.toLowerCase()
    if (OK_WORDS.has(s)) return 'sent'
    if (RETRY_WORDS.has(s)) return 'retry'
    return 'dropped'
  }
  if (item.ok === true || item.accepted === true || item.duplicate === true) return 'sent'
  if (item.ok === false || item.error) return 'dropped'
  return 'sent'
}

function toPayload(e: TrackEvent): IngestPayload {
  const p: IngestPayload = { model: e.model, idempotency_key: e.idempotencyKey ?? uuidV4() }
  const num = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : undefined)
  const set = <K extends keyof IngestPayload>(k: K, v: IngestPayload[K] | undefined) => { if (v !== undefined && v !== null && v !== '') p[k] = v }
  set('input_tokens',       num(e.inputTokens))
  set('output_tokens',      num(e.outputTokens))
  set('cache_read_tokens',  num(e.cacheReadTokens))
  set('cache_write_tokens', num(e.cacheWriteTokens))
  set('total_tokens',       num(e.totalTokens))
  set('latency_ms',         num(e.latencyMs))
  set('project_id',  e.projectId)
  set('user_email',  e.userEmail)
  set('session_id',  e.sessionId)
  set('provider',    e.provider)
  set('source',      e.source)
  set('tool',        e.tool)
  set('prompt_text', e.promptText)
  set('prompt_hash', e.promptHash)
  set('timestamp', e.timestamp instanceof Date ? e.timestamp.toISOString() : (e.timestamp ?? new Date().toISOString()))
  if (e.tags && Object.keys(e.tags).length) p.tags = e.tags
  if (e.metadata && Object.keys(e.metadata).length) p.metadata = e.metadata
  return p
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
