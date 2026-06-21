/**
 * Generate a UUID v4 without external dependencies.
 * Uses Web Crypto API (browser + Node 18+).
 */
export function uuidV4(): string {
  // Node 18+ and all modern browsers expose crypto.randomUUID
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback: manual construction using getRandomValues
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant bits
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}

/**
 * Sleep for `ms` milliseconds — used for exponential backoff.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Compute exponential backoff delay with jitter.
 * attempt=0 → ~100ms, attempt=1 → ~200ms, attempt=2 → ~400ms, capped at 5s.
 */
export function backoffMs(attempt: number): number {
  const base = 100 * Math.pow(2, attempt)
  const jitter = Math.random() * base * 0.3
  return Math.min(base + jitter, 5_000)
}
