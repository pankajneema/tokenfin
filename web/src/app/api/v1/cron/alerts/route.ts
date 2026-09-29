import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { buildOrgCtx, evaluateRule, deliverAlert, inCooldown, claimFire, type AlertRule } from '@/lib/alerts/engine'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/v1/cron/alerts — evaluate every active alert rule and deliver the ones
 * that fired (respecting per-rule cooldown). Intended to run on a schedule
 * (Vercel Cron). Protected by CRON_SECRET: Vercel injects
 * `Authorization: Bearer $CRON_SECRET` on scheduled invocations.
 */
export async function GET(req: NextRequest) {
  // Fail closed: no CRON_SECRET configured → nobody may trigger the sweep.
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const auth     = req.headers.get('authorization') || ''
  const expected = Buffer.from(`Bearer ${secret}`)
  const given    = Buffer.from(auth)
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Optional scope to one org — for targeted runs / safe testing.
  const orgFilter = req.nextUrl.searchParams.get('org')

  let q = admin
    .from('alert_rules')
    .select('id, org_id, project_id, name, trigger_type, condition, threshold, channels, is_active, fired_count, last_fired_at, cooldown_hours')
    .eq('is_active', true)
  if (orgFilter) q = q.eq('org_id', orgFilter)
  const { data: rules } = await q
  const active = (rules ?? []) as AlertRule[]
  if (active.length === 0) return NextResponse.json({ evaluated: 0, fired: 0 })

  // Resolve emails once (shared across orgs).
  const emailByUser = new Map<string, string>()
  try {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
    for (const u of list?.users ?? []) if (u.email) emailByUser.set(u.id, u.email)
  } catch {}

  // Group by org so we fetch each org's data once.
  const byOrg = new Map<string, AlertRule[]>()
  for (const r of active) { if (!byOrg.has(r.org_id)) byOrg.set(r.org_id, []); byOrg.get(r.org_id)!.push(r) }

  let evaluated = 0, fired = 0
  for (const [orgId, orgRules] of Array.from(byOrg.entries())) {
    let ctx
    try { ctx = await buildOrgCtx(admin, orgId, emailByUser) } catch { continue }
    for (const rule of orgRules) {
      evaluated++
      if (inCooldown(rule)) continue
      let message: string | null = null
      try { message = evaluateRule(rule, ctx) } catch { message = null }
      if (!message) continue
      // Atomically claim this firing window so overlapping cron runs can't double-deliver.
      let claimed = false
      try { claimed = await claimFire(admin, rule) } catch { claimed = false }
      if (!claimed) continue
      try { await deliverAlert(admin, rule, ctx, message, { claimed: true }) ; fired++ } catch {}
    }
  }

  return NextResponse.json({ evaluated, fired })
}
