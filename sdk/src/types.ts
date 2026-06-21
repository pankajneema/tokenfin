// ─── Public types exported by @tokenfin/sdk ───────────────────────────────────

/** Configuration for the TokenFin client. */
export interface TokenFinConfig {
  /** API key — starts with "tf_". Required. */
  apiKey: string

  /**
   * Base URL of your TokenFin instance.
   * @default "https://app.tokenfin.io"
   */
  baseUrl?: string

  /**
   * Per-request timeout in milliseconds.
   * @default 3000
   */
  timeoutMs?: number

  /**
   * Flush queued events after this many milliseconds even if batchSize not reached.
   * Set to 0 to disable interval flushing (manual flush() only).
   * @default 1000
   */
  flushIntervalMs?: number

  /**
   * Maximum events per HTTP request.
   * @default 50
   */
  batchSize?: number

  /**
   * Maximum events held in memory before oldest are dropped.
   * Guards against unbounded growth if the ingest endpoint is down.
   * @default 1000
   */
  maxQueueSize?: number

  /**
   * Emit debug logs to console.debug.
   * @default false
   */
  debug?: boolean
}

/** Fields for a single LLM usage event. */
export interface TrackEvent {
  /** Model identifier, e.g. "gpt-4o", "claude-sonnet-4-6". */
  model: string

  /** Number of input/prompt tokens consumed. */
  inputTokens: number

  /** Number of output/completion tokens produced. */
  outputTokens: number

  /**
   * Optional idempotency key. If provided, duplicate events with the same key
   * are silently discarded by the server (24h window).
   * If omitted, the SDK auto-generates a UUID v4 per event.
   */
  idempotencyKey?: string

  /** Free-form string labels — filterable in the dashboard. */
  tags?: Record<string, string>

  /** Arbitrary JSON — stored but not indexed. */
  metadata?: Record<string, unknown>
}

/** Outcome of a flush attempt. */
export interface FlushResult {
  /** Events successfully accepted by the server. */
  sent: number
  /** Events that failed after all retries and were dropped. */
  dropped: number
}

/** Internal wire format sent to POST /api/v1/ingest */
export interface IngestPayload {
  model:            string
  input_tokens:     number
  output_tokens:    number
  idempotency_key?: string
  tags?:            Record<string, string>
  metadata?:        Record<string, unknown>
}
