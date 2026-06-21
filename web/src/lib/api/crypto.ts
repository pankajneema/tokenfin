/**
 * Cryptographic helpers — key generation and hashing.
 * Used by /api/v1/keys route and the ingest route.
 */
import crypto from 'crypto'

/** SHA-256 hex digest */
export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

/**
 * Generate a new API key.
 * Format: tf_live_proj_{4-char project segment}_{32 hex chars}
 */
export function generateApiKey(projectId: string): string {
  const segment = projectId.replace(/-/g, '').slice(0, 4)
  const secret  = crypto.randomBytes(16).toString('hex')
  return `tf_live_proj_${segment}_${secret}`
}

/** First 20 chars of the raw key, stored for lookup without needing the full hash. */
export function keyPrefix(rawKey: string): string {
  return rawKey.slice(0, 20)
}
