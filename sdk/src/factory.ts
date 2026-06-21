import { TokenFinClient } from './client'
import { TokenFinConfig } from './types'

/**
 * Create a TokenFin client.
 * Equivalent to `new TokenFinClient(cfg)` — provided for ergonomic imports.
 *
 * ```ts
 * import { createTokenFin } from '@tokenfin/sdk'
 * const tf = createTokenFin({ apiKey: process.env.TOKENFIN_API_KEY! })
 * ```
 */
export function createTokenFin(cfg: TokenFinConfig): TokenFinClient {
  return new TokenFinClient(cfg)
}
