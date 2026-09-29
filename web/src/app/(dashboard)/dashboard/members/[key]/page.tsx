import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext } from '@/lib/org-context'
import { promptScope } from '@/lib/rbac'
import { dashBreakdown, dashSessions, dashSummary } from '@/lib/rollups'
import { toZonedDate, shiftDay } from '@/lib/dates'
import { cleanFilterValue, sharePct } from '@/lib/explore'
import { loadLabeler } from '../../explore/_labels'
import { MemberClient, type MemberData } from './_client'

export const metadata = { title: 'Member — TokenFin' }
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function MemberPage({ params }: { params: Promise<{ key: string }> }) {
  const { key: raw } = await params
  let decoded: string
  try { decoded = decodeURIComponent(raw) } catch { notFound() }
  const key = cleanFilterValue('member', decoded)
  if (!key) notFound()

  const ctx = await requireOrgContext()
  // Owners/admins may open anyone; members/viewers only themselves.
  if (promptScope(ctx.role, ctx.user.id) !== null) {
    const own = [(ctx.user.email ?? '').toLowerCase(), ctx.user.id].filter(Boolean)
    if (!own.includes(key)) notFound()
  }

  const admin = createAdminClient()
  const today = toZonedDate(Date.now(), ctx.timezone)
  const from30 = shiftDay(today, -29)
  const mtdFrom = today.slice(0, 8) + '01'
  const f = { user_key: key }

  const [s30, mtd, models, projects, sessions, labeler] = await Promise.all([
    dashSummary(admin, ctx.orgId, from30, today, f),
    dashSummary(admin, ctx.orgId, mtdFrom, today, f),
    dashBreakdown(admin, ctx.orgId, from30, today, 'model', f, 25),
    dashBreakdown(admin, ctx.orgId, from30, today, 'project', f, 25),
    dashSessions(admin, ctx.orgId, from30, today, f, { limit: 25, order: 'recent' }),
    loadLabeler(admin, ctx.orgId, [key]),
  ])

  const slice = (b: typeof models, dim: 'model' | 'project') => b.rows.map(r => ({
    key: r.key,
    label: labeler.label(dim, r.key),
    metered_cost_usd: r.metered_cost_usd,
    notional_cost_usd: r.notional_cost_usd,
    total_tokens: r.total_tokens,
    requests: r.requests,
    share_pct: sharePct(r.cost_usd, s30.cost_usd),
  }))

  const data: MemberData = {
    key,
    label: labeler.memberLabel(key),
    isSelf: key === (ctx.user.email ?? '').toLowerCase() || key === ctx.user.id,
    timezone: ctx.timezone,
    from30, today, mtdFrom,
    mtd: { metered_cost_usd: mtd.metered_cost_usd, notional_cost_usd: mtd.notional_cost_usd, total_tokens: mtd.total_tokens, requests: mtd.requests },
    d30: {
      metered_cost_usd: s30.metered_cost_usd, notional_cost_usd: s30.notional_cost_usd, total_tokens: s30.total_tokens,
      requests: s30.requests, prompts: s30.prompts, sessions: s30.sessions, active_days: s30.active_days,
    },
    series: s30.series.map(p => ({
      day: p.day, cost_usd: p.cost_usd, metered_cost_usd: p.metered_cost_usd, notional_cost_usd: p.notional_cost_usd,
      total_tokens: p.total_tokens, requests: p.requests,
    })),
    models: slice(models, 'model'),
    projects: slice(projects, 'project'),
    sessions: {
      total: sessions.total,
      rows: sessions.rows.map(s => ({
        session_id: s.session_id, last_at: s.last_at, first_at: s.first_at, model: s.model, source: s.source, repo: s.repo,
        project: labeler.label('project', s.project_id), requests: s.requests, total_tokens: s.total_tokens, cost_usd: s.cost_usd,
      })),
    },
  }
  return <MemberClient data={data} />
}
