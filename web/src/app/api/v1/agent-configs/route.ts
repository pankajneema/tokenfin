/**
 * /api/v1/agent-configs — coding-agent config snapshots (docs/AGENTS_CONFIG.md).
 *
 * POST  Bearer device key (ingest or read) — `tokenfin config push`.
 *       Body {device_id, hostname, os, cli_version, agents:[{agent, version,
 *       path, mtime, config, sha256}]}. Configs are redacted on the machine and
 *       again here. A key minted for a device may only push as that device.
 *       → {device_ref, pending}
 * GET   Session (?org_id=) or read key — people → devices → agents, scoped by
 *       role (members / viewers: their own devices only).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireApiKeyOrOrgMember, dbError } from '@/lib/api/auth'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { getOrgTimezone } from '@/lib/org-timezone'
import { zonedMidnightIso } from '@/app/api/v1/me/_window'
import { createAdminClient } from '@/lib/supabase/server'
import { deviceCaller, parsePushBody, pushSnapshot, loadAgentsView } from '@/lib/agent-configs/server'

const unauthorized = () => NextResponse.json({ error: 'Invalid or missing API key' }, {
  status: 401, headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
})

export async function POST(req: NextRequest) {
  const caller = await deviceCaller(req)
  if (caller === 'none' || caller === 'invalid') return unauthorized()
  const rl = await rateLimit(caller.keyId)
  if (!rl.allowed) return rateLimitResponse(rl)

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const parsed = parsePushBody(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 })
  if (caller.keyDevice && caller.keyDevice !== parsed.value.device_id) {
    return NextResponse.json({ error: 'this key belongs to a different device' }, { status: 403 })
  }
  try {
    const r = await pushSnapshot(caller, parsed.value)
    return NextResponse.json({ ok: true, device_ref: r.device_ref, pending: r.pending, agents: parsed.value.agents.length })
  } catch (e) {
    return dbError(e, 'POST agent-configs')
  }
}

export async function GET(req: NextRequest) {
  const guard = await requireApiKeyOrOrgMember(req, req.nextUrl.searchParams.get('org_id'))
  if (guard instanceof NextResponse) return guard
  if (!guard.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const tz = await getOrgTimezone(guard.orgId)
  const { data: org } = await createAdminClient().from('organizations').select('capture_prompts').eq('id', guard.orgId).maybeSingle()
  try {
    const people = await loadAgentsView(guard.orgId, { userId: guard.userId, role: guard.role }, {
      appUrl: process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin,
      capturePrompts: (org as { capture_prompts?: boolean | null } | null)?.capture_prompts !== false,
    }, zonedMidnightIso(Date.now(), tz))
    return NextResponse.json({ people })
  } catch (e) {
    return dbError(e, 'GET agent-configs')
  }
}
