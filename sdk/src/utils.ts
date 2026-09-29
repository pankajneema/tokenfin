/**
 * Generate a UUID v4 without external dependencies.
 * Web Crypto when available (browsers, Node 19+); Node 18 does not expose
 * `globalThis.crypto` by default, so fall back to node:crypto, then Math.random.
 */
export function uuidV4(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()

  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes)
  } else {
    const nodeCrypto = loadNodeCrypto()
    if (nodeCrypto?.randomUUID) return nodeCrypto.randomUUID()
    if (nodeCrypto?.randomBytes) bytes.set(nodeCrypto.randomBytes(16))
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant bits
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

interface NodeCryptoLike { randomUUID?: () => string; randomBytes?: (n: number) => Uint8Array }

function loadNodeCrypto(): NodeCryptoLike | null {
  try {
    const proc = (globalThis as { process?: { getBuiltinModule?: (m: string) => unknown } }).process
    if (proc?.getBuiltinModule) return proc.getBuiltinModule('node:crypto') as NodeCryptoLike
    // CJS builds (Node 18) still have `require`.
    const req = (globalThis as { require?: (m: string) => unknown }).require
      ?? (typeof require === 'function' ? require : undefined)
    if (req) return req('crypto') as NodeCryptoLike
  } catch { /* fall through */ }
  return null
}

/** Sleep for `ms` milliseconds (timer is unref'd so it never holds the process open). */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms)
    ;(t as { unref?: () => void }).unref?.()
  })
}

/**
 * Exponential backoff with jitter.
 * attempt=0 → ~100ms, 1 → ~200ms, 2 → ~400ms, capped at 5s.
 */
export function backoffMs(attempt: number): number {
  const base = 100 * Math.pow(2, attempt)
  return Math.min(base + Math.random() * base * 0.3, 5_000)
}

/** Parse a Retry-After header (delta-seconds or HTTP-date) into ms. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(parseFloat(trimmed) * 1000)
  const at = Date.parse(trimmed)
  if (Number.isNaN(at)) return null
  return Math.max(0, at - now)
}

/** Status codes worth retrying. Other 4xx are permanent → dropped. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}
