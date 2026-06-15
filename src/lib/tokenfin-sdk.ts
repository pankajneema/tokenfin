/**
 * TokenFin Fire-and-Forget SDK
 *
 * Usage:
 *   import { TokenFin } from '@/lib/tokenfin-sdk'
 *   const tf = new TokenFin({ apiKey: 'tf_live_proj_...', baseUrl: 'https://app.tokenfin.io' })
 *
 *   // After your LLM call — never throws, never blocks
 *   tf.track({ model: 'gpt-4o', promptTokens: 800, completionTokens: 120 })
 */

export interface TrackOptions {
  model:            string
  promptTokens:     number
  completionTokens: number
  latencyMs?:       number
  tags?:            Record<string, string>
  metadata?:        Record<string, unknown>
}

export interface TokenFinConfig {
  apiKey:   string
  baseUrl?: string
  timeout?: number   // default 2000ms
  debug?:   boolean
}

export class TokenFin {
  private apiKey:  string
  private baseUrl: string
  private timeout: number
  private debug:   boolean

  // Circuit breaker
  private failures  = 0
  private openUntil = 0
  private readonly THRESHOLD  = 3
  private readonly COOLDOWN   = 60_000  // 60s

  constructor(cfg: TokenFinConfig) {
    this.apiKey  = cfg.apiKey
    this.baseUrl = (cfg.baseUrl ?? 'https://app.tokenfin.io').replace(/\/$/, '')
    this.timeout = cfg.timeout ?? 2000
    this.debug   = cfg.debug ?? false
  }

  /** Fire-and-forget — never throws, never blocks. */
  track(opts: TrackOptions): void {
    this._send(opts).catch(() => {})
  }

  private async _send(opts: TrackOptions): Promise<void> {
    if (Date.now() < this.openUntil) {
      if (this.debug) console.debug('[TokenFin] circuit open — skipping')
      return
    }

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeout)

      const res = await fetch(`${this.baseUrl}/api/ingest`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key:           this.apiKey,
          model:             opts.model,
          prompt_tokens:     opts.promptTokens,
          completion_tokens: opts.completionTokens,
          latency_ms:        opts.latencyMs,
          tags:              opts.tags ?? {},
          metadata:          opts.metadata ?? {},
        }),
        signal: controller.signal,
      })

      clearTimeout(timer)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      this.failures = 0
      if (this.debug) console.debug('[TokenFin] tracked ok')
    } catch (err) {
      this.failures++
      if (this.failures >= this.THRESHOLD) {
        this.openUntil = Date.now() + this.COOLDOWN
        if (this.debug) console.debug('[TokenFin] circuit opened 60s')
      }
      if (this.debug) console.debug('[TokenFin] error:', err)
    }
  }
}

export function createTokenFin(cfg: TokenFinConfig) {
  return new TokenFin(cfg)
}
