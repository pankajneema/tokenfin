import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  newUserCode, formatUserCode, signDeviceCode, cleanLabel, DEVICE_ID_RE,
  DEVICE_CODE_TTL_S, POLL_INTERVAL_S,
} from '../_codes'

/**
 * POST /api/v1/cli/device/start  { label?, device_id? }   (no auth)
 *
 * Begins a device-code login for `npx tokenfin@latest login --device`.
 * Returns an RFC 8628-shaped response. Nothing is stored — see ../_codes.ts.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const label = cleanLabel(body?.label) || null
  const rawDid = typeof body?.device_id === 'string' ? body.device_id.trim() : ''
  const did = rawDid && DEVICE_ID_RE.test(rawDid) ? rawDid : null

  let userCode: string, deviceCode: string
  try {
    userCode = newUserCode()
    deviceCode = signDeviceCode({ uc: userCode, exp: Date.now() + DEVICE_CODE_TTL_S * 1000, did, lbl: label })
  } catch {
    return NextResponse.json({ error: 'Server missing KEY_ENCRYPTION_SECRET; device login is unavailable.' }, { status: 501 })
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, '')
  const display = formatUserCode(userCode)
  const qs = new URLSearchParams({ code: display })
  if (label) qs.set('device', label)
  if (did) qs.set('device_id', did)

  return NextResponse.json({
    device_code: deviceCode,
    user_code: display,
    verification_uri: appUrl + '/cli/device',
    verification_uri_complete: appUrl + '/cli/device?' + qs.toString(),
    expires_in: DEVICE_CODE_TTL_S,
    interval: POLL_INTERVAL_S,
  })
}
