import { createClient }       from '@/lib/supabase/server'
import { createAdminClient }  from '@/lib/supabase/server'
import { ProjectsClient }     from './_client'
import type { ProjectRow }    from './_client'

export const metadata = { title: 'By Project — TokenFin Analytics' }

const PROJ_COLORS = ['#D97757','#4285F4','#8B5CF6','#20B2AA','#F59E0B','#6B7280']
const TEAM_COLORS = ['#8B5CF6','#20B2AA','#F59E0B','#D97757','#4285F4','#6B7280']

export default async function ProjectsAnalyticsPage() {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: _mb } = await admin
    .from('members').select('org_id').eq('user_id', user.id).limit(1)
  const orgId = _mb?.[0]?.org_id ?? ''

  const since30date = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
  const since60date = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10)
  const since30ts   = new Date(Date.now() - 30 * 86400_000).toISOString()
  const since60ts   = new Date(Date.now() - 60 * 86400_000).toISOString()

  const [
    { data: curr     },
    { data: prev     },
    { data: evts     },
    { data: evtsPrev },
    { data: projects },
    { data: limits   },
    { data: teams    },
    { data: allMembers },
    { data: allKeys  },
  ] = await Promise.all([
    admin.from('usage_agg')
      .select('project_id,model,total_tokens,cost_usd,request_count')
      .eq('org_id', orgId).gte('bucket', since30date),
    admin.from('usage_agg')
      .select('project_id,cost_usd,request_count')
      .eq('org_id', orgId).gte('bucket', since60date).lt('bucket', since30date),
    admin.from('usage_events')
      .select('project_id,model,cost_usd,total_tokens,user_id')
      .eq('org_id', orgId).gte('created_at', since30ts),
    admin.from('usage_events')
      .select('project_id,cost_usd')
      .eq('org_id', orgId).gte('created_at', since60ts).lt('created_at', since30ts),
    admin.from('projects').select('id,name,slug').eq('org_id', orgId),
    admin.from('limits').select('project_id,value').eq('org_id', orgId).eq('metric', 'cost'),
    admin.from('teams').select('id,name').eq('org_id', orgId),
    // members with team_id — links users to teams (existing schema, no migration needed)
    admin.from('members').select('user_id,team_id').eq('org_id', orgId),
    // api_keys with created_by + project_id — lets us attribute project → team
    admin.from('api_keys')
      .select('project_id,created_by')
      .eq('org_id', orgId)
      .eq('is_active', true),
  ])

  // If usage_agg has no data, fall back to usage_events
  const aggHasCost = (curr ?? []).some(r => Number(r.cost_usd ?? 0) > 0)
  const currSource = aggHasCost ? (curr ?? []) : (evts ?? [])
  const prevSource = aggHasCost ? (prev ?? []) : (evtsPrev ?? [])

  const projNames = new Map((projects ?? []).map(p => [p.id, p.name]))
  const budgetMap = new Map((limits   ?? []).map(l => [l.project_id, l.value]))

  /* ── Team lookup maps ── */
  // team id → { name, color }
  const teamMeta = new Map((teams ?? []).map((t, i) => [
    t.id,
    { name: t.name, color: TEAM_COLORS[i % TEAM_COLORS.length] },
  ]))

  // user_id → team_id  (from members table — existing schema)
  const userTeamMap = new Map<string, string>()
  for (const m of allMembers ?? []) {
    const uid = (m as Record<string,unknown>).user_id as string | null
    const tid = (m as Record<string,unknown>).team_id as string | null
    if (uid && tid) userTeamMap.set(uid, tid)
  }

  /* ── Infer project → team via api_keys.created_by → members.team_id ── */
  // Count how many active keys each team has per project → pick the dominant team
  const projTeamCount = new Map<string, Map<string, number>>()
  for (const k of allKeys ?? []) {
    const pid     = (k as Record<string,unknown>).project_id  as string | null
    const creator = (k as Record<string,unknown>).created_by  as string | null
    if (!pid || !creator) continue
    const tid = userTeamMap.get(creator)
    if (!tid) continue
    if (!projTeamCount.has(pid)) projTeamCount.set(pid, new Map())
    const inner = projTeamCount.get(pid)!
    inner.set(tid, (inner.get(tid) ?? 0) + 1)
  }

  // Also attribute via usage_events.user_id (covers ingest from users without keys)
  if (!aggHasCost) {
    // Only do event-level attribution when falling back to events
    for (const e of evts ?? []) {
      const pid = e.project_id
      const uid = (e as Record<string,unknown>).user_id as string | null
      if (!pid || !uid) continue
      const tid = userTeamMap.get(uid)
      if (!tid) continue
      if (!projTeamCount.has(pid)) projTeamCount.set(pid, new Map())
      const inner = projTeamCount.get(pid)!
      inner.set(tid, (inner.get(tid) ?? 0) + 1)
    }
  }

  // For each project, pick the team with the most keys
  const projTeamMap = new Map<string, { name: string; color: string }>()
  for (const [pid, teamCounts] of Array.from(projTeamCount.entries())) {
    let topTeamId = '', topCount = 0
    for (const [tid, count] of Array.from(teamCounts.entries())) {
      if (count > topCount) { topTeamId = tid; topCount = count }
    }
    if (topTeamId && teamMeta.has(topTeamId)) {
      projTeamMap.set(pid, teamMeta.get(topTeamId)!)
    }
  }

  /* ── Aggregate current period ── */
  const currMap = new Map<string, { cost: number; tokens: number; calls: number; models: Set<string> }>()
  for (const r of currSource) {
    const pid = r.project_id ?? '__none__'
    const e   = currMap.get(pid) ?? { cost: 0, tokens: 0, calls: 0, models: new Set() }
    e.cost   += Number(r.cost_usd     ?? 0)
    e.tokens += Number(r.total_tokens ?? 0)
    e.calls  += Number((r as Record<string,unknown>).request_count ?? 1)
    const model = (r as Record<string,unknown>).model as string | undefined
    if (model) e.models.add(model)
    currMap.set(pid, e)
  }

  /* ── Aggregate prev period ── */
  const prevMap = new Map<string, { cost: number; calls: number }>()
  for (const r of prevSource) {
    const pid = r.project_id ?? '__none__'
    const e   = prevMap.get(pid) ?? { cost: 0, calls: 0 }
    e.cost  += Number(r.cost_usd ?? 0)
    e.calls += Number((r as Record<string,unknown>).request_count ?? 1)
    prevMap.set(pid, e)
  }

  const totalCost = Array.from(currMap.values()).reduce((s, v) => s + v.cost, 0)

  const projectRows: ProjectRow[] = Array.from(currMap.entries())
    .sort(([, a], [, b]) => b.cost - a.cost)
    .map(([pid, v], i) => {
      const p      = prevMap.get(pid) ?? { cost: 0, calls: 0 }
      const budget = budgetMap.get(pid)
      const team   = projTeamMap.get(pid)
      return {
        id:         pid,
        name:       projNames.get(pid) ?? (pid === '__none__' ? 'Uncategorized' : pid.slice(0, 8)),
        team:       team?.name  ?? '—',
        teamColor:  team?.color ?? '#6B7280',
        color:      PROJ_COLORS[i % PROJ_COLORS.length],
        cost30d:    v.cost,
        costPrev:   p.cost,
        tokens30d:  v.tokens / 1_000_000,
        calls30d:   v.calls,
        callsPrev:  p.calls,
        models:     Array.from(v.models),
        budget:     budget ? Number(budget) : undefined,
        pctOfTotal: totalCost > 0 ? +(v.cost / totalCost * 100).toFixed(1) : 0,
      }
    })

  return <ProjectsClient projects={projectRows} />
}
