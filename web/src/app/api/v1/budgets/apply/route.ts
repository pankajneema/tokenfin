import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission, resolveOrgFromApiKey, dbError } from '@/lib/api/auth'
import { selectAll } from '@/lib/supabase/paginate'
import { audit } from '@/lib/audit'
import { parseYaml, YamlError } from '@/lib/budgets-as-code/yaml'
import { normalizeBudgets } from '@/lib/budgets-as-code/schema'
import { buildPlan, formatPlan, MANAGED_PREFIX, type CurrentAlert, type CurrentLimit, type Plan } from '@/lib/budgets-as-code/plan'

export const dynamic = 'force-dynamic'

const MAX_BODY = 256 * 1024

/**
 * POST /api/v1/budgets/apply?org_id=…&dry_run=true | &apply=true
 * Budgets as code (tokenfin-budgets.yaml). Body: the YAML file
 * (Content-Type text/yaml or text/plain), or JSON — either the document itself
 * or { "yaml": "…" }. Default is a dry run that returns the diff against the
 * workspace's limits and the limit_breach alert rules the file manages;
 * `apply=true` makes the changes (audited as limit.* / alert.*).
 *
 * Auth: a workspace owner's session, or `Authorization: Bearer <key>` with an
 * API key that has the `admin` scope (for CI).
 */
export async function POST(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const text = await req.text()
  if (text.length > MAX_BODY) return NextResponse.json({ error: 'body too large (max 256 KB)' }, { status: 413 })

  // ── Parse the body ────────────────────────────────────────────────────────
  let doc: unknown
  let bodyOrg: string | null = null
  let bodyApply: boolean | null = null
  try {
    const ct = req.headers.get('content-type') ?? ''
    if (ct.includes('json')) {
      const j = JSON.parse(text || '{}') as Record<string, unknown>
      if (typeof j.org_id === 'string') bodyOrg = j.org_id
      if (typeof j.apply === 'boolean') bodyApply = j.apply
      if (typeof j.dry_run === 'boolean') bodyApply = !j.dry_run
      if (typeof j.yaml === 'string') doc = parseYaml(j.yaml)
      else {
        const rest = { ...j }
        delete rest.org_id; delete rest.apply; delete rest.dry_run
        doc = rest
      }
    } else {
      doc = parseYaml(text)
    }
  } catch (e) {
    const msg = e instanceof YamlError ? e.message : 'invalid JSON body'
    return NextResponse.json({ error: 'parse_error', message: msg }, { status: 422 })
  }

  // ── Auth: owner session, or admin-scoped API key ─────────────────────────
  let orgId = q.get('org_id') ?? bodyOrg
  let actorUserId: string | null = null
  let via = 'session'
  if ((req.headers.get('authorization') ?? '').startsWith('Bearer ')) {
    const key = await resolveOrgFromApiKey(req)
    if (!key) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!key.scopes.includes('admin')) return NextResponse.json({ error: 'Forbidden', reason: 'API key needs the admin scope' }, { status: 403 })
    if (orgId && orgId !== key.orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    orgId = key.orgId
    via = `api_key:${key.keyId}`
  } else {
    const guard = await requirePermission(orgId, 'org:edit')   // owner only
    if (guard instanceof NextResponse) return guard
    actorUserId = guard.userId
  }

  const applyFlag = q.get('apply') === 'true' || (q.get('dry_run') === 'false') || bodyApply === true
  const dryRun = !applyFlag || q.get('dry_run') === 'true'

  // ── Validate ──────────────────────────────────────────────────────────────
  const norm = normalizeBudgets(doc)
  if (!norm.ok) return NextResponse.json({ error: 'invalid_budgets', issues: norm.issues }, { status: 422 })

  const admin = createAdminClient()
  let plan: Plan
  try {
    const [{ data: limits }, { data: alerts }, { data: projects }, { data: teams }] = await Promise.all([
      selectAll<CurrentLimit>(() => admin.from('limits')
        .select('id, scope, project_id, team_id, period, budget_usd, warn_at, throttle_at, block_at, is_active, created_at')
        .eq('org_id', orgId!)),
      selectAll<CurrentAlert>(() => admin.from('alert_rules')
        .select('id, name, project_id, scope, threshold, channels, is_active')
        .eq('org_id', orgId!).eq('trigger_type', 'limit_breach').like('name', `${MANAGED_PREFIX}%`)),
      selectAll<{ id: string; name: string; slug: string | null }>(() => admin.from('projects').select('id, name, slug').eq('org_id', orgId!)),
      selectAll<{ id: string; name: string }>(() => admin.from('teams').select('id, name').eq('org_id', orgId!)),
    ])
    // Oldest limit first so repeated applies always update the same row.
    limits.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    plan = buildPlan(norm.budgets, { limits, alerts }, { projects, teams }, norm.prune)
  } catch (e) {
    return dbError(e, 'POST budgets/apply load')
  }

  if (!plan.ok) return NextResponse.json({ error: 'invalid_budgets', issues: plan.issues, plan, diff: formatPlan(plan) }, { status: 422 })
  if (dryRun) return NextResponse.json({ dry_run: true, applied: false, plan, diff: formatPlan(plan) })

  // ── Apply ─────────────────────────────────────────────────────────────────
  const details = { via: via === 'session' ? 'budgets-as-code' : `budgets-as-code (${via})` }
  const failures: string[] = []
  for (const c of plan.limits) {
    if (c.op === 'create') {
      const { data, error } = await admin.from('limits').insert({ org_id: orgId, metric: 'cost_usd', ...c.after }).select('id').single()
      if (error) { failures.push(`create limit ${c.label}`); console.error('[budgets/apply]', error.message); continue }
      await audit({ orgId: orgId!, actorUserId, action: 'limit.create', targetType: 'limit', targetId: data.id, details: { ...details, ...c.after } })
    } else if (c.op === 'update') {
      const { error } = await admin.from('limits').update(c.after).eq('id', c.id).eq('org_id', orgId!)
      if (error) { failures.push(`update limit ${c.label}`); console.error('[budgets/apply]', error.message); continue }
      await audit({ orgId: orgId!, actorUserId, action: 'limit.update', targetType: 'limit', targetId: c.id, details: { ...details, before: c.before, after: c.after } })
    } else if (c.op === 'delete') {
      const { error } = await admin.from('limits').delete().eq('id', c.id).eq('org_id', orgId!)
      if (error) { failures.push(`delete limit ${c.label}`); console.error('[budgets/apply]', error.message); continue }
      await audit({ orgId: orgId!, actorUserId, action: 'limit.delete', targetType: 'limit', targetId: c.id, details: { ...details, before: c.before } })
    }
  }
  for (const c of plan.alerts) {
    if (c.op === 'create') {
      const { data, error } = await admin.from('alert_rules').insert({ org_id: orgId, ...c.after }).select('id').single()
      if (error) { failures.push(`create alert ${c.name}`); console.error('[budgets/apply]', error.message); continue }
      await audit({ orgId: orgId!, actorUserId, action: 'alert.create', targetType: 'alert_rule', targetId: data.id, details: { ...details, name: c.name } })
    } else if (c.op === 'update') {
      const { error } = await admin.from('alert_rules').update(c.after).eq('id', c.id).eq('org_id', orgId!)
      if (error) { failures.push(`update alert ${c.name}`); console.error('[budgets/apply]', error.message); continue }
      await audit({ orgId: orgId!, actorUserId, action: 'alert.update', targetType: 'alert_rule', targetId: c.id, details: { ...details, after: c.after } })
    } else if (c.op === 'delete') {
      const { error } = await admin.from('alert_rules').delete().eq('id', c.id).eq('org_id', orgId!)
      if (error) { failures.push(`delete alert ${c.name}`); console.error('[budgets/apply]', error.message); continue }
      await audit({ orgId: orgId!, actorUserId, action: 'alert.delete', targetType: 'alert_rule', targetId: c.id, details: { ...details, name: c.name } })
    }
  }

  const status = failures.length ? 500 : 200
  return NextResponse.json({ dry_run: false, applied: failures.length === 0, failures, plan, diff: formatPlan(plan) }, { status })
}
