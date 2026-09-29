import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { openKey } from '@/lib/crypto/key-reveal'

/**
 * POST /api/v1/keys/reveal  { token }
 *
 * Returns the raw API key for a provisioned member EXACTLY ONCE, then destroys
 * the stored ciphertext. Intentionally unauthenticated — security comes from
 * the 192-bit unguessable token, atomic single-use semantics, and an expiry (7 days for provisioning links,
 * 10 minutes for CLI login tokens)
 * (same model as a password-reset link).
 */
export async function POST(req: NextRequest) {
  const { token } = await req.json().catch(() => ({ token: '' }))
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'token required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Atomic single-use claim: exactly one caller can flip revealed_at from NULL.
  // Concurrent requests race on this UPDATE; the loser gets zero rows back.
  // The claim returns the secret material, which is then nulled in a second
  // update (the row is already burned, so no one else can read it).
  const nowIso = new Date().toISOString()
  const { data: claimed, error: claimErr } = await admin
    .from('key_reveals')
    .update({ revealed_at: nowIso })
    .eq('token', token)
    .is('revealed_at', null)
    .gt('expires_at', nowIso)
    .not('ciphertext', 'is', null)
    .select('key_id, email, ciphertext, iv, auth_tag')
    .maybeSingle()

  if (claimErr) {
    console.error('[keys/reveal] claim failed:', claimErr)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (!claimed) {
    // Distinguish the failure for a useful message (no secret material selected).
    const { data: row } = await admin
      .from('key_reveals').select('expires_at, revealed_at').eq('token', token).maybeSingle()
    if (!row)                                  return NextResponse.json({ error: 'Invalid link' }, { status: 404 })
    if (row.revealed_at)                       return NextResponse.json({ error: 'This key has already been revealed' }, { status: 410 })
    if (new Date(row.expires_at) <= new Date()) return NextResponse.json({ error: 'This link has expired' }, { status: 410 })
    return NextResponse.json({ error: 'This key has already been revealed' }, { status: 410 })
  }

  // Burn the secret material regardless of whether decryption succeeds.
  await admin.from('key_reveals')
    .update({ ciphertext: null, iv: null, auth_tag: null })
    .eq('token', token)

  let raw: string
  try {
    raw = openKey({ ciphertext: claimed.ciphertext, iv: claimed.iv, authTag: claimed.auth_tag })
  } catch {
    return NextResponse.json({ error: 'Unable to decrypt key' }, { status: 500 })
  }

  return NextResponse.json({ raw_key: raw, email: claimed.email })
}
