import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { recordDeliveryResults } from '@/lib/integrations/delivery'
import { runOrgLimits } from '@/lib/alerts/limits-runner'
import { buildOrgCtx, evaluateRuleDetailed, deliverAlert, inCooldown, claimFire, type AlertRule, type Evaluation } from '@/lib/alerts/engine'
import crypto from 'crypto'
import { withJobRun } from '@/lib/jobs'
import { log } from '@/lib/log'

const ROUTE = '/api/v1/cron/alerts'

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

  return withJobRun('alerts', async () => {
    const admin = createAdminClient()

    // Optional scope to one org — for targeted runs / safe testing.
    const orgFilter = req.nextUrl.searchParams.get('org')

    const COLS = 'id, org_id, project_id, name, trigger_type, condition, threshold, channels, is_active, fired_count, last_fired_at, cooldown_hours'
    const load = (cols: string) => {
      let q = admin.from('alert_rules').select(cols).eq('is_active', true)
      if (orgFilter) q = q.eq('org_id', orgFilter)
      return q
    }
    // anomaly_scope arrives with migration 009; fall back so a not-yet-migrated
    // DB keeps evaluating every rule (anomaly rules then default to org scope).
    let { data: rules, error } = await load(COLS + ', anomaly_scope')
    if (error) ({ data: rules } = await load(COLS))
    const active = (rules ?? []) as unknown as AlertRule[]
    const limits = await sweepLimits(admin, orgFilter)
    if (active.length === 0) return NextResponse.json({ evaluated: 0, fired: 0, limits })

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
        let hit: Evaluation | null = null
        try { hit = evaluateRuleDetailed(rule, ctx) } catch { hit = null }
        if (!hit) continue
        // Atomically claim this firing window so overlapping cron runs can't double-deliver.
        let claimed = false
        try { claimed = await claimFire(admin, rule) } catch { claimed = false }
        if (!claimed) continue
        try {
          const results = await deliverAlert(admin, rule, ctx, hit.message, { claimed: true, critical: hit.critical })
          fired++
          // Show the real outcome (OK / failed: reason) on the Integrations page.
          if (results) await recordDeliveryResults(admin, rule.org_id, results as Record<string, unknown>)
        } catch (e) {
          log.error('alert delivery failed', { route: ROUTE, org_id: rule.org_id, rule_id: rule.id, err: e })
        }
      }
    }

    return NextResponse.json({ evaluated, fired, limits })
  }, { route: ROUTE })
}

/**
 * Limits with a notify threshold or an automatic action (migration 024):
 * once-per-period notifications, model switches and SDK blocks. One org's
 * failure never stops the others.
 */
async function sweepLimits(admin: ReturnType<typeof createAdminClient>, orgFilter: string | null) {
  let q = admin.from('limits').select('org_id').eq('is_active', true)
  if (orgFilter) q = q.eq('org_id', orgFilter)
  const { data } = await q
  const orgs = Array.from(new Set(((data ?? []) as { org_id: string }[]).map(r => r.org_id)))
  const total = { orgs: orgs.length, limits: 0, notified: 0, actions: 0, errors: 0 }
  for (const orgId of orgs) {
    try {
      const r = await runOrgLimits(admin, orgId, { source: 'cron' })
      total.limits += r.limits; total.notified += r.notified; total.actions += r.actions
    } catch (e) {
      total.errors++
      log.error('limit sweep failed', { route: ROUTE, org_id: orgId, err: e })
    }
  }
  return total
}
