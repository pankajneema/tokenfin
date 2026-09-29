import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext } from '@/lib/org-context'
import { dashBreakdown } from '@/lib/rollups'
import { resolveWindow } from '@/lib/rollup-scope'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { shiftDay } from '@/lib/dates'
import {
  PRODUCTIVITY_COLUMNS, addRow, emptyTotals, sumProductivity,
  type ProductivityRow, type ProductivityTotals,
} from '@/components/dashboard/productivity-card'
import { ProductivityClient } from './_client'
import { loadMergedPrData } from '@/lib/connectors/merged-prs'

export const metadata = { title: 'Engineering impact — TokenFin' }
export const dynamic = 'force-dynamic'
export const revalidate = 0

export interface ImpactRow extends ProductivityTotals { key: string; label: string; sub: string; cost: number }
export interface ImpactDay { day: string; linesAdded: number; linesRemoved: number; commits: number; prs: number; cost: number }
export interface ImpactData {
  days: number
  totals: ProductivityTotals
  cost: number
  members: ImpactRow[]
  repos: ImpactRow[]
  daily: ImpactDay[]
}

const ALLOWED_DAYS = [7, 30, 90]
const NO_REPO = '(no repo)'
const UNATTRIBUTED = '__unattributed__'

export default async function ProductivityPage({ searchParams }: { searchParams?: Promise<{ days?: string }> }) {
  const sp    = await searchParams
  const ctx   = await requireOrgContext()
  const admin = createAdminClient()
  const orgId = ctx.orgId
  // Calendar-day window (org time zone): exactly `days` days, today included.
  const win   = resolveWindow(sp, ctx.timezone, { defaultDays: 30, allowed: ALLOWED_DAYS })
  const days  = win.days
  const sinceDay = win.from

  const [prodRows, costByMember, costByRepoBd, costByDayBd, { data: members }, { data: authData }] = await Promise.all([
    // productivity_daily has no `id`; page with a deterministic composite order.
    fetchAllRows<ProductivityRow>((from, to) => admin.from('productivity_daily')
      .select(PRODUCTIVITY_COLUMNS)
      .eq('org_id', orgId).gte('day', sinceDay)
      .order('day').order('user_key').order('repo')
      .range(from, to)).catch(() => [] as ProductivityRow[]),   // table missing → empty state
    // Cost from the rollups (metered + notional), keyed like the productivity rows.
    dashBreakdown(admin, orgId, win.from, win.to, 'member', undefined, 1000),
    dashBreakdown(admin, orgId, win.from, win.to, 'repo', undefined, 1000),
    dashBreakdown(admin, orgId, win.from, win.to, 'day'),
    admin.from('members').select('user_id').eq('org_id', orgId),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ])

  // Identity: resolve both sides to an org user_id when possible, else the lowercased email/user_key.
  const orgUserIds = new Set((members ?? []).map(m => m.user_id as string))
  const people = new Map<string, { name: string; email: string }>()
  const emailToUid = new Map<string, string>()
  for (const u of authData?.users ?? []) {
    if (!orgUserIds.has(u.id)) continue
    const email = (u.email ?? '').toLowerCase()
    people.set(u.id, { email, name: (u.user_metadata?.full_name as string | undefined) ?? email.split('@')[0] ?? 'Unknown' })
    if (email) emailToUid.set(email, u.id)
  }
  const personKey = (uid: string | null, email: string | null | undefined) => {
    if (uid && orgUserIds.has(uid)) return uid
    const e = (email ?? '').trim().toLowerCase()
    return (e && emailToUid.get(e)) || e || UNATTRIBUTED
  }

  // Cost by person / repo / day (rollup user_key = lower(email) else user id).
  const cost = costByDayBd.rows.reduce((s, r) => s + r.cost_usd, 0)
  const costByPerson = new Map<string, number>()
  for (const r of costByMember.rows) {
    const pk = personKey(r.key, r.key)
    costByPerson.set(pk, (costByPerson.get(pk) ?? 0) + r.cost_usd)
  }
  const costByRepo = new Map<string, number>()
  for (const r of costByRepoBd.rows) {
    const rk = r.key || NO_REPO
    costByRepo.set(rk, (costByRepo.get(rk) ?? 0) + r.cost_usd)
  }
  const costByDay = new Map(costByDayBd.rows.map(r => [r.key, r.cost_usd]))

  // Productivity by person / repo / day.
  const prodByPerson = new Map<string, ProductivityTotals>()
  const prodByRepo   = new Map<string, ProductivityTotals>()
  const prodByDay    = new Map<string, ProductivityTotals>()
  for (const r of prodRows) {
    const pk = personKey(r.user_id, r.user_key)
    prodByPerson.set(pk, addRow(prodByPerson.get(pk) ?? emptyTotals(), r))
    const rk = r.repo || NO_REPO
    prodByRepo.set(rk, addRow(prodByRepo.get(rk) ?? emptyTotals(), r))
    const d = String(r.day).slice(0, 10)
    prodByDay.set(d, addRow(prodByDay.get(d) ?? emptyTotals(), r))
  }

  // Tables only list people/repos that have productivity data (cost-only rows would be noise here).
  const memberRows: ImpactRow[] = Array.from(prodByPerson.entries()).map(([key, t]) => {
    const p = people.get(key)
    return {
      key, ...t, cost: costByPerson.get(key) ?? 0,
      label: p?.name ?? (key === UNATTRIBUTED ? 'Unattributed' : key),
      sub:   p?.email ?? (key === UNATTRIBUTED ? '' : 'not an org member'),
    }
  })
  const repoRows: ImpactRow[] = Array.from(prodByRepo.entries()).map(([key, t]) => ({
    key, ...t, cost: costByRepo.get(key) ?? 0, label: key, sub: '',
  }))

  const daily: ImpactDay[] = []
  for (let i = 0; i < days; i++) {
    const d = shiftDay(win.from, i)
    const t = prodByDay.get(d) ?? emptyTotals()
    daily.push({ day: d, linesAdded: t.linesAdded, linesRemoved: t.linesRemoved, commits: t.commits, prs: t.prs, cost: costByDay.get(d) ?? 0 })
  }

  const data: ImpactData = {
    days,
    totals: sumProductivity(prodRows),
    cost,
    members: memberRows,
    repos: repoRows,
    daily,
  }
  const prs = await loadMergedPrData(admin, orgId, days, people)
  return <ProductivityClient data={data} prs={prs} />
}
