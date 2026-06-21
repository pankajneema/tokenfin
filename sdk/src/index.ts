/**
 * @tokenfin/sdk
 *
 * Official TypeScript SDK for the TokenFin LLM Cost Attribution API.
 *
 * Quick start:
 * ```ts
 * import { TokenFinClient } from '@tokenfin/sdk'
 *
 * const tf = new TokenFinClient({ apiKey: 'tf_live_...' })
 *
 * // After any LLM call — fire-and-forget, never throws
 * tf.track({ model: 'gpt-4o', inputTokens: 800, outputTokens: 120 })
 *
 * // Drain before process exit
 * await tf.flush()
 * ```
 */

export { TokenFinClient } from './client'
export type {
  TokenFinConfig,
  TrackEvent,
  FlushResult,
  IngestPayload,
} from './types'

/**
 * Convenience factory — same as `new TokenFinClient(cfg)`.
 */
export { createTokenFin } from './factory'
