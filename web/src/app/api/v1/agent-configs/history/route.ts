/**
 * GET /api/v1/agent-configs/history?org_id=&device_ref=&agent=
 * The last 10 distinct snapshots of one agent on one device (newest first),
 * for the History tab. Session only; members see only their own devices.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireOrgMemberWithRole } from '@/lib/api/auth'
import { isAgentId } from '@/lib/agent-configs/agents'
import { getDevice, canAccessDevice, loadHistory } from '@/lib/agent-configs/server'

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const orgId = p.get('org_id')
  const guard = await requireOrgMemberWithRole(orgId)
  if (guard instanceof NextResponse) return guard
  const agent = p.get('agent')
  if (!isAgentId(agent)) return NextResponse.json({ error: 'unknown agent' }, { status: 422 })
  const dev = await getDevice(orgId!, p.get('device_ref') ?? '')
  if (!dev || !canAccessDevice(dev, guard.role, guard.userId)) return NextResponse.json({ error: 'Device not found' }, { status: 404 })
  return NextResponse.json({ history: await loadHistory(dev.id, agent) })
}
