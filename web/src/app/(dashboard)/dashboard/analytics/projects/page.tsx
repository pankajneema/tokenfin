import { createClient }       from '@/lib/supabase/server'
import { createAdminClient }  from '@/lib/supabase/server'
import { ProjectsClient }     from './_client'
import type { ProjectRow }    from './_client'

export const metadata = { title: 'By Project — TokenFin Analytics' }

const PROJ_COLORS = ['#D97757','#4285F4','#8B5CF6','#20B2AA','#F59E0B','#6B7280']

export default async function ProjectsPage() {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: membership } = await supabase
    .from('members').select('org_id').eq('user_id', user.id).maybeSingle()
  const orgId = membership?.org_id ?? ''

  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString()
  const since60 = new Date(Date.now() - 60 * 86400_000).toISOString()

  const [
    { data: curr     },
    { data: prev     },
    { data: projects },
    { data: limits   },
    { data: members  },
  ] = await Promise.all([
    admin.from('usage_agg')
      .select('project_id,model,total_tokens,cost_usd,request_count')
      .eq('org_id', orgId).gte('bucket', since30),
    admin.from('usage_agg')
      .select('project_id,cost_usd,request_count')
      .eq('org_id', orgId).gte('bucket', since60).lt('bucket', since30),
    admin.from('projects').select('id,name,slug').eq('org_id', orgId),
    admin.from('limits').select('project_id,value').eq('org_id', orgId).eq('metric', 'cost'),
    admin.from('members').select('id').eq('org_id', orgId),
  ])

  const projNames  = new Map((projects ?? []).map(p => [p.id, p.name]))
  const budgetMap  = new Map((limits ?? []).map(l => [l.project_id, l.value]))
  const memberCount = members?.length ?? 0

  /* ── Aggregate current period ── */
  const currMap = new Map<string, { cost: number; tokens: number; calls: number; models: Set<string> }>()
  for (const r of curr ?? []) {
    const pid = r.project_id ?? '__none__'
    const e   = currMap.get(pid) ?? { cost: 0, tokens: 0, calls: 0, models: new Set() }
    e.cost   += Number(r.cost_usd      ?? 0)
    e.tokens += Number(r.total_tokens  ?? 0)
    e.calls  += Number(r.request_count ?? 0)
    if (r.model) e.models.add(r.model)
    currMap.set(pid, e)
  }

  /* ── Aggregate prev period ── */
  const prevMap = new Map<string, { cost: number; calls: number }>()
  for (const r of prev ?? []) {
    const pid = r.project_id ?? '__none__'
    const e   = prevMap.get(pid) ?? { cost: 0, calls: 0 }
    e.cost  += Number(r.cost_usd      ?? 0)
    e.calls += Number(r.request_count ?? 0)
    prevMap.set(pid, e)
  }

  const totalCost = Array.from(currMap.values()).reduce((s, v) => s + v.cost, 0)

  const projectRows: ProjectRow[] = Array.from(currMap.entries())
    .sort(([, a], [, b]) => b.cost - a.cost)
    .map(([pid, v], i) => {
      const p = prevMap.get(pid) ?? { cost: 0, calls: 0 }
      const budget = budgetMap.get(pid)
      return {
        id:         pid,
        name:       projNames.get(pid) ?? (pid === '__none__' ? 'Uncategorized' : pid.slice(0, 8)),
        team:       '—',
        teamColor:  '#6B7280',
        color:      PROJ_COLORS[i % PROJ_COLORS.length],
        cost30d:    v.cost,
        costPrev:   p.cost,
        tokens30d:  v.tokens / 1_000_000,
        calls30d:   v.calls,
        callsPrev:  p.calls,
        models:     Array.from(v.models),
        budget:     budget ? Number(budget) : undefined,
        pctOfTotal: totalCost > 0 ? +(v.cost / totalCost * 100).toFixed(1) : 0,
        users:      Math.max(1, Math.round(memberCount / Math.max(currMap.size, 1))),
      }
    })

  return <ProjectsClient projects={projectRows} />
}
