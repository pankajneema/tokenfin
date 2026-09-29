import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { openKey } from '@/lib/crypto/key-reveal'
import { verifyDeviceCode, approvalHandle } from '../_codes'

/**
 * POST /api/v1/cli/device/poll  { device_code }   (no auth — the signed
 * device_code is the credential)
 *
 *  400 { error: 'authorization_pending' }  not approved yet — keep polling
 *  400 { error: 'expired_token' }          the code's 10 minutes are up
 *  400 { error: 'invalid_grant' }          forged / malformed / already used
 *  200 { token }                           single-use reveal token → exchange
 *                                          at POST /api/v1/keys/reveal
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  let p
  try { p = verifyDeviceCode(body?.device_code) } catch {
    return NextResponse.json({ error: 'server_error', error_description: 'KEY_ENCRYPTION_SECRET not set' }, { status: 501 })
  }
  if (!p) return NextResponse.json({ error: 'invalid_grant' }, { status: 400 })
  if (Date.now() > p.exp) return NextResponse.json({ error: 'expired_token' }, { status: 400 })

  const handle = approvalHandle(p.uc)
  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  // Atomic single-use claim (same pattern as /api/v1/keys/reveal).
  const { data: claimed, error } = await admin.from('key_reveals')
    .update({ revealed_at: nowIso })
    .eq('token', handle).is('revealed_at', null).gt('expires_at', nowIso).not('ciphertext', 'is', null)
    .select('ciphertext, iv, auth_tag')
    .maybeSingle()
  if (error) {
    console.error('[cli/device/poll] claim failed:', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
  if (!claimed) {
    const { data: row } = await admin.from('key_reveals').select('revealed_at').eq('token', handle).maybeSingle()
    if (row?.revealed_at) return NextResponse.json({ error: 'invalid_grant', error_description: 'already used' }, { status: 400 })
    return NextResponse.json({ error: 'authorization_pending' }, { status: 400 })
  }
  await admin.from('key_reveals').update({ ciphertext: null, iv: null, auth_tag: null }).eq('token', handle)

  try {
    const token = openKey({ ciphertext: claimed.ciphertext, iv: claimed.iv, authTag: claimed.auth_tag })
    return NextResponse.json({ token })
  } catch {
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
