/**
 * @tokenfin/sdk — official TypeScript SDK for TokenFin LLM cost attribution.
 *
 * ```ts
 * import Anthropic from '@anthropic-ai/sdk'
 * import { TokenFinClient, wrapAnthropic } from '@tokenfin/sdk'
 *
 * const tf = new TokenFinClient({ apiKey: process.env.TOKENFIN_API_KEY! })
 * const anthropic = wrapAnthropic(new Anthropic(), tf)   // usage is now tracked
 *
 * // or manually — fire-and-forget, never throws
 * tf.track({ model: 'gpt-4o', inputTokens: 800, outputTokens: 120 })
 *
 * await tf.shutdown()   // drain before exit
 * ```
 */

export { TokenFinClient, SDK_VERSION } from './client'
export { wrapAnthropic, wrapOpenAI } from './wrappers'
export type { WrapOptions } from './wrappers'
export { TokenFinPolicyError, PolicyManager, findRoute, isModelBlocked } from './policy'
export type { Policy, PolicyRoute } from './policy'
export type {
  TokenFinConfig,
  TrackEvent,
  FlushResult,
  ClientStats,
  IngestPayload,
} from './types'
export { createTokenFin } from './factory'
