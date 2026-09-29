import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext } from '@/lib/org-context'
import { promptScope } from '@/lib/rbac'
import { dashBreakdown, dashSummary, type DashBreakdown, type DashFilters } from '@/lib/rollups'
import {
  parseExploreParams, resolveRange, toDashFilters, dimFilterKey, sharePct,
  FILTER_TO_DASH, FILTER_LABELS, type ExploreRow, type FilterKey,
} from '@/lib/explore'
import type { FilterField } from '@/components/filters'
import { loadLabeler } from './_labels'
import { ExploreClient } from './_client'
import type { ChartStack, ExploreData } from './_types'

export const metadata = { title: 'Explore — TokenFin' }
export const dynamic = 'force-dynamic'
export const revalidate = 0

const TABLE_LIMIT = 100
/** top rows that get a per-key dash_summary for the stacked chart */
const STACK_ROWS = 6
const OPTION_LIMIT = 200

type SP = Record<string, string | string[] | undefined>

export default async function ExplorePage({ searchParams }: { searchParams?: Promise<SP> }) {
  const ctx = await requireOrgContext()
  const admin = createAdminClient()
  const { state, errors } = parseExploreParams(await searchParams)
  const { from, to } = resolveRange(state, ctx.timezone)
  const filters = toDashFilters(state.filters)
  const fk = dimFilterKey(state.dim)

  // Filter dropdown options: every key seen in the range (unfiltered, so a
  // filter never hides its own alternatives).
  const optionDims = ['member', 'model', 'source', 'repo', 'agent'] as const
  const [summary, breakdown, ...optionBreakdowns] = await Promise.all([
    dashSummary(admin, ctx.orgId, from, to, filters),
    dashBreakdown(admin, ctx.orgId, from, to, state.dim, filters, TABLE_LIMIT),
    ...optionDims.map(d => dashBreakdown(admin, ctx.orgId, from, to, d, {}, OPTION_LIMIT)),
  ]) as [Awaited<ReturnType<typeof dashSummary>>, DashBreakdown, ...DashBreakdown[]]

  const memberKeys = [
    ...optionBreakdowns[0].rows.map(r => r.key),
    ...(state.dim === 'member' ? breakdown.rows.map(r => r.key) : []),
    ...(state.filters.member ? [state.filters.member] : []),
  ]
  const labeler = await loadLabeler(admin, ctx.orgId, memberKeys)

  // Per-key daily series for the stacked chart (top rows of filterable dims).
  // Prompt counts come straight from dash_breakdown (migration 019).
  const detailRows = fk ? breakdown.rows.filter(r => r.key !== '').slice(0, STACK_ROWS) : []
  const details = await Promise.all(detailRows.map(r => {
    const f: DashFilters = { ...filters, [FILTER_TO_DASH[fk as FilterKey]]: r.key }
    return dashSummary(admin, ctx.orgId, from, to, f)
  }))
  const detailByKey = new Map(detailRows.map((r, i) => [r.key, details[i]]))

  const totalCost = summary.cost_usd
  const rows: ExploreRow[] = breakdown.rows.map(r => {
    return {
      key: r.key,
      label: state.dim === 'day' ? r.key : labeler.label(state.dim, r.key),
      metered_cost_usd: r.metered_cost_usd,
      notional_cost_usd: r.notional_cost_usd,
      cost_usd: r.cost_usd,
      total_tokens: r.total_tokens,
      requests: r.requests,
      prompts: r.prompts ?? null,
      share_pct: sharePct(r.cost_usd, totalCost),
    }
  })

  const stacks: ChartStack[] | null = fk && detailRows.length
    ? detailRows.map(r => ({
        key: r.key,
        label: labeler.label(state.dim, r.key),
        points: (detailByKey.get(r.key)?.series ?? []).map(p => ({ day: p.day, cost_usd: p.cost_usd, total_tokens: p.total_tokens, requests: p.requests })),
      }))
    : null

  const optionsFor = (i: number, dim: 'member' | 'model' | 'source' | 'repo' | 'agent') =>
    optionBreakdowns[i].rows.filter(r => r.key !== '').map(r => ({ value: r.key, label: labeler.label(dim, r.key) }))
  const filterFields: FilterField[] = [
    { key: 'project', label: FILTER_LABELS.project, options: Array.from(labeler.projects.entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)) },
    { key: 'member', label: FILTER_LABELS.member, options: optionsFor(0, 'member') },
    { key: 'model', label: FILTER_LABELS.model, options: optionsFor(1, 'model') },
    { key: 'source', label: FILTER_LABELS.source, options: optionsFor(2, 'source') },
    { key: 'repo', label: FILTER_LABELS.repo, options: optionsFor(3, 'repo') },
    { key: 'agent', label: FILTER_LABELS.agent, options: optionsFor(4, 'agent') },
  ]

  const scope = promptScope(ctx.role, ctx.user.id)
  const memberLinkKeys = scope === null ? null : [(ctx.user.email ?? '').toLowerCase(), ctx.user.id].filter(Boolean)

  const data: ExploreData = {
    state, errors, from, to, timezone: ctx.timezone,
    totals: {
      metered_cost_usd: summary.metered_cost_usd,
      notional_cost_usd: summary.notional_cost_usd,
      total_tokens: summary.total_tokens,
      requests: summary.requests,
      prompts: summary.prompts,
      sessions: summary.sessions,
      active_users: summary.active_users,
    },
    rows,
    other: breakdown.other ? {
      keys: breakdown.other.keys,
      metered_cost_usd: breakdown.other.metered_cost_usd,
      notional_cost_usd: breakdown.other.notional_cost_usd,
      total_tokens: breakdown.other.total_tokens,
      requests: breakdown.other.requests,
    } : null,
    total: summary.series.map(p => ({
      day: p.day, cost_usd: p.cost_usd, metered_cost_usd: p.metered_cost_usd, notional_cost_usd: p.notional_cost_usd,
      total_tokens: p.total_tokens, requests: p.requests,
    })),
    stacks,
    filterFields,
    memberLinkKeys,
  }
  return <ExploreClient data={data} />
}
