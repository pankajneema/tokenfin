import { createAdminClient }  from '@/lib/supabase/server'
import { requireOrgContext }  from '@/lib/org-context'
import { dashSummary, dashBreakdown, NO_PROJECT_ID } from '@/lib/rollups'
import { resolveWindow } from '@/lib/rollup-scope'
import { ProjectsClient }     from './_client'
import type { ProjectRow }    from './_client'

export const metadata = { title: 'By Project — TokenFin Analytics' }
export const dynamic = 'force-dynamic'
export const revalidate = 0

const PROJ_COLORS = ['#D97757','#4285F4','#8B5CF6','#20B2AA','#F59E0B','#6B7280']
const TEAM_COLORS = ['#8B5CF6','#20B2AA','#F59E0B','#D97757','#4285F4','#6B7280']

export default async function ProjectsAnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx   = await requireOrgContext()
  const admin = createAdminClient()
  const orgId = ctx.orgId
  const win   = resolveWindow(await searchParams, ctx.timezone, { defaultDays: 30, allowed: [7, 30, 90] })

  const [cur, prev, { data: projects }, { data: limits }, { data: teams }, { data: allMembers }, { data: allKeys }, { data: authData }] = await Promise.all([
    dashBreakdown(admin, orgId, win.from, win.to, 'project', undefined, 50),   // top 50 by cost
    dashBreakdown(admin, orgId, win.prevFrom, win.prevTo, 'project', undefined, 200),
    admin.from('projects').select('id,name,slug').eq('org_id', orgId),
    admin.from('limits').select('project_id,value').eq('org_id', orgId).eq('metric', 'cost'),
    admin.from('teams').select('id,name').eq('org_id', orgId),
    admin.from('members').select('user_id,team_id').eq('org_id', orgId),
    admin.from('api_keys').select('project_id,created_by').eq('org_id', orgId).eq('is_active', true),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ])

  // Per project: prompts, models and the people who used it (all from the rollups).
  const perProject = await Promise.all(cur.rows.map(r => Promise.all([
    dashSummary(admin, orgId, win.from, win.to, { project_id: r.key }),
    dashBreakdown(admin, orgId, win.from, win.to, 'model', { project_id: r.key }, 20),
    dashBreakdown(admin, orgId, win.from, win.to, 'member', { project_id: r.key }, 200),
  ])))

  const projNames = new Map((projects ?? []).map(p => [p.id as string, p.name as string]))
  const budgetMap = new Map((limits ?? []).map(l => [l.project_id as string, l.value]))
  const prevMap   = new Map(prev.rows.map(r => [r.key, r]))

  /* ── Team attribution: people → team (members.team_id) ── */
  const teamMeta = new Map((teams ?? []).map((t, i) => [t.id as string, { name: t.name as string, color: TEAM_COLORS[i % TEAM_COLORS.length] }]))
  const userTeam = new Map<string, string>()
  for (const m of allMembers ?? []) if (m.user_id && m.team_id) userTeam.set(m.user_id as string, m.team_id as string)
  // rollup user_key = lower(email) or user id → user id
  const emailToUid = new Map<string, string>()
  for (const u of authData?.users ?? []) if (u.email && userTeam.has(u.id)) emailToUid.set(u.email.toLowerCase(), u.id)
  const teamOfKey = (k: string) => userTeam.get(k) ?? userTeam.get(emailToUid.get(k) ?? '')

  const projTeamCount = new Map<string, Map<string, number>>()
  const bump = (pid: string, tid: string | undefined, n: number) => {
    if (!tid) return
    const inner = projTeamCount.get(pid) ?? new Map<string, number>()
    inner.set(tid, (inner.get(tid) ?? 0) + n)
    projTeamCount.set(pid, inner)
  }
  for (const k of allKeys ?? []) if (k.project_id && k.created_by) bump(k.project_id as string, userTeam.get(k.created_by as string), 1)
  cur.rows.forEach((r, i) => { for (const m of perProject[i][2].rows) bump(r.key, teamOfKey(m.key), m.requests) })

  const projTeam = new Map<string, { name: string; color: string }>()
  for (const [pid, counts] of Array.from(projTeamCount.entries())) {
    const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]
    if (top && teamMeta.has(top[0])) projTeam.set(pid, teamMeta.get(top[0])!)
  }

  const totalCost = cur.rows.reduce((s, r) => s + r.cost_usd, 0)

  const projectRows: ProjectRow[] = cur.rows.map((r, i) => {
    const p      = prevMap.get(r.key)
    const budget = budgetMap.get(r.key)
    const team   = projTeam.get(r.key)
    const [summary, models] = perProject[i]
    return {
      id:         r.key,
      name:       r.key === NO_PROJECT_ID ? 'Uncategorized' : projNames.get(r.key) ?? r.key.slice(0, 8),
      team:       team?.name  ?? '—',
      teamColor:  team?.color ?? '#6B7280',
      color:      PROJ_COLORS[i % PROJ_COLORS.length],
      cost30d:    r.cost_usd,
      metered:    r.metered_cost_usd,
      notional:   r.notional_cost_usd,
      costPrev:   p?.cost_usd ?? 0,
      tokens30d:  r.total_tokens / 1_000_000,
      calls30d:   r.requests,
      prompts30d: summary.prompts,
      callsPrev:  p?.requests ?? 0,
      models:     models.rows.map(m => m.key).filter(Boolean),
      budget:     budget ? Number(budget) : undefined,
      pctOfTotal: totalCost > 0 ? +(r.cost_usd / totalCost * 100).toFixed(1) : 0,
    }
  })

  return <ProjectsClient projects={projectRows} days={win.days} windowLabel={win.label} />
}
