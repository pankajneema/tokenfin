/**
 * /api/v1/agent-configs/changes — pull-based config change requests.
 *
 * Nothing here touches a machine. A request is stored as `pending`; the CLI on
 * that machine fetches it (`tokenfin config pull`), shows the diff, asks, backs
 * up, applies, and reports back.
 *
 * GET    Bearer device key, ?device_id=  → {changes:[pending…]} for that device
 * POST   Session {org_id, device_ref, agent, patch, reason?} → 201 {change}
 *        Patch validated against the allow-list (lib/agent-configs/allowlist).
 *        Owners/admins: any device; members: their own; viewers: none.
 * PATCH  Bearer device key {id, status:'applied'|'failed', error?}  (CLI)
 *        Session {org_id, id, status:'cancelled'} (requester or owner/admin)
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgMemberWithRole, dbError, bearerFrom } from '@/lib/api/auth'
import { audit } from '@/lib/audit'
import { can } from '@/lib/rbac'
import { isAgentId, DEVICE_ID_RE } from '@/lib/agent-configs/agents'
import { validatePatch } from '@/lib/agent-configs/allowlist'
import { deviceCaller, callerDevice, getDevice, canAccessDevice } from '@/lib/agent-configs/server'

const unauthorized = () => NextResponse.json({ error: 'Invalid or missing API key' }, {
  status: 401, headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
})
const COLS = 'id, device_ref, agent, patch, reason, requested_by_email, status, error, created_at, updated_at, applied_at'

export async function GET(req: NextRequest) {
  const caller = await deviceCaller(req)
  if (caller === 'none' || caller === 'invalid') return unauthorized()
  const deviceId = req.nextUrl.searchParams.get('device_id') ?? caller.keyDevice ?? ''
  if (!DEVICE_ID_RE.test(deviceId)) return NextResponse.json({ error: 'device_id required' }, { status: 400 })
  if (caller.keyDevice && caller.keyDevice !== deviceId) return NextResponse.json({ error: 'this key belongs to a different device' }, { status: 403 })
  const dev = await callerDevice(caller, deviceId)
  if (!dev) return NextResponse.json({ changes: [] })
  const { data, error } = await createAdminClient().from('agent_config_changes').select(COLS)
    .eq('device_ref', dev.id).eq('status', 'pending').order('created_at', { ascending: true }).limit(50)
  if (error) return dbError(error, 'GET agent-config changes')
  return NextResponse.json({ changes: data ?? [] })
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const orgId = typeof body.org_id === 'string' ? body.org_id : null
  const guard = await requireOrgMemberWithRole(orgId)
  if (guard instanceof NextResponse) return guard

  const dev = await getDevice(orgId!, String(body.device_ref ?? ''))
  if (!dev || !canAccessDevice(dev, guard.role, guard.userId)) return NextResponse.json({ error: 'Device not found' }, { status: 404 })
  if (!canAccessDevice(dev, guard.role, guard.userId, true)) return NextResponse.json({ error: 'Forbidden', reason: 'viewers cannot request config changes' }, { status: 403 })
  if (!isAgentId(body.agent)) return NextResponse.json({ error: 'unknown agent' }, { status: 422 })
  const check = validatePatch(body.agent, body.patch)
  if (!check.ok) return NextResponse.json({ error: 'patch rejected', details: check.errors }, { status: 422 })
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null

  const admin = createAdminClient()
  const { data: agentRow } = await admin.from('agent_configs').select('agent').eq('device_ref', dev.id).eq('agent', body.agent).maybeSingle()
  if (!agentRow) return NextResponse.json({ error: 'that agent has not been synced from this device' }, { status: 422 })

  const { data: u } = await admin.auth.admin.getUserById(guard.userId)
  const { data, error } = await admin.from('agent_config_changes').insert({
    org_id: orgId, device_ref: dev.id, agent: body.agent, patch: body.patch, reason,
    requested_by: guard.userId, requested_by_email: u?.user?.email ?? null, status: 'pending',
  }).select(COLS).single()
  if (error) return dbError(error, 'POST agent-config change')

  await audit({
    orgId: orgId!, actorUserId: guard.userId, action: 'agent_config.request', targetType: 'agent_device', targetId: dev.id,
    details: { agent: body.agent, fields: check.fields.map(f => f.path), hostname: dev.hostname, device_owner: dev.user_id, reason },
  })
  return NextResponse.json({ change: data }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const id = typeof body.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const admin = createAdminClient()

  // ── CLI: report the outcome of applying a change ──
  if (bearerFrom(req)) {
    const caller = await deviceCaller(req)
    if (caller === 'none' || caller === 'invalid') return unauthorized()
    const status = body.status
    if (status !== 'applied' && status !== 'failed') return NextResponse.json({ error: 'status must be applied or failed' }, { status: 422 })
    const { data: ch } = await admin.from('agent_config_changes').select('id, org_id, device_ref, agent, status').eq('id', id).eq('org_id', caller.orgId).maybeSingle()
    if (!ch) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { data: dev } = await admin.from('agent_devices').select('id, user_id, device_id, hostname').eq('id', ch.device_ref as string).maybeSingle()
    const owns = dev && (dev.user_id ?? null) === caller.userId && (!caller.keyDevice || caller.keyDevice === dev.device_id)
    if (!owns) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (ch.status !== 'pending') return NextResponse.json({ error: `change is already ${ch.status}` }, { status: 409 })
    const err = status === 'failed' ? String(body.error ?? 'failed').slice(0, 1000) : null
    const now = new Date().toISOString()
    const { data, error } = await admin.from('agent_config_changes')
      .update({ status, error: err, updated_at: now, applied_at: status === 'applied' ? now : null })
      .eq('id', id).eq('status', 'pending').select(COLS).maybeSingle()
    if (error) return dbError(error, 'PATCH agent-config change')
    if (!data) return NextResponse.json({ error: 'change is no longer pending' }, { status: 409 })
    await audit({
      orgId: caller.orgId, actorUserId: caller.userId, action: status === 'applied' ? 'agent_config.apply' : 'agent_config.fail',
      targetType: 'agent_device', targetId: ch.device_ref as string,
      details: { change_id: id, agent: ch.agent, hostname: dev!.hostname, ...(err ? { error: err } : {}) },
    })
    return NextResponse.json({ change: data })
  }

  // ── Dashboard: cancel a pending request ──
  const orgId = typeof body.org_id === 'string' ? body.org_id : null
  const guard = await requireOrgMemberWithRole(orgId)
  if (guard instanceof NextResponse) return guard
  if (body.status !== 'cancelled') return NextResponse.json({ error: 'status must be cancelled' }, { status: 422 })
  const { data: ch } = await admin.from('agent_config_changes').select('id, device_ref, agent, status, requested_by').eq('id', id).eq('org_id', orgId!).maybeSingle()
  if (!ch) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const dev = await getDevice(orgId!, ch.device_ref as string)
  if (!dev || !canAccessDevice(dev, guard.role, guard.userId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (ch.requested_by !== guard.userId && !can(guard.role, 'prompts:view_all')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (ch.status !== 'pending') return NextResponse.json({ error: `change is already ${ch.status}` }, { status: 409 })
  const { data, error } = await admin.from('agent_config_changes')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending').select(COLS).maybeSingle()
  if (error) return dbError(error, 'cancel agent-config change')
  await audit({ orgId: orgId!, actorUserId: guard.userId, action: 'agent_config.cancel', targetType: 'agent_device', targetId: dev.id, details: { change_id: id, agent: ch.agent, hostname: dev.hostname } })
  return NextResponse.json({ change: data })
}
