// ─── Public types exported by @tokenfin/sdk ───────────────────────────────────

/** Configuration for the TokenFin client. */
export interface TokenFinConfig {
  /** API key — starts with "tfk_". Required. */
  apiKey: string

  /**
   * Base URL of your TokenFin instance.
   * @default "https://tokenfin.curiousdevs.com"
   */
  baseUrl?: string

  /** Per-request timeout in milliseconds. @default 5000 */
  timeoutMs?: number

  /**
   * Flush queued events after this many milliseconds even if batchSize is not
   * reached. 0 disables interval flushing (manual flush() only).
   * @default 1000
   */
  flushIntervalMs?: number

  /** Maximum events per HTTP request (server cap is 500). @default 100 */
  batchSize?: number

  /**
   * Maximum events held in memory. When full, the OLDEST event is dropped
   * (and counted in stats().dropped). @default 10000
   */
  maxQueueSize?: number

  /** Retry attempts per request for 408/429/5xx/network errors. @default 3 */
  maxRetries?: number

  /** Upper bound for honouring a Retry-After header, in ms. @default 30000 */
  maxRetryAfterMs?: number

  /**
   * Flush on Node's `beforeExit` event. The SDK never installs SIGINT/SIGTERM
   * handlers — call `shutdown()` from your own signal handler.
   * @default true
   */
  flushOnExit?: boolean

  /** Emit debug logs to console.debug. @default false */
  debug?: boolean

  /** Custom fetch implementation (tests, proxies). @default globalThis.fetch */
  fetch?: typeof fetch
}

/** Fields for a single LLM usage event. */
export interface TrackEvent {
  /** Model identifier, e.g. "gpt-4o", "claude-sonnet-4-6". */
  model: string
  /** Uncached input/prompt tokens. */
  inputTokens?: number
  /** Output/completion tokens. */
  outputTokens?: number
  /** Tokens read from the prompt cache. */
  cacheReadTokens?: number
  /** Tokens written to the prompt cache. */
  cacheWriteTokens?: number
  /** Only needed when input/output are not split. */
  totalTokens?: number

  /** TokenFin project UUID (defaults to the API key's project). */
  projectId?: string
  /** End-user / engineer attribution. */
  userEmail?: string
  /** Groups turns of one conversation / agent run. */
  sessionId?: string
  /** Wall-clock latency of the LLM call, in ms. */
  latencyMs?: number
  /** When the call happened. Date or ISO string. @default now */
  timestamp?: Date | string

  /** "anthropic", "openai", … */
  provider?: string
  /** Logical source, e.g. "sdk", "my-service". */
  source?: string
  /** Tool / integration name. */
  tool?: string

  /** Prompt text — only send when you have opted in to prompt capture. */
  promptText?: string
  /** Hash of the prompt (lets the server group duplicates without the text). */
  promptHash?: string

  /**
   * Deduplication key. Duplicates are discarded by the server.
   * Auto-generated (UUID v4) when omitted.
   */
  idempotencyKey?: string

  /** Free-form string labels — filterable in the dashboard. */
  tags?: Record<string, string>
  /** Arbitrary JSON — stored but not indexed. */
  metadata?: Record<string, unknown>
}

/** Outcome of a flush attempt. */
export interface FlushResult {
  /** Events accepted by the server (incl. idempotent duplicates). */
  sent: number
  /** Events rejected (non-retryable 4xx), or failed after all retries. */
  dropped: number
}

/** Lifetime counters for a client. */
export interface ClientStats extends FlushResult {
  /** Events currently waiting in the queue. */
  queued: number
}

/** Wire format sent to POST /api/v1/ingest and /api/v1/ingest/batch. */
export interface IngestPayload {
  model:               string
  input_tokens?:       number
  output_tokens?:      number
  cache_read_tokens?:  number
  cache_write_tokens?: number
  total_tokens?:       number
  project_id?:         string
  user_email?:         string
  session_id?:         string
  latency_ms?:         number
  timestamp?:          string
  provider?:           string
  source?:             string
  tool?:               string
  prompt_text?:        string
  prompt_hash?:        string
  idempotency_key:     string
  tags?:               Record<string, string>
  metadata?:           Record<string, unknown>
}
