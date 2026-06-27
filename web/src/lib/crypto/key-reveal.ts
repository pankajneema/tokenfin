/**
 * AES-256-GCM encryption for one-time API-key reveals.
 *
 * The raw key is encrypted with a server-only secret and stored as ciphertext
 * in `key_reveals`. It is decrypted exactly once when the recipient opens their
 * reveal link, then the ciphertext is destroyed. Server-only — never import in
 * a 'use client' file.
 *
 * Requires env KEY_ENCRYPTION_SECRET (any string; a 32-byte key is derived via
 * SHA-256). Set a strong, stable value in production — rotating it invalidates
 * any un-revealed links.
 */
import crypto from 'crypto'

function encryptionKey(): Buffer {
  const secret = process.env.KEY_ENCRYPTION_SECRET
  if (!secret) throw new Error('KEY_ENCRYPTION_SECRET is not set')
  return crypto.createHash('sha256').update(secret).digest() // 32 bytes
}

export interface SealedKey {
  ciphertext: string // base64
  iv: string         // base64
  authTag: string    // base64
}

export function sealKey(raw: string): SealedKey {
  const iv = crypto.randomBytes(12) // GCM standard nonce size
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const enc = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()])
  return {
    ciphertext: enc.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  }
}

export function openKey(sealed: SealedKey): string {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(sealed.iv, 'base64')
  )
  decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'))
  const dec = Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ])
  return dec.toString('utf8')
}

/** A URL-safe random token for the reveal link. */
export function revealToken(): string {
  return crypto.randomBytes(24).toString('base64url')
}
