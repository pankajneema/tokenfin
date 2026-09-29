import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { sealKey } from '@/lib/crypto/key-reveal'
import { getOrgContext } from '@/lib/org-context'
import { POST as mintCliToken } from '../../token/route'
import {
  normalizeUserCode, isValidUserCode, approvalHandle, cleanLabel, DEVICE_ID_RE, DEVICE_CODE_TTL_S,
} from '../_codes'

/**
 * POST /api/v1/cli/device/approve  { user_code, device?, device_id? }  (session)
 *
 * Called by /cli/device when a signed-in user approves a code shown by
 * `npx tokenfin@latest login --device`. Mints the per-device keys through the
 * SAME code path as browser login (POST /api/v1/cli/token, in-process, with
 * this request's session), then parks the single-use reveal token under the
 * server-derived handle for /poll to collect. See ../_codes.ts.
 */
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext()
  if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!ctx.orgId) return NextResponse.json({ error: 'No organization membership. Finish onboarding first.' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const norm = normalizeUserCode(body?.user_code)
  let valid = false
  try { valid = isValidUserCode(norm) } catch {
    return NextResponse.json({ error: 'Server missing KEY_ENCRYPTION_SECRET; device login is unavailable.' }, { status: 501 })
  }
  if (!valid) return NextResponse.json({ error: 'That code isn’t valid. Check it against your terminal and try again.' }, { status: 422 })

  const handle = approvalHandle(norm)
  const admin = createAdminClient()
  const { data: existing } = await admin.from('key_reveals').select('token').eq('token', handle).maybeSingle()
  if (existing) return NextResponse.json({ error: 'This code was already approved. Run `npx tokenfin@latest login --device` again for a new one.' }, { status: 409 })

  // Mint via the browser-login route (per-device ingest + read keys, rotation,
  // audit) — identical keys whichever way the user logs in.
  const label = cleanLabel(body?.device) || 'Device login'
  const did = typeof body?.device_id === 'string' && DEVICE_ID_RE.test(body.device_id) ? body.device_id : ''
  const mintReq = new NextRequest(new URL('/api/v1/cli/token', req.nextUrl.origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: req.headers.get('cookie') ?? '' },
    body: JSON.stringify(did ? { device_label: label, device_id: did } : { label }),
  })
  const minted = await mintCliToken(mintReq)
  const mj = await minted.json().catch(() => ({})) as { token?: string; error?: string; device?: string }
  if (!minted.ok || !mj.token) return NextResponse.json({ error: mj.error ?? 'Could not create keys' }, { status: minted.status || 500 })

  // Park the inner reveal token (sealed) under the handle for /poll.
  const { data: inner } = await admin.from('key_reveals').select('key_id').eq('token', mj.token).maybeSingle()
  if (!inner) return NextResponse.json({ error: 'Could not stage the key' }, { status: 500 })
  const sealed = sealKey(mj.token)
  const { error } = await admin.from('key_reveals').insert({
    token: handle, key_id: inner.key_id, org_id: ctx.orgId, email: ctx.user.email ?? null,
    ciphertext: sealed.ciphertext, iv: sealed.iv, auth_tag: sealed.authTag,
    expires_at: new Date(Date.now() + DEVICE_CODE_TTL_S * 1000).toISOString(),
  })
  if (error) {
    // Lost a race with a concurrent approve of the same code, or DB failure:
    // burn the freshly minted reveal so the keys can never be collected.
    const tokens = [mj.token, mj.token + '.read']
    const { data: staged } = await admin.from('key_reveals').select('key_id').in('token', tokens)
    await admin.from('key_reveals').update({ revealed_at: new Date().toISOString(), ciphertext: null, iv: null, auth_tag: null })
      .in('token', tokens)
    const ids = (staged ?? []).map(r => r.key_id as string)
    if (ids.length) await admin.from('api_keys').update({ is_active: false }).in('id', ids)
    return NextResponse.json({ error: 'This code was already approved.' }, { status: 409 })
  }

  return NextResponse.json({ ok: true, device: mj.device ?? label })
}
