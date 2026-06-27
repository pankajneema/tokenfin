import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { openKey } from '@/lib/crypto/key-reveal'

/**
 * POST /api/v1/keys/reveal  { token }
 *
 * Returns the raw API key for a provisioned member EXACTLY ONCE, then destroys
 * the stored ciphertext. Intentionally unauthenticated — security comes from
 * the 192-bit unguessable token, single-use semantics, and a 7-day expiry
 * (same model as a password-reset link).
 */
export async function POST(req: NextRequest) {
  const { token } = await req.json().catch(() => ({ token: '' }))
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'token required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('key_reveals')
    .select('key_id, email, ciphertext, iv, auth_tag, expires_at, revealed_at')
    .eq('token', token)
    .maybeSingle()

  if (!row)                                   return NextResponse.json({ error: 'Invalid link' }, { status: 404 })
  if (row.revealed_at || !row.ciphertext)     return NextResponse.json({ error: 'This key has already been revealed' }, { status: 410 })
  if (new Date(row.expires_at) < new Date())  return NextResponse.json({ error: 'This link has expired' }, { status: 410 })

  let raw: string
  try {
    raw = openKey({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag })
  } catch {
    return NextResponse.json({ error: 'Unable to decrypt key' }, { status: 500 })
  }

  // Burn it: single-use. Null the secret material and stamp revealed_at.
  await admin.from('key_reveals')
    .update({ revealed_at: new Date().toISOString(), ciphertext: null, iv: null, auth_tag: null })
    .eq('token', token)

  return NextResponse.json({ raw_key: raw, email: row.email })
}
