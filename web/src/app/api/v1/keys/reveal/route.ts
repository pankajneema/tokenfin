import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { openKey } from '@/lib/crypto/key-reveal'
import { READ_TOKEN_SUFFIX } from '@/lib/setup/key'
import { audit } from '@/lib/audit'

type Admin = ReturnType<typeof createAdminClient>
interface Claimed { key_id: string; org_id: string; email: string | null; ciphertext: string; iv: string; auth_tag: string }

// Atomic single-use claim: exactly one caller can flip revealed_at from NULL.
async function claim(admin: Admin, token: string) {
  const nowIso = new Date().toISOString()
  return admin
    .from('key_reveals')
    .update({ revealed_at: nowIso })
    .eq('token', token)
    .is('revealed_at', null)
    .gt('expires_at', nowIso)
    .not('ciphertext', 'is', null)
    .select('key_id, org_id, email, ciphertext, iv, auth_tag')
    .maybeSingle<Claimed>()
}

async function burn(admin: Admin, token: string) {
  await admin.from('key_reveals').update({ ciphertext: null, iv: null, auth_tag: null }).eq('token', token)
}

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
  // The secondary read-key token is only ever claimed together with its primary.
  if (!token || typeof token !== 'string' || token.endsWith(READ_TOKEN_SUFFIX)) {
    return NextResponse.json({ error: 'token required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Atomic single-use claim: exactly one caller can flip revealed_at from NULL.
  // Concurrent requests race on this UPDATE; the loser gets zero rows back.
  // The claim returns the secret material, which is then nulled in a second
  // update (the row is already burned, so no one else can read it).
  const { data: claimed, error: claimErr } = await claim(admin, token)

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
  await burn(admin, token)

  // Split CLI login: the read key rides on `${token}.read` (claimed + burned here).
  const { data: second } = await claim(admin, token + READ_TOKEN_SUFFIX)
  if (second) await burn(admin, token + READ_TOKEN_SUFFIX)

  let raw: string
  let readRaw: string | null = null
  try {
    raw = openKey({ ciphertext: claimed.ciphertext, iv: claimed.iv, authTag: claimed.auth_tag })
    if (second) readRaw = openKey({ ciphertext: second.ciphertext, iv: second.iv, authTag: second.auth_tag })
  } catch {
    return NextResponse.json({ error: 'Unable to decrypt key' }, { status: 500 })
  }

  const keyIds = [claimed.key_id, ...(second ? [second.key_id] : [])]
  const { data: kinds } = await admin.from('api_keys').select('id, kind').in('id', keyIds)
  const kindOf = (id: string) => (kinds ?? []).find(k => k.id === id)?.kind as string | undefined
  const primaryKind = kindOf(claimed.key_id) ?? 'legacy'

  await audit({
    orgId: claimed.org_id, actorUserId: null, action: 'key.reveal', targetType: 'api_key', targetId: claimed.key_id,
    details: { via: 'one_time_link', email: claimed.email, key_ids: keyIds },
  })

  // raw_key stays the primary key for older CLIs. New CLIs read ingest_key/read_key:
  //   ingest_key → OTLP/SDK telemetry, read_key → MCP / status reads.
  return NextResponse.json({
    raw_key: raw,
    email: claimed.email,
    kind: primaryKind,
    ingest_key: primaryKind === 'read' ? null : raw,
    read_key: readRaw ?? (primaryKind === 'ingest' ? null : raw),
  })
}
