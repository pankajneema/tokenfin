import { createClient, createAdminClient } from '@/lib/supabase/server'
import { toISTDate, daysAgoIST, tsNDaysAgo } from '@/lib/dates'
import { StatsCards }     from '@/components/dashboard/stats-cards'
import { CostChart }      from '@/components/dashboard/cost-chart'
import { ModelBreakdown } from '@/components/dashboard/model-breakdown'
import { TopProjects }    from '@/components/dashboard/top-projects'
import { TeamBreakdown }  from '@/components/dashboard/team-breakdown'
import { RecentEvents }   from '@/components/dashboard/recent-events'
import { AlertBanner }            from '@/components/dashboard/alert-banner'
import { OnboardingChecklist }    from '@/components/dashboard/onboarding-checklist'
import { FirstEventCelebration }  from '@/components/dashboard/first-event-celebration'

export const metadata = { title: 'Overview — TokenFin' }

// Always render fresh — usage data changes on every ingested event.
export const dynamic = 'force-dynamic'
export const revalidate = 0

/* ── Sparkline builder ────────────────────────────────── */
type SparkRow = { cost_usd?: number | null; total_tokens?: number | null; created_at: string }
function buildSparklines(events: SparkRow[]) {
  const days: Record<string, { cost: number; tokens: number; reqs: number }> = {}
  for (let i = 6; i >= 0; i--) {
    const key = daysAgoIST(i)
    days[key] = { cost: 0, tokens: 0, reqs: 0 }
  }
  for (const e of events) {
    const key = toISTDate(e.created_at)
    if (days[key]) {
      days[key].cost   += e.cost_usd     ?? 0
      days[key].tokens += e.total_tokens ?? 0
      days[key].reqs++
    }
  }
  const vals = Object.values(days)
  return { costs: vals.map(v => v.cost), tokens: vals.map(v => v.tokens), reqs: vals.map(v => v.reqs) }
}

function trendPct(curr: number, prev: number): number | null {
  if (prev === 0) return null
  return +((curr - prev) / prev * 100).toFixed(1)
}

/* ════════════════════════════════════════════════════════ */
export default async function DashboardPage() {
  const supabase = createClient()
  const admin    = createAdminClient()
  const now      = Date.now()
  const since30  = tsNDaysAgo(30)   // UTC timestamp for usage_events.created_at queries
  const since60  = tsNDaysAgo(60)
  const since7   = tsNDaysAgo(7)
  const since5d  = daysAgoIST(5)   // IST date for usage_agg.bucket queries
  const since10d = daysAgoIST(10)

  /* ── Identify org ── */
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: _mb } = await admin
    .from('members').select('org_id').eq('user_id', user.id).limit(1)
  const orgId = _mb?.[0]?.org_id ?? ''

  /* ── Parallel data fetch — all scoped to orgId ── */
  const [
    { data: events30   },
    { data: eventsPrev },
    { data: events7    },
    { data: chartRaw   },
    { data: recent     },
    { data: members    },
    { data: projects   },
    { data: projAgg    },
    { data: apiKeys    },
    { data: teams      },
    { data: prev5dAgg  },
  ] = await Promise.all([
    admin.from('usage_events')
      .select('total_tokens,input_tokens,output_tokens,cost_usd,cost_basis,model,project_id,created_at,tags')
      .eq('org_id', orgId).gte('created_at', since30),
    admin.from('usage_events')
      .select('total_tokens,cost_usd,cost_basis,created_at')
      .eq('org_id', orgId).gte('created_at', since60).lt('created_at', since30),
    admin.from('usage_events')
      .select('total_tokens,cost_usd,created_at')
      .eq('org_id', orgId).gte('created_at', since7),
    admin.from('usage_agg')
      .select('bucket,cost_usd,total_tokens,request_count')
      .eq('org_id', orgId).gte('bucket', since5d).order('bucket', { ascending: true }),
    admin.from('usage_events')
      .select('id,model,total_tokens,cost_usd,created_at,tags,metadata')
      .eq('org_id', orgId).order('created_at', { ascending: false }).limit(10),
    admin.from('members')
      .select('id,user_id,team_id,role').eq('org_id', orgId).limit(100),
    admin.from('projects')
      .select('id,name,slug').eq('org_id', orgId).limit(10),
    admin.from('usage_agg')
      .select('project_id,cost_usd,request_count,total_tokens')
      .eq('org_id', orgId).gte('bucket', since5d),
    admin.from('api_keys')
      .select('created_by,project_id').eq('org_id', orgId).eq('is_active', true),
    admin.from('teams')
      .select('id,name').eq('org_id', orgId),
    admin.from('usage_agg')
      .select('cost_usd,total_tokens,request_count')
      .eq('org_id', orgId).gte('bucket', since10d).lt('bucket', since5d),
  ])

  /* ── Current period aggregations ── */
  // Notional = subscription usage priced at API rates (e.g. Claude Code on
  // Pro/Max) — not a real bill. Product decision: the headline "Total Cost"
  // and breakdowns show the COMBINED figure (metered+notional) as one
  // coherent number, matching Analytics/Cost Reports/By Project/By Model/My
  // Usage — metered and notional are still broken out separately wherever a
  // completeness check needs to compare like-for-like against usage_agg
  // (which only ever holds metered rows).
  const isNotional   = (r: { cost_basis?: string | null }) => r.cost_basis === 'notional'
  const meteredCost  = (events30 ?? []).filter(r => !isNotional(r)).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
  const notionalCost = (events30 ?? []).filter(isNotional).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
  const totalCost    = meteredCost + notionalCost
  const totalTokens  = (events30 ?? []).reduce((s, r) => s + Number(r.total_tokens ?? 0), 0)
  const totalReqs    = events30?.length ?? 0
  const memberCount  = members?.length  ?? 0
  const inputTokens  = (events30 ?? []).reduce((s, r) => {
    const total = Number(r.total_tokens ?? 0)
    return s + Number((r as Record<string,unknown>).input_tokens  ?? Math.round(total * 0.7))
  }, 0)
  const outputTokens = (events30 ?? []).reduce((s, r) => {
    const total = Number(r.total_tokens ?? 0)
    return s + Number((r as Record<string,unknown>).output_tokens ?? (total - Math.round(total * 0.7)))
  }, 0)

  /* ── Prev period ── */
  const prevMetered  = (eventsPrev ?? []).filter(r => !isNotional(r)).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
  const prevNotional = (eventsPrev ?? []).filter(isNotional).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
  const prevCost     = prevMetered + prevNotional
  const prevTokens   = (eventsPrev ?? []).reduce((s, r) => s + Number(r.total_tokens ?? 0), 0)
  const prevReqs     = eventsPrev?.length ?? 0

  const trends = {
    cost:   trendPct(totalCost,   prevCost),
    tokens: trendPct(totalTokens, prevTokens),
    reqs:   trendPct(totalReqs,   prevReqs),
  }

  /* ── Model breakdown (combined, matches the headline Total Cost) ── */
  const modelMap: Record<string, { cost: number; tokens: number; reqs: number }> = {}
  for (const e of events30 ?? []) {
    const m = e.model ?? 'unknown'
    if (!modelMap[m]) modelMap[m] = { cost: 0, tokens: 0, reqs: 0 }
    modelMap[m].cost   += Number(e.cost_usd ?? 0)
    modelMap[m].tokens += Number(e.total_tokens ?? 0)
    modelMap[m].reqs++
  }
  const modelBreakdown = Object.entries(modelMap)
    .map(([name, v]) => ({ name, ...v, pct: totalCost > 0 ? +(v.cost / totalCost * 100).toFixed(1) : 0 }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5)

  /* ── Chart data: always bucket events30 by day for last 5 days ──────────────
   * Usage_agg can be sparse (old ingest attempts may have missed upsert).
   * Raw usage_events are the source of truth — bucket them in JS.
   * Pre-seed all 5 days so days with zero usage still appear as flat bars.
   * ──────────────────────────────────────────────────────────────────────── */
  type ChartRow = { bucket: string; cost_usd: number; total_tokens: number; request_count: number }

  const dayMap = new Map<string, { cost: number; tokens: number; reqs: number }>()
  for (let i = 4; i >= 0; i--) {
    dayMap.set(daysAgoIST(i), { cost: 0, tokens: 0, reqs: 0 })
  }
  for (const e of events30 ?? []) {
    const day = toISTDate(e.created_at)
    if (!dayMap.has(day)) continue
    const entry = dayMap.get(day)!
    entry.cost   += Number(e.cost_usd ?? 0)
    entry.tokens += Number(e.total_tokens ?? 0)
    entry.reqs++
  }
  const chartData: ChartRow[] = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, v]) => ({
      bucket,
      cost_usd:      v.cost,
      total_tokens:  v.tokens,
      request_count: v.reqs,
    }))

  /* ── Project breakdown: prefer projAgg, fall back to events ──
   * A single nonzero row used to be enough to trust projAgg wholesale, which
   * silently under-counted whenever the aggregation worker only partially
   * caught up on the 5-day window. Compare against the raw 5-day METERED
   * total instead — usage_agg only ever holds metered rows (persist.ts
   * deliberately excludes notional), so comparing it against a combined
   * total would make it look permanently incomplete for subscription usage.
   * Only trust projAgg when it accounts for at least 95% of the metered
   * events in the same window. */
  const notionalEvts5d = (events30 ?? []).filter(e => isNotional(e) && dayMap.has(toISTDate(e.created_at)))
  const evts5dMeteredTotal = Array.from(dayMap.values()).reduce((s, v) => s + v.cost, 0)
    - notionalEvts5d.reduce((s, e) => s + Number(e.cost_usd ?? 0), 0)
  const projAggCostTotal = (projAgg ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
  const projAggHasCost = projAggCostTotal > 0 && projAggCostTotal >= evts5dMeteredTotal * 0.95
  const projMap: Record<string, { cost: number; calls: number }> = {}

  if (projAggHasCost) {
    for (const r of projAgg ?? []) {
      const pid = r.project_id ?? '__none__'
      if (!projMap[pid]) projMap[pid] = { cost: 0, calls: 0 }
      projMap[pid].cost  += Number(r.cost_usd      ?? 0)
      projMap[pid].calls += Number(r.request_count ?? 0)
    }
    // usage_agg never contains notional rows — top it up from raw events so
    // Top Projects still matches the combined headline Total Cost.
    for (const e of notionalEvts5d) {
      const pid = e.project_id ?? '__none__'
      if (!projMap[pid]) projMap[pid] = { cost: 0, calls: 0 }
      projMap[pid].cost  += Number(e.cost_usd ?? 0)
      projMap[pid].calls += 1
    }
  } else {
    // Combined (metered + notional), matching the headline Total Cost card.
    for (const e of events30 ?? []) {
      const pid = e.project_id ?? '__none__'
      if (!projMap[pid]) projMap[pid] = { cost: 0, calls: 0 }
      projMap[pid].cost  += Number(e.cost_usd ?? 0)
      projMap[pid].calls += 1
    }
  }

  const projNames = new Map((projects ?? []).map(p => [p.id, p.name]))
  const topProjects = Object.entries(projMap)
    .map(([pid, v]) => ({
      id:       pid,
      name:     projNames.get(pid) ?? (pid === '__none__' ? 'Uncategorized' : 'Unknown'),
      cost30d:  v.cost,
      calls30d: v.calls,
      pct:      totalCost > 0 ? +(v.cost / totalCost * 100).toFixed(1) : 0,
    }))
    .filter(p => p.cost30d > 0 || p.calls30d > 0)
    .sort((a, b) => b.cost30d - a.cost30d)
    .slice(0, 5)

  /* ── Member cost attribution via api_keys.created_by → project cost ── */
  const userCostMap = new Map<string, number>()
  for (const key of apiKeys ?? []) {
    const creator = (key as Record<string,unknown>).created_by as string | null
    const pid     = (key as Record<string,unknown>).project_id as string | null
    if (!creator || !pid) continue
    const projCost = projMap[pid]?.cost ?? 0
    userCostMap.set(creator, (userCostMap.get(creator) ?? 0) + projCost)
  }

  /* ── Member display names from auth ── */
  const teamNameMap = new Map((teams ?? []).map(t => [t.id, t.name]))
  const userInfo = new Map<string, { name: string; email: string }>()
  if (memberCount > 0) {
    const { data: authData } = await admin.auth.admin.listUsers({ perPage: 200 })
    for (const u of authData?.users ?? []) {
      userInfo.set(u.id, {
        name:  (u.user_metadata?.full_name as string | undefined) ?? u.email?.split('@')[0] ?? u.id.slice(0, 8),
        email: u.email ?? '',
      })
    }
  }

  const memberRows = (members ?? [])
    .map(m => {
      const info = userInfo.get(m.user_id) ?? { name: m.user_id.slice(0, 8), email: '' }
      return {
        userId: m.user_id,
        name:   info.name,
        email:  info.email,
        team:   m.team_id ? (teamNameMap.get(m.team_id as string) ?? '—') : '—',
        role:   m.role,
        cost:   userCostMap.get(m.user_id) ?? 0,
      }
    })
    .sort((a, b) => b.cost - a.cost)

  const sparks = buildSparklines(events7 ?? [])

  const prevTotals = {
    tokens: (prev5dAgg ?? []).reduce((s, r) => s + Number(r.total_tokens  ?? 0), 0),
    cost:   (prev5dAgg ?? []).reduce((s, r) => s + Number(r.cost_usd      ?? 0), 0),
    reqs:   (prev5dAgg ?? []).reduce((s, r) => s + Number(r.request_count ?? 0), 0),
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Overview</h1>
            <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">Last 30 days · All projects</p>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--green-bg)] border border-[var(--green)]/20">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-teal" />
            </span>
            <span className="text-[11px] font-semibold text-[var(--green)] tracking-wide">Live</span>
          </div>
        </div>

        <AlertBanner />

        {/* First-event celebration — fires once via localStorage gate */}
        <FirstEventCelebration enabled={totalReqs > 0} />

        {/* Onboarding checklist — visible until first event arrives */}
        {totalReqs === 0 && (
          <OnboardingChecklist
            hasProject={Boolean(projects?.length)}
            hasApiKey={Boolean(apiKeys?.length)}
            hasEvent={false}
          />
        )}

        <StatsCards
          totalCost={totalCost}
          notionalCost={notionalCost}
          meteredCost={meteredCost}
          totalTokens={totalTokens}
          inputTokens={inputTokens}
          outputTokens={outputTokens}
          totalRequests={totalReqs}
          memberCount={memberCount}
          sparks={sparks}
          trends={trends}
        />

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
          <div className="xl:col-span-3">
            <CostChart data={chartData} prevTotals={prevTotals} />
          </div>
          <div className="xl:col-span-2">
            <ModelBreakdown data={modelBreakdown} totalCost={totalCost} />
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
          <div className="xl:col-span-3">
            <TopProjects topProjects={topProjects} totalCost={totalCost} />
          </div>
          <div className="xl:col-span-2">
            <TeamBreakdown memberRows={memberRows} memberCount={memberCount} />
          </div>
        </div>

        <RecentEvents events={recent ?? []} />

      </div>
    </div>
  )
}
