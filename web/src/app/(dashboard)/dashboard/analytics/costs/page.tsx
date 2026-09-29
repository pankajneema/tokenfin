import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext } from '@/lib/org-context'
import { dashSummary, dashBreakdown, NO_PROJECT_ID } from '@/lib/rollups'
import { resolveWindow, fmtDayLabel } from '@/lib/rollup-scope'
import { selectAllKeyset } from '@/lib/supabase/paginate'
import { CostsClient }       from './_client'
import type { DailyRow }     from './_client'

export const metadata = { title: 'Cost Reports — TokenFin Analytics' }
export const dynamic = 'force-dynamic'
export const revalidate = 0

const DAYS_OF_WEEK = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
/** Per-day "top model / top project" is picked among the period's top N by cost. */
const TOP_N = 8

export default async function CostsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx   = await requireOrgContext()
  const admin = createAdminClient()
  const orgId = ctx.orgId
  const win   = resolveWindow(await searchParams, ctx.timezone, { defaultDays: 30, allowed: [7, 30, 90] })

  const [cur, prev, models, projectsBd, { data: projects }, { data: promptDays }] = await Promise.all([
    dashSummary(admin, orgId, win.from, win.to),
    dashSummary(admin, orgId, win.prevFrom, win.prevTo),
    dashBreakdown(admin, orgId, win.from, win.to, 'model', undefined, TOP_N),
    dashBreakdown(admin, orgId, win.from, win.to, 'project', undefined, TOP_N),
    admin.from('projects').select('id,name').eq('org_id', orgId),
    // Distinct prompts per day: the rollup keeps one row per (day, prompt).
    selectAllKeyset<{ day: string; prompt_key: string }>(() => admin.from('usage_daily_prompts')
      .select('day,prompt_key').eq('org_id', orgId).gte('day', win.from).lte('day', win.to), ['day', 'prompt_key']),
  ])
  const projNames = new Map((projects ?? []).map(p => [p.id as string, p.name as string]))

  // Cost per day for each of the top models / projects → argmax per day.
  const [modelDays, projDays] = await Promise.all([
    Promise.all(models.rows.map(r => dashBreakdown(admin, orgId, win.from, win.to, 'day', { model: r.key }))),
    Promise.all(projectsBd.rows.map(r => dashBreakdown(admin, orgId, win.from, win.to, 'day', { project_id: r.key }))),
  ])
  const topPerDay = (keys: string[], perKey: typeof modelDays) => {
    const best = new Map<string, { key: string; cost: number }>()
    perKey.forEach((bd, i) => {
      for (const d of bd.rows) {
        const b = best.get(d.key)
        if (d.cost_usd > 0 && (!b || d.cost_usd > b.cost)) best.set(d.key, { key: keys[i], cost: d.cost_usd })
      }
    })
    return best
  }
  const topModel = topPerDay(models.rows.map(r => r.key), modelDays)
  const topProj  = topPerDay(projectsBd.rows.map(r => r.key), projDays)

  const promptsByDay = new Map<string, number>()
  for (const r of promptDays) {
    const d = String(r.day).slice(0, 10)
    promptsByDay.set(d, (promptsByDay.get(d) ?? 0) + 1)
  }

  const activeDays = cur.series.filter(p => p.cost_usd > 0 || p.requests > 0)
  const avgCost = activeDays.length > 0 ? activeDays.reduce((s, p) => s + p.cost_usd, 0) / activeDays.length : 0

  const rows: DailyRow[] = cur.series
    .map((p, i) => ({ p, prevCost: prev.series[i]?.cost_usd ?? 0 }))
    .filter(({ p }) => p.cost_usd > 0 || p.requests > 0)
    .map(({ p, prevCost }) => {
      const tp = topProj.get(p.day)?.key
      return {
        day:      p.day,
        date:     fmtDayLabel(p.day),
        dow:      DAYS_OF_WEEK[new Date(p.day + 'T00:00:00Z').getUTCDay()],
        cost:     p.cost_usd,
        metered:  p.metered_cost_usd,
        notional: p.notional_cost_usd,
        prev:     prevCost,
        tokens:   p.total_tokens / 1_000_000,
        calls:    p.requests,
        prompts:  promptsByDay.get(p.day) ?? 0,
        topModel: topModel.get(p.day)?.key ?? '',
        topProj:  !tp ? '' : tp === NO_PROJECT_ID ? 'Uncategorized' : projNames.get(tp) ?? tp.slice(0, 8),
        spike:    avgCost > 0 && p.cost_usd > avgCost * 2.5,
      }
    })

  return (
    <CostsClient
      rows={rows}
      days={win.days}
      windowLabel={win.label}
      orgId={orgId}
      totals={{
        cost: cur.cost_usd, metered: cur.metered_cost_usd, notional: cur.notional_cost_usd,
        prevCost: prev.cost_usd, prompts: cur.prompts,
      }}
    />
  )
}
