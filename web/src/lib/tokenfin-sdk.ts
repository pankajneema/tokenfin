/**
 * TokenFin SDK — in-app copy for the Next.js dashboard.
 *
 * This mirrors the standalone @tokenfin/sdk package (sdk/ at monorepo root).
 * For external integrations, install the npm package instead.
 *
 * Key corrections vs the old version:
 *  - Auth:     Authorization: Bearer header  (NOT api_key in body)
 *  - Endpoint: /api/v1/ingest               (NOT /api/ingest)
 *  - Fields:   input_tokens/output_tokens   (NOT prompt_tokens/completion_tokens)
 *  - Idempotency key auto-generated per event
 *  - Batching with configurable flush interval
 */

export interface TrackEvent {
  model:            string
  inputTokens:      number
  outputTokens:     number
  idempotencyKey?:  string
  tags?:            Record<string, string>
  metadata?:        Record<string, unknown>
}

export interface TokenFinConfig {
  apiKey:           string
  baseUrl?:         string
  timeoutMs?:       number
  flushIntervalMs?: number
  batchSize?:       number
  debug?:           boolean
}

export interface FlushResult {
  sent:    number
  dropped: number
}

// ─── Internals ────────────────────────────────────────────────────────────────

const MAX_RETRIES    = 3
const CB_THRESHOLD   = 5
const CB_COOLDOWN_MS = 60_000
const RETRYABLE      = new Set([429, 500, 502, 503, 504])

function uuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`
}

function backoffMs(attempt: number): number {
  return Math.min(100 * Math.pow(2, attempt) * (1 + Math.random() * 0.3), 5_000)
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class TokenFin {
  private readonly apiKey:       string
  private readonly baseUrl:      string
  private readonly timeoutMs:    number
  private readonly batchSize:    number
  private readonly debug:        boolean

  private queue:    Array<Record<string, unknown>> = []
  private timer:    ReturnType<typeof setInterval> | null = null
  private flushing  = false
  private cbFails   = 0
  private cbUntil   = 0

  constructor(cfg: TokenFinConfig) {
    this.apiKey    = cfg.apiKey
    this.baseUrl   = (cfg.baseUrl ?? 'https://app.tokenfin.io').replace(/\/$/, '')
    this.timeoutMs = cfg.timeoutMs  ?? 3_000
    this.batchSize = cfg.batchSize  ?? 50
    this.debug     = cfg.debug      ?? false

    const interval = cfg.flushIntervalMs ?? 1_000
    if (interval > 0) {
      this.timer = setInterval(() => this._bg(), interval)
    }
  }

  /** Fire-and-forget — synchronous, never throws. */
  track(event: TrackEvent): void {
    this.queue.push({
      model:           event.model,
      input_tokens:    event.inputTokens,
      output_tokens:   event.outputTokens,
      idempotency_key: event.idempotencyKey ?? uuidV4(),
      tags:            event.tags,
      metadata:        event.metadata,
    })
    if (this.queue.length >= this.batchSize) this._bg()
  }

  /** Drain queue and await delivery. Call before process.exit(). */
  async flush(): Promise<FlushResult> {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    return this._drain()
  }

  private _bg(): void {
    if (!this.flushing && this.queue.length > 0) this._drain().catch(() => {})
  }

  private async _drain(): Promise<FlushResult> {
    if (this.queue.length === 0 || this.flushing) return { sent: 0, dropped: 0 }
    this.flushing = true
    let sent = 0, dropped = 0
    try {
      while (this.queue.length > 0) {
        if (Date.now() < this.cbUntil) {
          dropped += this.queue.length
          this.queue = []
          break
        }
        const batch = this.queue.splice(0, this.batchSize)
        const ok    = await this._send(batch)
        if (ok) { sent += batch.length; this.cbFails = 0 }
        else    { dropped += batch.length; break }
      }
    } finally {
      this.flushing = false
    }
    return { sent, dropped }
  }

  private async _send(batch: Array<Record<string, unknown>>): Promise<boolean> {
    const url = `${this.baseUrl}/api/v1/ingest`
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, backoffMs(attempt - 1)))
      try {
        const ctrl  = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
        const results = await Promise.allSettled(
          batch.map(payload =>
            fetch(url, {
              method:  'POST',
              headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
              },
              body:   JSON.stringify(payload),
              signal: ctrl.signal,
            })
          )
        )
        clearTimeout(timer)
        const anyFail = results.some(r =>
          r.status === 'rejected' ||
          (r.status === 'fulfilled' && RETRYABLE.has(r.value.status))
        )
        if (!anyFail) { this._log('batch ok', batch.length); return true }
        if (attempt < MAX_RETRIES - 1) { this._log('retrying…'); continue }
      } catch { /* timeout / network */ }
    }
    this.cbFails++
    if (this.cbFails >= CB_THRESHOLD) this.cbUntil = Date.now() + CB_COOLDOWN_MS
    return false
  }

  private _log(...a: unknown[]): void {
    if (this.debug) console.debug('[TokenFin]', ...a)
  }
}

export function createTokenFin(cfg: TokenFinConfig): TokenFin {
  return new TokenFin(cfg)
}
