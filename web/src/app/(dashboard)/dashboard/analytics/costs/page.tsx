import { createClient }      from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { toISTDate, daysAgoIST, tsNDaysAgo } from '@/lib/dates'
import { CostsClient }       from './_client'
import type { DailyRow }     from './_client'

export const metadata = { title: 'Cost Reports — TokenFin Analytics' }

const DAYS_OF_WEEK = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { days: daysParam } = await searchParams
  const days = Math.min(90, Math.max(7, parseInt(daysParam ?? '30') || 30))

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: _mb } = await admin
    .from('members').select('org_id').eq('user_id', user.id).limit(1)
  const orgId = _mb?.[0]?.org_id ?? ''

  const since30date = daysAgoIST(days)
  const since60date = daysAgoIST(days * 2)
  const since30ts   = tsNDaysAgo(days)
  const since60ts   = tsNDaysAgo(days * 2)

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
      .select('created_at,model,project_id,total_tokens,cost_usd,cost_basis')
      .eq('org_id', orgId).gte('created_at', since30ts),
    admin.from('usage_events')
      .select('created_at,model,project_id,cost_usd,cost_basis')
      .eq('org_id', orgId).gte('created_at', since60ts).lt('created_at', since30ts),
    admin.from('projects').select('id,name').eq('org_id', orgId),
  ])

  const projNames = new Map((projects ?? []).map(p => [p.id, p.name]))

  // Fall back to usage_events if usage_agg is missing or incomplete — a
  // single nonzero row isn't enough to trust it wholesale when the aggregation
  // worker can partially lag, so compare summed totals instead. usage_agg only
  // ever holds METERED rows (notional/subscription usage is deliberately kept
  // out of it), so exclude notional from the raw-events side of the comparison
  // too, or orgs with subscription usage would always look "incomplete".
  const aggCostTotal  = (curr ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
  const evtsCostTotal = (evts ?? []).filter(r => (r as Record<string,unknown>).cost_basis !== 'notional').reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
  const aggHasCost    = aggCostTotal > 0 && aggCostTotal >= evtsCostTotal * 0.95

  // usage_agg NEVER contains notional rows (by design) — top it up with
  // notional rows read straight from raw events, or trusting agg silently
  // drops subscription spend/calls from every total below.
  const notionalEvts = (evts ?? []).filter(r => (r as Record<string,unknown>).cost_basis === 'notional')

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
      const day = toISTDate(r.bucket as string)
      const e   = dayMap.get(day) ?? { cost:0, tokens:0, calls:0, modelMap:new Map(), projMap:new Map() }
      e.cost   += Number(r.cost_usd      ?? 0)
      e.tokens += Number(r.total_tokens  ?? 0)
      e.calls  += Number(r.request_count ?? 0)
      if (r.model)      e.modelMap.set(r.model,      (e.modelMap.get(r.model)      ?? 0) + Number(r.cost_usd ?? 0))
      if (r.project_id) e.projMap.set(r.project_id,  (e.projMap.get(r.project_id)  ?? 0) + Number(r.cost_usd ?? 0))
      dayMap.set(day, e)
    }
    // Notional rows on top — never in usage_agg, always from raw events
    for (const r of notionalEvts) {
      const day = toISTDate(r.created_at)
      const e   = dayMap.get(day) ?? { cost:0, tokens:0, calls:0, modelMap:new Map(), projMap:new Map() }
      e.cost   += Number(r.cost_usd     ?? 0)
      e.tokens += Number(r.total_tokens ?? 0)
      e.calls  += 1
      if (r.model)      e.modelMap.set(r.model,      (e.modelMap.get(r.model)      ?? 0) + Number(r.cost_usd ?? 0))
      if (r.project_id) e.projMap.set(r.project_id,  (e.projMap.get(r.project_id)  ?? 0) + Number(r.cost_usd ?? 0))
      dayMap.set(day, e)
    }
  } else {
    // Fallback — read from usage_events
    for (const r of evts ?? []) {
      const day = toISTDate(r.created_at)
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
  const notionalEvtsPrev = (evtsPrev ?? []).filter(r => (r as Record<string,unknown>).cost_basis === 'notional')
  const prevMap = new Map<string, number>()
  const prevSource = aggHasCost ? [...(prev ?? []), ...notionalEvtsPrev] : (evtsPrev ?? [])
  for (const r of prevSource) {
    // prevSource can mix agg rows (bucket) and notional top-up rows
    // (created_at) when aggHasCost — read whichever field the row has.
    const row    = r as Record<string,unknown>
    const rawDay = String(row.bucket ?? row.created_at ?? '')
    if (!rawDay) continue
    const shifted = toISTDate(new Date(rawDay).getTime() + days * 86400_000)
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

  return <CostsClient rows={rows} days={days} />
}
