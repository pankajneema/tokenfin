import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/api/auth'
import { buildOrgCtx, deliverAlert, type AlertRule } from '@/lib/alerts/engine'

/**
 * POST /api/v1/alerts/test  { id }
 * Fires a rule's delivery immediately with a test message (ignores the trigger
 * condition and cooldown) so users can confirm their channels work. Admin-gated.
 */
export async function POST(req: NextRequest) {
  const { id } = await req.json().catch(() => ({ id: '' }))
  if (!id || typeof id !== 'string') return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: rule } = await admin
    .from('alert_rules')
    .select('id, org_id, project_id, name, trigger_type, condition, threshold, channels, is_active, fired_count, last_fired_at, cooldown_hours')
    .eq('id', id).maybeSingle()
  if (!rule) return NextResponse.json({ error: 'rule not found' }, { status: 404 })

  const guard = await requirePermission(rule.org_id, 'alerts:write')
  if (guard instanceof NextResponse) return guard

  const emailByUser = new Map<string, string>()
  try {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
    for (const u of list?.users ?? []) if (u.email) emailByUser.set(u.id, u.email)
  } catch {}

  const ctx = await buildOrgCtx(admin, rule.org_id, emailByUser)
  const message = `This is a test of your "${rule.name}" alert. If you received it, this channel is working.`
  const results = await deliverAlert(admin, rule as AlertRule, ctx, message, { test: true })

  return NextResponse.json({ ok: true, delivered: results })
}
