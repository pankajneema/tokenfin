import { TokenFinConfig, TrackEvent, FlushResult, IngestPayload } from './types'
import { uuidV4, sleep, backoffMs } from './utils'

const DEFAULT_BASE_URL       = 'https://app.tokenfin.io'
const DEFAULT_TIMEOUT_MS     = 3_000
const DEFAULT_FLUSH_INTERVAL = 1_000
const DEFAULT_BATCH_SIZE     = 50
const DEFAULT_MAX_QUEUE      = 1_000
const MAX_RETRIES            = 3

// Status codes that are worth retrying
const RETRYABLE = new Set([429, 500, 502, 503, 504])

// ─── Circuit breaker state ─────────────────────────────────────────────────────
const CB_THRESHOLD = 5   // consecutive failures before opening
const CB_COOLDOWN  = 60_000 // 60s open before half-open probe

/**
 * TokenFin client.
 *
 * Events are queued in memory and flushed in batches, so `track()` never
 * blocks your application's hot path. The client flushes automatically on a
 * timer and on process/page exit.
 *
 * ```ts
 * const tf = new TokenFinClient({ apiKey: 'tf_live_...' })
 *
 * // After your LLM call — synchronous, non-blocking
 * tf.track({ model: 'gpt-4o', inputTokens: 800, outputTokens: 120 })
 *
 * // Graceful shutdown — waits for the queue to drain
 * await tf.flush()
 * ```
 */
export class TokenFinClient {
  private readonly apiKey:        string
  private readonly baseUrl:       string
  private readonly timeoutMs:     number
  private readonly batchSize:     number
  private readonly maxQueueSize:  number
  private readonly debug:         boolean

  private queue:      IngestPayload[]  = []
  private timer:      ReturnType<typeof setInterval> | null = null
  private flushing    = false

  // Circuit breaker
  private cbFailures = 0
  private cbOpenUntil = 0

  constructor(cfg: TokenFinConfig) {
    this.apiKey       = cfg.apiKey
    this.baseUrl      = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.timeoutMs    = cfg.timeoutMs    ?? DEFAULT_TIMEOUT_MS
    this.batchSize    = cfg.batchSize    ?? DEFAULT_BATCH_SIZE
    this.maxQueueSize = cfg.maxQueueSize ?? DEFAULT_MAX_QUEUE
    this.debug        = cfg.debug        ?? false

    const interval = cfg.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL
    if (interval > 0) {
      this.timer = setInterval(() => { this._flushBackground() }, interval)
      // Don't keep Node process alive just for this timer
      if (typeof this.timer === 'object' && this.timer !== null && 'unref' in this.timer) {
        (this.timer as NodeJS.Timeout).unref()
      }
    }

    // Graceful exit hooks — best-effort only
    this._registerExitHooks()
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Enqueue a usage event. Returns immediately — never throws.
   * The event will be sent on the next flush (timer or batchSize trigger).
   */
  track(event: TrackEvent): void {
    if (this.queue.length >= this.maxQueueSize) {
      this._log('queue full — dropping oldest event')
      this.queue.shift() // drop oldest to make room
    }

    this.queue.push({
      model:           event.model,
      input_tokens:    event.inputTokens,
      output_tokens:   event.outputTokens,
      idempotency_key: event.idempotencyKey ?? uuidV4(),
      tags:            event.tags,
      metadata:        event.metadata,
    })

    this._log(`queued event, queue length=${this.queue.length}`)

    // Flush immediately if we've hit the batch threshold
    if (this.queue.length >= this.batchSize) {
      this._flushBackground()
    }
  }

  /**
   * Drain the queue and wait for all in-flight requests to complete.
   * Call this before your process exits to avoid dropping queued events.
   */
  async flush(): Promise<FlushResult> {
    this._stopTimer()
    return this._flushOnce()
  }

  /**
   * Stop the auto-flush timer and drop any queued events.
   * Call if you want to shut down without flushing.
   */
  destroy(): void {
    this._stopTimer()
    const dropped = this.queue.length
    this.queue = []
    this._log(`destroyed — dropped ${dropped} queued events`)
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  /** Non-async wrapper for background flushing (timer + batch trigger). */
  private _flushBackground(): void {
    if (this.queue.length === 0 || this.flushing) return
    this._flushOnce().catch(() => {}) // errors handled inside
  }

  private async _flushOnce(): Promise<FlushResult> {
    if (this.queue.length === 0) return { sent: 0, dropped: 0 }

    // Prevent concurrent flushes
    if (this.flushing) return { sent: 0, dropped: 0 }
    this.flushing = true

    let sent    = 0
    let dropped = 0

    try {
      // Drain the queue in batches
      while (this.queue.length > 0) {
        // Circuit breaker check
        if (Date.now() < this.cbOpenUntil) {
          this._log(`circuit open — dropping ${this.queue.length} events`)
          dropped += this.queue.length
          this.queue = []
          break
        }

        const batch = this.queue.splice(0, this.batchSize)
        const ok    = await this._sendBatch(batch)

        if (ok) {
          sent            += batch.length
          this.cbFailures  = 0
        } else {
          // Re-queue failed batch at the front so next flush retries
          this.queue.unshift(...batch)
          dropped += batch.length
          this.queue.splice(0, batch.length) // remove from front (already counted)
          break
        }
      }
    } finally {
      this.flushing = false
    }

    return { sent, dropped }
  }

  /**
   * Send a single batch with retries and exponential backoff.
   * Returns true if the server accepted the batch.
   */
  private async _sendBatch(batch: IngestPayload[]): Promise<boolean> {
    const url = `${this.baseUrl}/api/v1/ingest`

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          await sleep(backoffMs(attempt - 1))
        }

        const controller = new AbortController()
        const timer      = setTimeout(() => controller.abort(), this.timeoutMs)

        // The Go ingest endpoint accepts a single event per request.
        // We make one request per event in the batch (parallel for throughput).
        const results = await Promise.allSettled(
          batch.map(payload =>
            fetch(url, {
              method:  'POST',
              headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
              },
              body:   JSON.stringify(payload),
              signal: controller.signal,
            })
          )
        )

        clearTimeout(timer)

        // Check for retryable failures
        const failures = results.filter(r =>
          r.status === 'rejected' ||
          (r.status === 'fulfilled' && RETRYABLE.has(r.value.status))
        )

        if (failures.length === 0) {
          this._log(`batch sent ok (${batch.length} events)`)
          return true
        }

        const hasRetryable = results.some(r =>
          r.status === 'rejected' ||
          (r.status === 'fulfilled' && RETRYABLE.has(r.value.status))
        )

        if (!hasRetryable || attempt === MAX_RETRIES - 1) {
          this._openCircuit()
          return false
        }

        this._log(`batch attempt ${attempt + 1} failed — retrying`)

      } catch (err) {
        if (attempt === MAX_RETRIES - 1) {
          this._openCircuit()
          return false
        }
        // Log only the message — never the raw Error object, which in some
        // fetch implementations includes request headers (Bearer token).
        const msg = err instanceof Error ? err.message : String(err)
        this._log(`send error (attempt ${attempt + 1}): ${msg}`)
      }
    }

    return false
  }

  private _openCircuit(): void {
    this.cbFailures++
    if (this.cbFailures >= CB_THRESHOLD) {
      this.cbOpenUntil = Date.now() + CB_COOLDOWN
      this._log(`circuit opened — will retry after ${CB_COOLDOWN / 1000}s`)
    }
  }

  private _stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private _registerExitHooks(): void {
    // Node.js process exit
    if (typeof process !== 'undefined' && typeof process.on === 'function') {
      const handler = () => {
        // Synchronous — best-effort, Node drains pending promises before exit
        this._flushBackground()
      }
      process.on('beforeExit', handler)
      process.on('SIGTERM',    handler)
      process.on('SIGINT',     handler)
    }

    // Browser page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this._flushBackground()
        }
      })
      window.addEventListener('beforeunload', () => {
        this._flushBackground()
      })
    }
  }

  private _log(...args: unknown[]): void {
    if (this.debug) {
      console.debug('[TokenFin]', ...args)
    }
  }
}
