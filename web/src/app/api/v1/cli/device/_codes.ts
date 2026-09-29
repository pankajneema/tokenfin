/**
 * Device-code login (`npx tokenfin@latest login --device`) — stateless codes.
 *
 * No new table: nothing is stored until a signed-in user APPROVES.
 *
 *  • user_code  — 10 chars "ABCDE-FGH23" (8 random from a 32-char alphabet
 *                 without I/O/0/1 = 40 bits, + 2 HMAC check chars so typos and
 *                 made-up codes are rejected before anything is minted).
 *  • device_code — base64url(JSON{uc,exp,did,lbl}).HMAC — only the CLI that
 *                 called /start holds it; /poll verifies the MAC + expiry.
 *  • On approve, the server mints the per-device keys (via /api/v1/cli/token)
 *    and parks the resulting single-use reveal token in `key_reveals` under a
 *    SERVER-DERIVED handle, HMAC(secret, user_code) — sealed with AES-GCM and
 *    expiring in 10 min. /poll recomputes the handle from the verified
 *    device_code, claims the row once, and hands the inner token to the CLI,
 *    which exchanges it at /api/v1/keys/reveal exactly like browser login.
 *
 * Server-only (uses KEY_ENCRYPTION_SECRET).
 */
import crypto from 'crypto'

export const DEVICE_CODE_TTL_S = 600
export const POLL_INTERVAL_S = 5
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 32 chars, no I O 0 1

function secret(): Buffer {
  const s = process.env.KEY_ENCRYPTION_SECRET
  if (!s) throw new Error('KEY_ENCRYPTION_SECRET is not set')
  return crypto.createHash('sha256').update('tokenfin-device-login:' + s).digest()
}
const mac = (msg: string) => crypto.createHmac('sha256', secret()).update(msg).digest()

function checkChars(random: string): string {
  const h = mac('uc:' + random)
  return ALPHABET[h[0] % 32] + ALPHABET[h[1] % 32]
}

/** Normalise user input: uppercase, drop spaces/dashes. */
export function normalizeUserCode(input: string): string {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function formatUserCode(norm: string): string {
  return norm.slice(0, 5) + '-' + norm.slice(5)
}

export function newUserCode(): string {
  const bytes = crypto.randomBytes(8)
  let r = ''
  for (let i = 0; i < 8; i++) r += ALPHABET[bytes[i] % 32]
  return r + checkChars(r)
}

/** Well-formed and carries a valid check suffix (typo / guess guard). */
export function isValidUserCode(norm: string): boolean {
  if (!/^[A-HJ-NP-Z2-9]{10}$/.test(norm)) return false
  const expected = checkChars(norm.slice(0, 8))
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(norm.slice(8)))
}

export interface DevicePayload { uc: string; exp: number; did: string | null; lbl: string | null }

export function signDeviceCode(p: DevicePayload): string {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url')
  return body + '.' + mac('dc:' + body).toString('base64url')
}

export function verifyDeviceCode(code: string): DevicePayload | null {
  if (typeof code !== 'string' || code.length > 2048) return null
  const [body, sig] = code.split('.')
  if (!body || !sig) return null
  const expected = mac('dc:' + body)
  const got = Buffer.from(sig, 'base64url')
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as DevicePayload
    if (typeof p.uc !== 'string' || typeof p.exp !== 'number') return null
    return p
  } catch { return null }
}

/** The key_reveals.token under which an approval for `norm` is parked. */
export function approvalHandle(norm: string): string {
  return 'dev_' + mac('handle:' + norm).toString('base64url')
}

export const DEVICE_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/
export function cleanLabel(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) : ''
}
