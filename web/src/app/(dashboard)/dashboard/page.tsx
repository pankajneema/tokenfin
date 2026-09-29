import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext } from '@/lib/org-context'
import { daysAgoIn, shiftDay } from '@/lib/dates'
import { dashSummary, dashBreakdown, NO_PROJECT_ID, type DashBreakdown } from '@/lib/rollups'
import { projectMonthEnd, monthToDate } from '@/lib/forecast'
import { StatsCards }     from '@/components/dashboard/stats-cards'
import { CostChart }      from '@/components/dashboard/cost-chart'
import { ModelBreakdown } from '@/components/dashboard/model-breakdown'
import { TopProjects }    from '@/components/dashboard/top-projects'
import { TeamBreakdown, type MemberStat }  from '@/components/dashboard/team-breakdown'
import { RecentEvents }   from '@/components/dashboard/recent-events'
import { AlertBanner }            from '@/components/dashboard/alert-banner'
import { OnboardingChecklist }    from '@/components/dashboard/onboarding-checklist'
import { FirstEventCelebration }  from '@/components/dashboard/first-event-celebration'
import { LivePill }               from '@/components/dashboard/live-pill'

export const metadata = { title: 'Overview — TokenFin' }

// Always render fresh — usage data changes on every ingested event.
export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Days shown in the usage-trend chart (compared with the N days before). */
const CHART_DAYS = 14
const SPARK_DAYS = 7

function trendPct(curr: number, prev: number): number | null {
  if (!(prev > 0)) return null
  return +((curr - prev) / prev * 100).toFixed(1)
}

type Admin = ReturnType<typeof createAdminClient>

/** Distinct prompts per org-local day = rows in usage_daily_prompts (PK org·day·prompt_key). */
async function promptsOnDay(admin: Admin, orgId: string, day: string): Promise<number> {
  const { count } = await admin.from('usage_daily_prompts')
    .select('prompt_key', { count: 'exact', head: true })
    .eq('org_id', orgId).eq('day', day)
  return count ?? 0
}

/** Top members by cost → display rows. Keys are lower(email) or a user id (see userKeyFor). */
async function resolveMembers(
  admin: Admin, orgId: string, bd: DashBreakdown,
  members: { user_id: string; team_id: string | null; role: string }[],
  teamNames: Map<string, string>,
): Promise<MemberStat[]> {
  const rows = bd.rows.filter(r => r.key)
  const byUserId = new Map(members.map(m => [m.user_id, m]))
  const emails = rows.map(r => r.key).filter(k => k.includes('@'))
  const emailToId = new Map<string, string>()
  if (emails.length) {
    const { data } = await admin.rpc('org_member_ids_by_email', { p_org: orgId, p_emails: emails })
    for (const r of (data ?? []) as { email: string; user_id: string }[]) emailToId.set(r.email, r.user_id)
  }

  // Merge a member's email-keyed and id-keyed rows.
  const merged = new Map<string, { userId: string | null; key: string; cost: number }>()
  for (const r of rows) {
    const uid = r.key.includes('@') ? emailToId.get(r.key) ?? null : byUserId.has(r.key) ? r.key : null
    const id = uid ?? r.key
    const e = merged.get(id) ?? { userId: uid, key: r.key, cost: 0 }
    e.cost += r.cost_usd
    if (r.key.includes('@')) e.key = r.key
    merged.set(id, e)
  }

  const ids = Array.from(merged.values()).map(m => m.userId).filter((x): x is string => !!x)
  const users = await Promise.all(ids.map(id => admin.auth.admin.getUserById(id).then(r => r.data.user).catch(() => null)))
  const info = new Map(users.filter(Boolean).map(u => [u!.id, u!]))

  return Array.from(merged.values()).map(m => {
    const u = m.userId ? info.get(m.userId) : undefined
    const member = m.userId ? byUserId.get(m.userId) : undefined
    const email = u?.email ?? (m.key.includes('@') ? m.key : '')
    return {
      userId: m.userId ?? m.key,
      name:   (u?.user_metadata?.full_name as string | undefined) ?? (email ? email.split('@')[0] : m.key.slice(0, 8)),
      email,
      team:   member?.team_id ? teamNames.get(member.team_id) ?? '—' : '—',
      role:   member?.role ?? '',
      cost:   m.cost,
    }
  }).sort((a, b) => b.cost - a.cost)
}

/* ════════════════════════════════════════════════════════ */
export default async function DashboardPage() {
  const { orgId, timezone: tz } = await requireOrgContext()
  const admin = createAdminClient()
  const now   = Date.now()

  // Org-local day labels, inclusive ranges.
  const today    = daysAgoIn(0, tz)
  const from30   = shiftDay(today, -29)
  const prevTo   = shiftDay(today, -30)
  const prevFrom = shiftDay(today, -59)
  const sparkDays = Array.from({ length: SPARK_DAYS }, (_, i) => shiftDay(today, i - (SPARK_DAYS - 1)))

  const [rollups, recentRes, projectsRes, teamsRes, membersRes, keysRes] = await Promise.all([
    Promise.all([
      dashSummary(admin, orgId, from30, today),
      dashSummary(admin, orgId, prevFrom, prevTo),
      dashBreakdown(admin, orgId, from30, today, 'model', undefined, 5),
      dashBreakdown(admin, orgId, from30, today, 'project', undefined, 5),
      dashBreakdown(admin, orgId, from30, today, 'member', undefined, 5),
      Promise.all(sparkDays.map(d => promptsOnDay(admin, orgId, d))),
    ]).then(r => ({ ok: true as const, r }), (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })),
    admin.from('usage_events')
      .select('id,model,total_tokens,cost_usd,cost_basis,created_at,tags,metadata')
      .eq('org_id', orgId).order('created_at', { ascending: false }).limit(20),
    admin.from('projects').select('id,name').eq('org_id', orgId).limit(1000),
    admin.from('teams').select('id,name').eq('org_id', orgId).limit(1000),
    admin.from('members').select('user_id,team_id,role', { count: 'exact' }).eq('org_id', orgId).limit(1000),
    admin.from('api_keys').select('id').eq('org_id', orgId).eq('is_active', true).limit(1),
  ])

  if (!rollups.ok) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[1400px] mx-auto px-6 py-6">
          <h2 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Overview</h2>
          <div className="mt-5 rounded-2xl border border-[var(--red)]/30 bg-[var(--red-bg)] p-5">
            <p className="text-[13px] font-semibold text-[var(--red)]">Couldn’t load usage totals</p>
            <p className="mt-1 text-[12px] text-[var(--fg-secondary)]">
              The usage rollups did not respond ({rollups.error}). Check that migration 011 is applied, then reload.
            </p>
          </div>
        </div>
      </div>
    )
  }
  const [cur, prev, models, projectsBd, membersBd, sparkPrompts] = rollups.r

  const recent = recentRes.data ?? []
  const lastEventAt = recent[0]?.created_at ?? null
  const members = (membersRes.data ?? []) as { user_id: string; team_id: string | null; role: string }[]
  const memberCount = membersRes.count ?? members.length

  /* ── Month to date (org-local) + projection ──
   * MTD can start up to 30 days back, so join the previous window's series. */
  const allDays = [...prev.series, ...cur.series]
  const pick = (k: 'cost_usd' | 'metered_cost_usd' | 'notional_cost_usd') => allDays.map(p => ({ day: p.day, value: p[k] }))
  const mtdCost     = monthToDate(pick('cost_usd'), today)
  const mtdMetered  = monthToDate(pick('metered_cost_usd'), today)
  const mtdNotional = monthToDate(pick('notional_cost_usd'), today)
  const forecast    = projectMonthEnd(pick('cost_usd'), today)

  /* ── Trends: current 30d vs the 30d before; null without previous data ── */
  const trends = {
    cost:    trendPct(cur.cost_usd, prev.cost_usd),
    tokens:  trendPct(cur.total_tokens, prev.total_tokens),
    reqs:    trendPct(cur.requests, prev.requests),
    prompts: trendPct(cur.prompts, prev.prompts),
  }

  const spark = cur.series.slice(-SPARK_DAYS)
  const sparks = {
    costs:   spark.map(p => p.cost_usd),
    tokens:  spark.map(p => p.total_tokens),
    reqs:    spark.map(p => p.requests),
    prompts: sparkPrompts,
  }

  /* ── Chart: last 14 days vs the 14 before (both inside the 30d series) ── */
  const chartData = cur.series.slice(-CHART_DAYS).map(p => ({
    bucket: p.day, cost_usd: p.cost_usd, total_tokens: p.total_tokens, request_count: p.requests,
  }))
  const prevChart = cur.series.slice(-2 * CHART_DAYS, -CHART_DAYS)
  const prevTotals = {
    tokens: prevChart.reduce((s, p) => s + p.total_tokens, 0),
    cost:   prevChart.reduce((s, p) => s + p.cost_usd, 0),
    reqs:   prevChart.reduce((s, p) => s + p.requests, 0),
  }

  /* ── Breakdowns (combined cost, split shown in the cards) ── */
  const totalCost = cur.cost_usd
  const share = (c: number) => totalCost > 0 ? +(c / totalCost * 100).toFixed(1) : 0
  const modelBreakdown = models.rows.map(r => ({
    name: r.key || 'unknown', cost: r.cost_usd, tokens: r.total_tokens, reqs: r.requests, pct: share(r.cost_usd),
  }))

  const projNames = new Map((projectsRes.data ?? []).map(p => [p.id as string, p.name as string]))
  const topProjects = projectsBd.rows.map(r => ({
    id:       r.key,
    name:     r.key === NO_PROJECT_ID ? 'Uncategorized' : projNames.get(r.key) ?? 'Deleted project',
    cost30d:  r.cost_usd,
    calls30d: r.requests,
    tokens30d: r.total_tokens,
    prompts30d: r.prompts ?? null,
    pct:      share(r.cost_usd),
  }))

  const teamNames = new Map((teamsRes.data ?? []).map(t => [t.id as string, t.name as string]))
  const memberRows = await resolveMembers(admin, orgId, membersBd, members, teamNames)

  const hasAnyEvent = Boolean(lastEventAt)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          {/* The page title lives in the top bar (the page's h1). */}
          <p className="text-[13px] text-[var(--fg-secondary)]">
            All projects · days in {tz}
          </p>
          <LivePill lastEventAt={lastEventAt} now={now} />
        </div>

        <AlertBanner />

        {/* First-event celebration — fires once via localStorage gate */}
        <FirstEventCelebration enabled={hasAnyEvent} />

        {/* Onboarding checklist — visible until the first event arrives */}
        {!hasAnyEvent && (
          <OnboardingChecklist
            hasProject={Boolean(projectsRes.data?.length)}
            hasApiKey={Boolean(keysRes.data?.length)}
            hasEvent={false}
          />
        )}

        <StatsCards
          mtd={{ cost: mtdCost, metered: mtdMetered, notional: mtdNotional, projected: forecast?.projected ?? null }}
          last30={{ cost: cur.cost_usd, metered: cur.metered_cost_usd, notional: cur.notional_cost_usd }}
          totalTokens={cur.total_tokens}
          inputTokens={cur.input_tokens}
          outputTokens={cur.output_tokens}
          totalRequests={cur.requests}
          totalPrompts={cur.prompts}
          memberCount={memberCount}
          activeUsers={cur.active_users}
          sparks={sparks}
          trends={trends}
        />

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
          <div className="xl:col-span-3">
            <CostChart data={cur.requests > 0 ? chartData : []} prevTotals={prevTotals} days={CHART_DAYS} />
          </div>
          <div className="xl:col-span-2">
            <ModelBreakdown data={modelBreakdown} totalCost={totalCost} otherCount={models.other?.keys ?? 0} />
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
          <div className="xl:col-span-3">
            <TopProjects topProjects={topProjects} totalCost={totalCost} />
          </div>
          <div className="xl:col-span-2">
            <TeamBreakdown memberRows={memberRows} memberCount={memberCount} activeUsers={cur.active_users} />
          </div>
        </div>

        <RecentEvents events={recent} />

      </div>
    </div>
  )
}
