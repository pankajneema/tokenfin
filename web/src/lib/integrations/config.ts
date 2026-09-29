/**
 * Integration config at rest — secrets sealed with AES-256-GCM (sealKey) and
 * only a masked display value kept readable. Server-only.
 *
 * Stored shape for a secret field (e.g. config.webhook_url):
 *   { enc: { ciphertext, iv, authTag }, masked: 'https://hooks.slack.com/…/a1b2' }
 * Legacy rows stored the plain string; readSecret() returns those as-is so old
 * rows keep working until they are re-saved.
 */
import { sealKey, openKey, type SealedKey } from '@/lib/crypto/key-reveal'

/** The only channels that actually deliver (see lib/notify/send.ts). */
export const SUPPORTED_INTEGRATIONS = ['slack', 'webhook', 'email'] as const
export type SupportedIntegration = typeof SUPPORTED_INTEGRATIONS[number]
export function isSupportedIntegration(v: string): v is SupportedIntegration {
  return (SUPPORTED_INTEGRATIONS as readonly string[]).includes(v)
}

/** Config keys whose values are secrets (URLs with embedded tokens, keys). */
export const SECRET_FIELDS = ['webhook_url', 'url', 'endpoint', 'api_key', 'token', 'secret'] as const
const SECRET_SET = new Set<string>(SECRET_FIELDS)
/** Fields the alert engine POSTs to, in priority order. */
const URL_FIELDS = ['webhook_url', 'url', 'endpoint'] as const

export interface SealedField { enc: SealedKey; masked: string }
type Config = Record<string, unknown>

function isSealed(v: unknown): v is SealedField {
  if (!v || typeof v !== 'object') return false
  const e = (v as { enc?: unknown }).enc as Record<string, unknown> | undefined
  return !!e && typeof e.ciphertext === 'string' && typeof e.iv === 'string' && typeof e.authTag === 'string'
}

/** Masked display value: never reveals more than the last 4 characters of the secret part. */
export function maskSecret(raw: string): string {
  const s = raw.trim()
  try {
    const u = new URL(s)
    const tail = (u.pathname + u.search).replace(/\/+$/, '')
    return `${u.protocol}//${u.host}/…${tail.length > 4 ? tail.slice(-4) : ''}`
  } catch {
    return s.length <= 8 ? '••••' : `${s.slice(0, 4)}…${s.slice(-4)}`
  }
}

/** Seal every secret field of a config object; non-secret fields are kept as-is. */
export function sealConfig(config: Config): Config {
  const out: Config = {}
  for (const [k, v] of Object.entries(config)) {
    if (SECRET_SET.has(k) && typeof v === 'string' && v.trim()) {
      out[k] = { enc: sealKey(v.trim()), masked: maskSecret(v) } satisfies SealedField
    } else if (SECRET_SET.has(k) && (v === '' || v == null)) {
      continue
    } else {
      out[k] = v
    }
  }
  return out
}

/** Decrypted value of one config field. Legacy plaintext strings are returned as-is.
 * Returns null when missing or when the ciphertext can't be opened (wrong secret / tampered). */
export function readSecret(config: Config | null | undefined, field: string): string | null {
  const v = config?.[field]
  if (typeof v === 'string') return v.trim() || null
  if (isSealed(v)) {
    try { return openKey(v.enc).trim() || null } catch { return null }
  }
  return null
}

/** Public view of a config: secrets replaced by their masked value, never ciphertext. */
export function publicConfig(config: Config | null | undefined): Config {
  const out: Config = {}
  for (const [k, v] of Object.entries(config ?? {})) {
    if (SECRET_SET.has(k)) {
      if (isSealed(v)) out[k] = v.masked
      else if (typeof v === 'string' && v) out[k] = maskSecret(v)
    } else {
      out[k] = v
    }
  }
  return out
}

/** The URL the alert engine should deliver to for `provider`, decrypted. */
export function integrationUrl(
  rows: { provider: string; config: Config | null }[] | null | undefined,
  provider: string,
): string | null {
  const row = (rows ?? []).find(i => i.provider === provider)
  if (!row) return null
  // Only the admin-configured config URL is used — never the free-text `detail`
  // column. The URL is re-validated against SSRF rules at send time.
  for (const f of URL_FIELDS) {
    const v = readSecret(row.config, f)
    if (v) return v
  }
  return null
}
