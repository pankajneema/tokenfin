import { createClient }    from '@/lib/supabase/server'
import { StatsCards }       from '@/components/dashboard/stats-cards'
import { CostChart }        from '@/components/dashboard/cost-chart'
import { ModelBreakdown }   from '@/components/dashboard/model-breakdown'
import { TopProjects }      from '@/components/dashboard/top-projects'
import { TeamBreakdown }    from '@/components/dashboard/team-breakdown'
import { RecentEvents }     from '@/components/dashboard/recent-events'
import { AlertBanner }      from '@/components/dashboard/alert-banner'

export const metadata = { title: 'Overview — TokenFin' }

/* ── Sparkline builder ──────────────────────────────────────── */
type UsageRow = { cost_usd?: number | null; total_tokens?: number | null; created_at: string }

function buildSparklines(events: UsageRow[]) {
  const days: Record<string, { cost: number; tokens: number; reqs: number }> = {}
  for (let i = 6; i >= 0; i--) {
    const key = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10)
    days[key] = { cost: 0, tokens: 0, reqs: 0 }
  }
  for (const e of events) {
    const key = e.created_at.slice(0, 10)
    if (days[key]) {
      days[key].cost   += e.cost_usd     ?? 0
      days[key].tokens += e.total_tokens ?? 0
      days[key].reqs++
    }
  }
  const vals = Object.values(days)
  return {
    costs:  vals.map(v => v.cost),
    tokens: vals.map(v => v.tokens),
    reqs:   vals.map(v => v.reqs),
  }
}

/* ── Trend % helper ─────────────────────────────────────────── */
function trendPct(curr: number, prev: number): number | null {
  if (prev === 0) return null
  return +((curr - prev) / prev * 100).toFixed(1)
}

/* ═══════════════════════════════════════════════════════════════ */
export default async function DashboardPage() {
  const supabase = createClient()
  const now      = Date.now()
  const since30  = new Date(now - 30 * 86400_000).toISOString()
  const since60  = new Date(now - 60 * 86400_000).toISOString()
  const since14  = new Date(now - 14 * 86400_000).toISOString()
  const since7   = new Date(now -  7 * 86400_000).toISOString()

  const [
    { data: events30   },
    { data: eventsPrev },  // prev 30d (60-30 days ago)
    { data: events7    },
    { data: chartRaw   },
    { data: recent     },
    { data: members    },
    { data: projects   },
    { data: projAgg    },
  ] = await Promise.all([
    supabase.from('usage_events').select('total_tokens,cost_usd,model,created_at').gte('created_at', since30),
    supabase.from('usage_events').select('total_tokens,cost_usd,created_at').gte('created_at', since60).lt('created_at', since30),
    supabase.from('usage_events').select('total_tokens,cost_usd,created_at').gte('created_at', since7),
    supabase.from('usage_agg').select('bucket,cost_usd,total_tokens,request_count').gte('bucket', since14).order('bucket', { ascending: true }),
    supabase.from('usage_events').select('id,model,total_tokens,cost_usd,created_at,tags,metadata').order('created_at', { ascending: false }).limit(10),
    supabase.from('members').select('id').limit(100),
    supabase.from('projects').select('id,name,slug').limit(10),
    supabase.from('usage_agg').select('project_id,cost_usd,request_count').gte('bucket', since30),
  ])

  /* ── Current period aggregations ── */
  const totalCost   = (events30 ?? []).reduce((s, r) => s + (r.cost_usd     ?? 0), 0)
  const totalTokens = (events30 ?? []).reduce((s, r) => s + (r.total_tokens ?? 0), 0)
  const totalReqs   = events30?.length ?? 0
  const memberCount = members?.length  ?? 0

  /* ── Previous period aggregations ── */
  const prevCost   = (eventsPrev ?? []).reduce((s, r) => s + (r.cost_usd     ?? 0), 0)
  const prevTokens = (eventsPrev ?? []).reduce((s, r) => s + (r.total_tokens ?? 0), 0)
  const prevReqs   = eventsPrev?.length ?? 0

  /* ── Real trend percentages ── */
  const trends = {
    cost:   trendPct(totalCost,   prevCost),
    tokens: trendPct(totalTokens, prevTokens),
    reqs:   trendPct(totalReqs,   prevReqs),
  }

  /* ── Model breakdown ── */
  const modelMap: Record<string, { cost: number; tokens: number; reqs: number }> = {}
  for (const e of events30 ?? []) {
    const m = e.model ?? 'unknown'
    if (!modelMap[m]) modelMap[m] = { cost: 0, tokens: 0, reqs: 0 }
    modelMap[m].cost   += e.cost_usd     ?? 0
    modelMap[m].tokens += e.total_tokens ?? 0
    modelMap[m].reqs++
  }
  const modelBreakdown = Object.entries(modelMap)
    .map(([name, v]) => ({ name, ...v, pct: totalCost > 0 ? +(v.cost / totalCost * 100).toFixed(1) : 0 }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5)

  /* ── Project breakdown from usage_agg ── */
  const projMap: Record<string, { cost: number; calls: number }> = {}
  for (const r of projAgg ?? []) {
    const pid = r.project_id ?? '__none__'
    if (!projMap[pid]) projMap[pid] = { cost: 0, calls: 0 }
    projMap[pid].cost  += Number(r.cost_usd      ?? 0)
    projMap[pid].calls += Number(r.request_count ?? 0)
  }
  const projNames = new Map((projects ?? []).map(p => [p.id, p.name]))
  const topProjects = Object.entries(projMap)
    .map(([pid, v]) => ({
      id:      pid,
      name:    projNames.get(pid) ?? 'Unknown',
      cost30d: v.cost,
      calls30d: v.calls,
      pct:     totalCost > 0 ? +(v.cost / totalCost * 100).toFixed(1) : 0,
    }))
    .sort((a, b) => b.cost30d - a.cost30d)
    .slice(0, 5)

  const sparks = buildSparklines(events7 ?? [])

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-5">

        {/* ── Page header ── */}
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

        {/* Alert banner */}
        <AlertBanner />

        {/* ── 4 stat cards ── */}
        <StatsCards
          totalCost={totalCost}
          totalTokens={totalTokens}
          totalRequests={totalReqs}
          memberCount={memberCount}
          sparks={sparks}
          trends={trends}
        />

        {/* ── Cost trend (3/5) + Model breakdown (2/5) ── */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
          <div className="xl:col-span-3">
            <CostChart data={chartRaw ?? []} />
          </div>
          <div className="xl:col-span-2">
            <ModelBreakdown data={modelBreakdown} totalCost={totalCost} />
          </div>
        </div>

        {/* ── Top projects (3/5) + Team activity (2/5) ── */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
          <div className="xl:col-span-3">
            <TopProjects topProjects={topProjects} totalCost={totalCost} />
          </div>
          <div className="xl:col-span-2">
            <TeamBreakdown memberCount={memberCount} />
          </div>
        </div>

        {/* ── Recent events ── */}
        <RecentEvents events={recent ?? []} />

      </div>
    </div>
  )
}
