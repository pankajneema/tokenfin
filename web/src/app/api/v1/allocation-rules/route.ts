import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgMember, requirePermission, requireResourcePermission, dbError } from '@/lib/api/auth'
import { audit } from '@/lib/audit'
import { normalizeRule, MATCH_KEYS } from '@/lib/allocation/apply'
import { loadRuleRows } from '@/lib/allocation/load'

/**
 * /api/v1/allocation-rules — Settings → Allocation.
 *   GET    ?org_id=…            any member (read-only)
 *   POST   { org_id, … }        owner/admin
 *   PATCH  { id, … }            owner/admin
 *   DELETE ?id=…                owner/admin
 * Rule shape and semantics: lib/allocation/apply.ts.
 */

const MAX_RULES = 200

const matchSchema = z.record(z.enum(MATCH_KEYS), z.string().max(200).nullable())
const assignSchema = z.object({
  team:        z.string().max(120).optional().nullable(),
  cost_center: z.string().max(120).optional().nullable(),
  among:       z.array(z.string().max(120)).max(100).optional(),
}).strict()

const fields = {
  name:      z.string().max(120).optional(),
  kind:      z.enum(['assign', 'shared_split']).optional(),
  priority:  z.number().int().min(0).max(100_000).optional(),
  match:     matchSchema.optional(),
  assign:    assignSchema.optional(),
  is_active: z.boolean().optional(),
}

// Audit actions for allocation rules (text column; see Needs-from-others note to add them to the union).

function clean(input: { name?: string; kind?: string; priority?: number; match?: Record<string, unknown>; assign?: Record<string, unknown>; is_active?: boolean }) {
  const n = normalizeRule(input)
  if (typeof n === 'string') return n
  const assign: Record<string, unknown> = {}
  if (n.assign.team) assign.team = n.assign.team
  if (n.assign.cost_center) assign.cost_center = n.assign.cost_center
  if (n.kind === 'shared_split' && n.assign.among) assign.among = n.assign.among
  return { name: n.name ?? '', kind: n.kind, priority: n.priority, match: n.match, assign, is_active: n.is_active !== false }
}

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const guard = await requireOrgMember(orgId)
  if (guard instanceof NextResponse) return guard
  return NextResponse.json(await loadRuleRows(createAdminClient(), orgId!))
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = z.object({ org_id: z.string().uuid(), ...fields }).safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  const guard = await requirePermission(parsed.data.org_id, 'teams:manage')
  if (guard instanceof NextResponse) return guard

  const rule = clean(parsed.data as Parameters<typeof clean>[0])
  if (typeof rule === 'string') return NextResponse.json({ error: rule }, { status: 422 })

  const admin = createAdminClient()
  if (rule.match.project_id) {
    const { data } = await admin.from('projects').select('id').eq('id', rule.match.project_id).eq('org_id', parsed.data.org_id).maybeSingle()
    if (!data) return NextResponse.json({ error: 'match.project_id does not belong to this org' }, { status: 422 })
  }
  const { count } = await admin.from('allocation_rules').select('id', { count: 'exact', head: true }).eq('org_id', parsed.data.org_id)
  if ((count ?? 0) >= MAX_RULES) return NextResponse.json({ error: `at most ${MAX_RULES} rules` }, { status: 422 })

  const { data, error } = await admin.from('allocation_rules')
    .insert({ ...rule, org_id: parsed.data.org_id, created_by: guard.userId }).select().single()
  if (error) return dbError(error, 'POST allocation-rules')
  await audit({ orgId: parsed.data.org_id, actorUserId: guard.userId, action: 'allocation.create', targetType: 'allocation_rule', targetId: data.id, details: rule })
  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = z.object({ id: z.string().uuid(), ...fields }).safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  const guard = await requireResourcePermission('allocation_rules', parsed.data.id, 'teams:manage')
  if (guard instanceof NextResponse) return guard

  const admin = createAdminClient()
  const { data: cur } = await admin.from('allocation_rules').select('name, kind, priority, match, assign, is_active').eq('id', parsed.data.id).single()
  const { id, ...patch } = parsed.data
  const merged = clean({ ...((cur ?? {}) as Parameters<typeof clean>[0]), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) })
  if (typeof merged === 'string') return NextResponse.json({ error: merged }, { status: 422 })
  if (merged.match.project_id) {
    const { data } = await admin.from('projects').select('id').eq('id', merged.match.project_id).eq('org_id', guard.orgId).maybeSingle()
    if (!data) return NextResponse.json({ error: 'match.project_id does not belong to this org' }, { status: 422 })
  }

  const { data, error } = await admin.from('allocation_rules')
    .update({ ...merged, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) return dbError(error, 'PATCH allocation-rules')
  await audit({ orgId: guard.orgId, actorUserId: guard.userId, action: 'allocation.update', targetType: 'allocation_rule', targetId: id, details: merged })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  const guard = await requireResourcePermission('allocation_rules', id, 'teams:manage')
  if (guard instanceof NextResponse) return guard
  const { error } = await createAdminClient().from('allocation_rules').delete().eq('id', id!)
  if (error) return dbError(error, 'DELETE allocation-rules')
  await audit({ orgId: guard.orgId, actorUserId: guard.userId, action: 'allocation.delete', targetType: 'allocation_rule', targetId: id })
  return NextResponse.json({ ok: true })
}
