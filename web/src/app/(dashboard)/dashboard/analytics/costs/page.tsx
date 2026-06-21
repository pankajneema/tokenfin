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

  const { data: membership } = await supabase
    .from('members').select('org_id').eq('user_id', user.id).maybeSingle()
  const orgId = membership?.org_id ?? ''

  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
  const since60 = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10)

  /* ── Fetch last 30 days (current) + prev 30 days + projects ── */
  const [
    { data: curr },
    { data: prev },
    { data: projects },
  ] = await Promise.all([
    admin.from('usage_agg')
      .select('bucket,model,project_id,total_tokens,cost_usd,request_count')
      .eq('org_id', orgId).gte('bucket', since30),
    admin.from('usage_agg')
      .select('bucket,model,project_id,cost_usd,request_count')
      .eq('org_id', orgId).gte('bucket', since60).lt('bucket', since30),
    admin.from('projects').select('id,name').eq('org_id', orgId),
  ])

  const projNames = new Map((projects ?? []).map(p => [p.id, p.name]))

  /* ── Aggregate current period by day ── */
  type DayEntry = {
    cost:     number
    tokens:   number
    calls:    number
    modelMap: Map<string, number>  // model → cost
    projMap:  Map<string, number>  // project_id → cost
  }

  const dayMap = new Map<string, DayEntry>()
  for (const r of curr ?? []) {
    const day = (r.bucket as string).slice(0, 10)
    const e   = dayMap.get(day) ?? { cost:0, tokens:0, calls:0, modelMap:new Map(), projMap:new Map() }
    e.cost   += Number(r.cost_usd      ?? 0)
    e.tokens += Number(r.total_tokens  ?? 0)
    e.calls  += Number(r.request_count ?? 0)
    if (r.model) {
      e.modelMap.set(r.model, (e.modelMap.get(r.model) ?? 0) + Number(r.cost_usd ?? 0))
    }
    if (r.project_id) {
      e.projMap.set(r.project_id, (e.projMap.get(r.project_id) ?? 0) + Number(r.cost_usd ?? 0))
    }
    dayMap.set(day, e)
  }

  /* ── Aggregate prev period by day, shift forward 30 days for alignment ── */
  const prevMap = new Map<string, number>()
  for (const r of prev ?? []) {
    const rawDay  = (r.bucket as string).slice(0, 10)
    const shifted = new Date(new Date(rawDay).getTime() + 30 * 86400_000).toISOString().slice(0, 10)
    prevMap.set(shifted, (prevMap.get(shifted) ?? 0) + Number(r.cost_usd ?? 0))
  }

  /* ── Compute average for spike detection ── */
  const allCosts = Array.from(dayMap.values()).map(v => v.cost)
  const avgCost  = allCosts.length > 0 ? allCosts.reduce((s, c) => s + c, 0) / allCosts.length : 0

  /* ── Build DailyRow[] sorted oldest-first (client reverses for newest-first) ── */
  const rows: DailyRow[] = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => {
      const date = new Date(day)
      const topModelEntry = Array.from(v.modelMap.entries()).sort(([,a],[,b]) => b - a)[0]
      const topProjEntry  = Array.from(v.projMap.entries()).sort(([,a],[,b]) => b - a)[0]
      const topProjName   = topProjEntry ? (projNames.get(topProjEntry[0]) ?? topProjEntry[0].slice(0,8)) : ''

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
