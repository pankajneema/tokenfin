import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { sealKey, revealToken } from '@/lib/crypto/key-reveal'
import { generateApiKey, maskKey, hashKey } from '@/lib/api/keygen'
import { getOrgContext } from '@/lib/org-context'
import { scopesForKind, type KeyKind } from '@/lib/rbac'
import { audit } from '@/lib/audit'
import { READ_TOKEN_SUFFIX } from '@/lib/setup/key'
import { lookupApiKey } from '@/lib/api/auth'
import { invalidateKeyCache } from '@/lib/otlp/auth'

/**
 * POST /api/v1/cli/token  { label?, device_id?, device_label? }
 *
 * Mints PER-DEVICE API keys for the logged-in user's org and returns a SINGLE-USE
 * reveal token (never a raw key). Called by the browser from /cli/authorize with
 * the session cookie; the CLI exchanges the token once at POST /api/v1/keys/reveal
 * over loopback.
 *
 *  • device_id given (current CLI): two keys — an INGEST-only key (OTLP/SDK) and a
 *    READ key (MCP / status). Viewers get only the read key.
 *  • no device_id (older CLI): one legacy read+write key (read-only for viewers),
 *    device derived from the label (hostname) so hosts still don't collide.
 *
 * A repeat login from the SAME device rotates only that device's keys; keys on
 * other devices keep working. Keys are named "CLI · <device>".
 */
const DEVICE_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/


function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : ''
}

export async function POST(req: NextRequest) {
  const ctx = await getOrgContext()
  if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!ctx.orgId) return NextResponse.json({ error: 'No organization membership. Finish onboarding first.' }, { status: 403 })
  const { user, orgId, role } = ctx

  const body        = await req.json().catch(() => ({}))
  const deviceLabel = clean(body?.device_label, 60) || clean(body?.label, 60) || 'TokenFin CLI'
  const rawDeviceId = clean(body?.device_id, 128)
  if (rawDeviceId && !DEVICE_ID_RE.test(rawDeviceId)) {
    return NextResponse.json({ error: 'Invalid device_id' }, { status: 422 })
  }
  const split    = !!rawDeviceId
  const deviceId = rawDeviceId || `host:${deviceLabel}`.slice(0, 128)

  const admin = createAdminClient()

  // 1. Find (or create) a project to attach the keys to (deterministic: oldest).
  let { data: proj } = await admin.from('projects').select('id').eq('org_id', orgId)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (!proj) {
    if (role !== 'owner' && role !== 'admin') {
      return NextResponse.json({ error: 'No project exists yet. Ask an org owner or admin to create one.' }, { status: 403 })
    }
    const { data: created, error: projErr } = await admin.from('projects')
      .insert({ org_id: orgId, name: 'Default', slug: 'default' }).select('id').single()
    if (projErr || !created) return NextResponse.json({ error: 'Could not create a default project' }, { status: 500 })
    proj = created
  }
  const projectId = proj.id as string

  // 2. Which keys to mint.
  const plan: Array<{ kind: KeyKind; name: string; scopes: string[] }> = []
  const base = `CLI · ${deviceLabel}`.slice(0, 64)
  if (split) {
    if (role !== 'viewer') plan.push({ kind: 'ingest', name: base, scopes: scopesForKind('ingest') })
    plan.push({ kind: 'read', name: `${base} (read)`.slice(0, 64), scopes: scopesForKind('read') })
  } else {
    // Viewers are read-only: their CLI key cannot write/ingest.
    plan.push({ kind: 'legacy', name: base, scopes: role === 'viewer' ? ['read'] : scopesForKind('legacy') })
  }

  // 3. Generate + seal BEFORE touching rows, so a missing KEY_ENCRYPTION_SECRET
  //    fails cleanly without revoking the device's working keys.
  const env = 'production'
  let minted: Array<(typeof plan)[number] & { raw: string; sealed: ReturnType<typeof sealKey> }>
  try {
    minted = plan.map(p => { const raw = generateApiKey(projectId, env); return { ...p, raw, sealed: sealKey(raw) } })
  } catch {
    return NextResponse.json({ error: 'Server missing KEY_ENCRYPTION_SECRET; cannot complete CLI login.' }, { status: 501 })
  }

  // 4. Rotate ONLY this device's keys (other devices keep working).
  const { data: rotated } = await admin.from('api_keys')
    .update({ is_active: false })
    .eq('org_id', orgId).eq('user_id', user.id).eq('device_id', deviceId).eq('is_active', true)
    .select('id')
  if ((rotated ?? []).length) invalidateKeyCache()

  // 5. Insert keys (hash + masked prefix only).
  const { data: rows, error: keyErr } = await admin.from('api_keys').insert(minted.map(m => ({
    org_id: orgId, project_id: projectId, user_id: user.id, created_by: user.id,
    name: m.name, key_hash: hashKey(m.raw), key_prefix: maskKey(m.raw),
    env, scopes: m.scopes, kind: m.kind, device_id: deviceId, is_active: true,
  }))).select('id, kind')
  if (keyErr || !rows || rows.length !== minted.length) {
    console.error('[cli/token] key insert failed:', keyErr)
    return NextResponse.json({ error: 'Key creation failed' }, { status: 500 })
  }
  const idByKind = new Map(rows.map(r => [r.kind as string, r.id as string]))

  // 6. Single-use reveal records: primary token → ingest (or the only) key;
  //    `${token}.read` → the read key of a split pair. Roll back on failure.
  const token     = revealToken()
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString() // loopback exchange is immediate
  const primary   = minted[0]
  const reveals   = minted.map(m => ({
    token: m === primary ? token : token + READ_TOKEN_SUFFIX,
    key_id: idByKind.get(m.kind)!, org_id: orgId, email: user.email ?? null,
    ciphertext: m.sealed.ciphertext, iv: m.sealed.iv, auth_tag: m.sealed.authTag,
    expires_at: expiresAt,
  }))
  const { error: revErr } = await admin.from('key_reveals').insert(reveals)
  if (revErr) {
    await admin.from('api_keys').delete().in('id', rows.map(r => r.id as string))
    console.error('[cli/token] reveal insert failed:', revErr)
    return NextResponse.json({ error: 'Could not create reveal token' }, { status: 500 })
  }

  await audit({
    orgId, actorUserId: user.id, action: 'key.create', targetType: 'api_key', targetId: primary ? idByKind.get(primary.kind) ?? null : null,
    details: {
      via: 'cli_login', device: deviceLabel, device_id: deviceId, project_id: projectId,
      kinds: minted.map(m => m.kind), rotated: (rotated ?? []).length,
    },
  })

  return NextResponse.json({ token, device: deviceLabel, kinds: minted.map(m => m.kind), rotated: (rotated ?? []).length })
}

/**
 * DELETE /api/v1/cli/token  { device_id? }   (Bearer = one of the device's own keys)
 *
 * Self-revoke for `tokenfin remove`: deactivates every active key of the
 * caller's device (its ingest + read pair), so the other devices keep working.
 * A key without a device_id (old CLI / dashboard key) revokes only itself.
 * An unknown or already-revoked key answers 401 (the CLI treats that as done).
 */
export async function DELETE(req: NextRequest) {
  const found = await lookupApiKey(req)
  if (found.status !== 'ok') return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 })
  const { key } = found

  const admin = createAdminClient()
  const { data: row } = await admin.from('api_keys').select('device_id, user_id').eq('id', key.keyId).maybeSingle()
  const deviceId = (row?.device_id as string | null) ?? null

  const body      = await req.json().catch(() => ({}))
  const requested = clean(body?.device_id, 128)
  if (requested && deviceId && requested !== deviceId) {
    return NextResponse.json({ error: 'This key belongs to a different device' }, { status: 403 })
  }

  let q = admin.from('api_keys').update({ is_active: false }).eq('org_id', key.orgId).eq('is_active', true)
  q = deviceId && row?.user_id
    ? q.eq('user_id', row.user_id as string).eq('device_id', deviceId)
    : q.eq('id', key.keyId)
  const { data: revoked, error } = await q.select('id')
  if (error) {
    console.error('[cli/token] self-revoke failed:', error)
    return NextResponse.json({ error: 'Revoke failed' }, { status: 500 })
  }

  invalidateKeyCache()
  await audit({
    orgId: key.orgId, actorUserId: key.userId, action: 'key.toggle', targetType: 'api_key', targetId: key.keyId,
    details: { via: 'cli_remove', device_id: deviceId, revoked: (revoked ?? []).length },
  })
  return NextResponse.json({ revoked: (revoked ?? []).length })
}
