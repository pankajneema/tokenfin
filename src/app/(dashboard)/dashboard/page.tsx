import { createClient } from '@/lib/supabase/server'
import { StatsCards }    from '@/components/dashboard/stats-cards'
import { CostChart }     from '@/components/dashboard/cost-chart'
import { TeamBreakdown } from '@/components/dashboard/team-breakdown'
import { RecentEvents }  from '@/components/dashboard/recent-events'
import { AlertBanner }   from '@/components/dashboard/alert-banner'

export const metadata = { title: 'Overview' }

export default async function DashboardPage() {
  const supabase = createClient()
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: stats }, { data: chartRaw }, { data: events }, { data: members }] =
    await Promise.all([
      supabase.from('usage_events').select('total_tokens,cost_usd').gte('created_at', since),
      supabase.from('usage_agg').select('bucket,cost_usd,total_tokens')
        .gte('bucket', new Date(Date.now() - 14 * 86400_000).toISOString())
        .order('bucket', { ascending: true }),
      supabase.from('usage_events').select('id,model,total_tokens,cost_usd,created_at,tags')
        .order('created_at', { ascending: false }).limit(8),
      supabase.from('members').select('id').limit(100),
    ])

  const totalCost   = stats?.reduce((s, r) => s + (r.cost_usd ?? 0), 0) ?? 0
  const totalTokens = stats?.reduce((s, r) => s + (r.total_tokens ?? 0), 0) ?? 0
  const totalReqs   = stats?.length ?? 0

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="page-title">Overview</h1>
        <p className="text-sm text-[var(--fg-secondary)] mt-0.5">Last 30 days · All projects</p>
      </div>
      <AlertBanner />
      <StatsCards totalCost={totalCost} totalTokens={totalTokens} totalRequests={totalReqs} memberCount={members?.length ?? 0} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2"><CostChart data={chartRaw ?? []} /></div>
        <TeamBreakdown />
      </div>
      <RecentEvents events={events ?? []} />
    </div>
  )
}
