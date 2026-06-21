import { createClient }       from '@/lib/supabase/server'
import { createAdminClient }  from '@/lib/supabase/server'
import { AnalyticsClient }    from './_client'
import type { AnalyticsData, DayData, ModelSlice, ProjectSlice, PlatformSlice } from './_types'

export const metadata = { title: 'Analytics — TokenFin' }

const MODEL_COLORS = ['#D97757','#E8896A','#10A37F','#F0AC8A','#0D8A6A','#4285F4','#6B7280']

function fmtDay(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default async function AnalyticsPage() {
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
    { data: apiKeys  },
  ] = await Promise.all([
    admin.from('usage_agg')
      .select('bucket,model,project_id,total_tokens,cost_usd,request_count')
      .eq('org_id', orgId).gte('bucket', since30),
    admin.from('usage_agg')
      .select('bucket,model,project_id,total_tokens,cost_usd,request_count')
      .eq('org_id', orgId).gte('bucket', since60).lt('bucket', since30),
    admin.from('projects').select('id,name').eq('org_id', orgId),
    admin.from('api_keys').select('id,name,project_id').eq('org_id', orgId).eq('is_active', true),
  ])

  /* ── Daily totals (current) ── */
  const dayMap = new Map<string, { cost: number; tokens: number; calls: number }>()
  for (const r of curr ?? []) {
    const key = r.bucket.slice(0, 10)
    const e   = dayMap.get(key) ?? { cost: 0, tokens: 0, calls: 0 }
    e.cost   += Number(r.cost_usd      ?? 0)
    e.tokens += Number(r.total_tokens  ?? 0)
    e.calls  += Number(r.request_count ?? 0)
    dayMap.set(key, e)
  }

  /* ── Daily totals (prev period, offset by 30 days) ── */
  const prevDayMap = new Map<string, { cost: number; tokens: number; calls: number }>()
  for (const r of prev ?? []) {
    // Shift prev date forward 30 days so it aligns with the current period
    const shiftedDate = new Date(new Date(r.bucket).getTime() + 30 * 86400_000)
    const key = shiftedDate.toISOString().slice(0, 10)
    const e   = prevDayMap.get(key) ?? { cost: 0, tokens: 0, calls: 0 }
    e.cost   += Number(r.cost_usd      ?? 0)
    e.tokens += Number(r.total_tokens  ?? 0)
    e.calls  += Number(r.request_count ?? 0)
    prevDayMap.set(key, e)
  }

  /* ── Build sorted daily array ── */
  const sortedDays = Array.from(dayMap.entries()).sort(([a], [b]) => a.localeCompare(b))
  const avgCost    = sortedDays.length > 0
    ? sortedDays.reduce((s, [, v]) => s + v.cost, 0) / sortedDays.length
    : 0

  const daily: DayData[] = sortedDays.map(([dateStr, v]) => {
    const p = prevDayMap.get(dateStr) ?? { cost: 0, tokens: 0, calls: 0 }
    return {
      d:         fmtDay(dateStr),
      cost:      v.cost,
      prev:      p.cost,
      tok:       v.tokens / 1_000_000,
      prevTok:   p.tokens / 1_000_000,
      calls:     v.calls,
      prevCalls: p.calls,
      spike:     avgCost > 0 && v.cost > avgCost * 2.5,
    }
  })

  /* ── By model ── */
  const modelMap = new Map<string, { cost: number; tokens: number; calls: number }>()
  for (const r of curr ?? []) {
    const m = r.model ?? 'unknown'
    const e = modelMap.get(m) ?? { cost: 0, tokens: 0, calls: 0 }
    e.cost   += Number(r.cost_usd      ?? 0)
    e.tokens += Number(r.total_tokens  ?? 0)
    e.calls  += Number(r.request_count ?? 0)
    modelMap.set(m, e)
  }
  const totalCost = Array.from(modelMap.values()).reduce((s, v) => s + v.cost, 0)
  const byModel: ModelSlice[] = Array.from(modelMap.entries())
    .sort(([, a], [, b]) => b.cost - a.cost)
    .slice(0, 6)
    .map(([name, v], i) => ({
      name,
      color: MODEL_COLORS[i % MODEL_COLORS.length],
      cost:  v.cost,
      pct:   totalCost > 0 ? +(v.cost / totalCost * 100).toFixed(1) : 0,
    }))

  /* ── By project ── */
  const projMap   = new Map<string, { cost: number; calls: number }>()
  const projNames = new Map((projects ?? []).map(p => [p.id, p.name]))
  for (const r of curr ?? []) {
    const pid = r.project_id ?? '__none__'
    const e   = projMap.get(pid) ?? { cost: 0, calls: 0 }
    e.cost  += Number(r.cost_usd      ?? 0)
    e.calls += Number(r.request_count ?? 0)
    projMap.set(pid, e)
  }
  const byProject: ProjectSlice[] = Array.from(projMap.entries())
    .sort(([, a], [, b]) => b.cost - a.cost)
    .slice(0, 5)
    .map(([pid, v]) => ({
      name:  projNames.get(pid) ?? (pid === '__none__' ? 'Uncategorized' : pid.slice(0, 8)),
      cost:  v.cost,
      pct:   totalCost > 0 ? +(v.cost / totalCost * 100).toFixed(1) : 0,
      calls: v.calls,
    }))

  /* ── By platform (api_key name → aggregated project cost) ── */
  const platformColors = ['#D97757','#4285F4','#8B5CF6','#20B2AA','#F59E0B','#6B7280']
  const platformMap    = new Map<string, { cost: number; color: string }>()
  for (const key of apiKeys ?? []) {
    const projCost = projMap.get(key.project_id)?.cost ?? 0
    const name     = key.name ?? projNames.get(key.project_id) ?? key.id.slice(0, 8)
    if (!platformMap.has(name)) {
      const idx = platformMap.size
      platformMap.set(name, { cost: projCost, color: platformColors[idx % platformColors.length] })
    }
  }
  const byPlatform: PlatformSlice[] = Array.from(platformMap.entries())
    .sort(([, a], [, b]) => b.cost - a.cost)
    .slice(0, 5)
    .map(([name, v]) => ({
      name,
      cost:  v.cost,
      pct:   totalCost > 0 ? +(v.cost / totalCost * 100).toFixed(1) : 0,
      color: v.color,
    }))

  const totalPrev = Array.from(prevDayMap.values()).reduce((s, v) => s + v.cost, 0)

  const analyticsData: AnalyticsData = { daily, byModel, byProject, byPlatform, totalCost, totalPrev }

  return <AnalyticsClient initialData={analyticsData} />
}
