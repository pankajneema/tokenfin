import { createClient }      from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { CostsClient }       from './_client'
import type { DailyRow }     from './_client'

export const metadata = { title: 'Cost Reports — TokenFin Analytics' }

const DAYS_OF_WEEK = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

export default async function CostsPage() {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: _mb } = await admin
    .from('members').select('org_id').eq('user_id', user.id).limit(1)
  const orgId = _mb?.[0]?.org_id ?? ''

  const since30date = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)  // for bucket (DATE)
  const since60date = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10)
  const since30ts   = new Date(Date.now() - 30 * 86400_000).toISOString()               // for created_at (TIMESTAMP)
  const since60ts   = new Date(Date.now() - 60 * 86400_000).toISOString()

  const [
    { data: curr     },
    { data: prev     },
    { data: evts     },
    { data: evtsPrev },
    { data: projects },
  ] = await Promise.all([
    admin.from('usage_agg')
      .select('bucket,model,project_id,total_tokens,cost_usd,request_count')
      .eq('org_id', orgId).gte('bucket', since30date),
    admin.from('usage_agg')
      .select('bucket,model,project_id,cost_usd,request_count')
      .eq('org_id', orgId).gte('bucket', since60date).lt('bucket', since30date),
    admin.from('usage_events')
      .select('created_at,model,project_id,total_tokens,cost_usd')
      .eq('org_id', orgId).gte('created_at', since30ts),
    admin.from('usage_events')
      .select('created_at,model,project_id,cost_usd')
      .eq('org_id', orgId).gte('created_at', since60ts).lt('created_at', since30ts),
    admin.from('projects').select('id,name').eq('org_id', orgId),
  ])

  const projNames = new Map((projects ?? []).map(p => [p.id, p.name]))

  // Fall back to usage_events if usage_agg has no data
  const aggHasCost = (curr ?? []).some(r => Number(r.cost_usd ?? 0) > 0)

  type DayEntry = {
    cost:     number
    tokens:   number
    calls:    number
    modelMap: Map<string, number>
    projMap:  Map<string, number>
  }

  const dayMap = new Map<string, DayEntry>()

  if (aggHasCost) {
    // Primary path — read from usage_agg
    for (const r of curr ?? []) {
      const day = (r.bucket as string).slice(0, 10)
      const e   = dayMap.get(day) ?? { cost:0, tokens:0, calls:0, modelMap:new Map(), projMap:new Map() }
      e.cost   += Number(r.cost_usd      ?? 0)
      e.tokens += Number(r.total_tokens  ?? 0)
      e.calls  += Number(r.request_count ?? 0)
      if (r.model)      e.modelMap.set(r.model,      (e.modelMap.get(r.model)      ?? 0) + Number(r.cost_usd ?? 0))
      if (r.project_id) e.projMap.set(r.project_id,  (e.projMap.get(r.project_id)  ?? 0) + Number(r.cost_usd ?? 0))
      dayMap.set(day, e)
    }
  } else {
    // Fallback — read from usage_events
    for (const r of evts ?? []) {
      const day = r.created_at.slice(0, 10)
      const e   = dayMap.get(day) ?? { cost:0, tokens:0, calls:0, modelMap:new Map(), projMap:new Map() }
      e.cost   += Number(r.cost_usd     ?? 0)
      e.tokens += Number(r.total_tokens ?? 0)
      e.calls  += 1
      if (r.model)      e.modelMap.set(r.model,      (e.modelMap.get(r.model)      ?? 0) + Number(r.cost_usd ?? 0))
      if (r.project_id) e.projMap.set(r.project_id,  (e.projMap.get(r.project_id)  ?? 0) + Number(r.cost_usd ?? 0))
      dayMap.set(day, e)
    }
  }

  /* ── Prev period — shifted forward 30 days for chart alignment ── */
  const prevMap = new Map<string, number>()
  const prevSource = aggHasCost ? (prev ?? []) : (evtsPrev ?? [])
  for (const r of prevSource) {
    const rawDay = aggHasCost
      ? String((r as Record<string,unknown>).bucket ?? '')
      : String((r as Record<string,unknown>).created_at ?? '')
    if (!rawDay) continue
    const shifted = new Date(new Date(rawDay).getTime() + 30 * 86400_000).toISOString().slice(0, 10)
    prevMap.set(shifted, (prevMap.get(shifted) ?? 0) + Number(r.cost_usd ?? 0))
  }

  /* ── Spike detection ── */
  const allCosts = Array.from(dayMap.values()).map(v => v.cost)
  const avgCost  = allCosts.length > 0 ? allCosts.reduce((s, c) => s + c, 0) / allCosts.length : 0

  const rows: DailyRow[] = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => {
      const date          = new Date(day)
      const topModelEntry = Array.from(v.modelMap.entries()).sort(([,a],[,b]) => b - a)[0]
      const topProjEntry  = Array.from(v.projMap.entries()).sort(([,a],[,b]) => b - a)[0]
      const topProjName   = topProjEntry ? (projNames.get(topProjEntry[0]) ?? topProjEntry[0].slice(0, 8)) : ''

      return {
        date:     date.toLocaleDateString('en-US', { month:'short', day:'numeric' }),
        dow:      DAYS_OF_WEEK[date.getDay()],
        cost:     v.cost,
        prev:     prevMap.get(day) ?? 0,
        tokens:   v.tokens / 1_000_000,
        calls:    v.calls,
        topModel: topModelEntry ? topModelEntry[0] : '',
        topProj:  topProjName,
        spike:    avgCost > 0 && v.cost > avgCost * 2.5,
      }
    })

  return <CostsClient rows={rows} />
}
