import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext } from '@/lib/org-context'
import { promptScope } from '@/lib/rbac'
import { TracesClient, type TraceListRow, type TraceFilters } from './_client'
import { RANGES, RANGE_LABEL, asRange, cursorFilter, decodeCursor, encodeCursor, rangeStartIso } from './_lib'

export const metadata = { title: 'Traces — TokenFin' }
export const dynamic = 'force-dynamic'

const PAGE = 50
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

/**
 * Visibility: owners/admins see every trace. Members/viewers see traces
 * attributed to them (a span carried their email, or the key is theirs) plus
 * UNATTRIBUTED traces — most app traces come from a backend service and carry
 * no end user, so hiding them would leave the page empty for everyone but
 * admins. Traces attributed to another member stay hidden, and prompt content
 * on traces that aren't theirs is stripped on the detail page.
 */
export default async function TracesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const ctx = await requireOrgContext()
  const scope = promptScope(ctx.role, ctx.user.id)
  const admin = createAdminClient()

  const filters: TraceFilters = {
    service: one(sp.service).slice(0, 200),
    model: one(sp.model).slice(0, 200),
    status: ['error', 'ok'].includes(one(sp.status)) ? one(sp.status) as 'error' | 'ok' : '',
    range: asRange(one(sp.range) || '7d'),
  }
  const cursor = decodeCursor(one(sp.cursor))
  const since = rangeStartIso(asRange(filters.range), ctx.timezone)

  const base = () => {
    let q = admin.from('traces')
      .select('trace_id, name, service_name, start_time, duration_ms, span_count, total_tokens, cost_usd, error_count, models, user_id')
      .eq('org_id', ctx.orgId).gte('start_time', since)
      .eq('detail', true)   // cost-only skeleton traces (trace_capture = 'errors') aren't listed
    if (scope) q = q.or(`user_id.is.null,user_id.eq.${scope}`)
    if (filters.service) q = q.eq('service_name', filters.service)
    if (filters.model) q = q.contains('models', [filters.model])
    if (filters.status === 'error') q = q.gt('error_count', 0)
    if (filters.status === 'ok') q = q.eq('error_count', 0)
    return q
  }
  let list = base()
  if (cursor) list = list.or(cursorFilter(cursor))
  const [page, anyTrace, opts, orgRow] = await Promise.all([
    list.order('start_time', { ascending: false }).order('trace_id', { ascending: false }).limit(PAGE + 1),
    (scope ? admin.from('traces').select('trace_id').eq('org_id', ctx.orgId).or(`user_id.is.null,user_id.eq.${scope}`)
      : admin.from('traces').select('trace_id').eq('org_id', ctx.orgId)).limit(1),
    admin.rpc('trace_filter_options', { p_org: ctx.orgId, p_since: since }),
    admin.from('organizations').select('trace_capture').eq('id', ctx.orgId).maybeSingle(),
  ])
  const captureAll = (orgRow.data as { trace_capture?: string } | null)?.trace_capture === 'all'
  if (page.error) console.error('[traces] list failed:', page.error.message)

  const raw = (page.data ?? []) as Array<Record<string, any>>
  const hasMore = raw.length > PAGE
  const rows: TraceListRow[] = raw.slice(0, PAGE).map(t => ({
    traceId: t.trace_id, name: t.name ?? 'trace', service: t.service_name ?? null, start: t.start_time,
    durationMs: t.duration_ms != null ? Number(t.duration_ms) : null, spans: Number(t.span_count ?? 0),
    tokens: Number(t.total_tokens ?? 0), cost: Number(t.cost_usd ?? 0), errors: Number(t.error_count ?? 0),
    models: (t.models ?? []) as string[],
  }))
  const last = raw[PAGE - 1]
  const nextCursor = hasMore && last ? encodeCursor({ t: last.start_time, id: last.trace_id }) : null
  const o = (opts.data ?? {}) as { services?: string[]; models?: string[] }

  return (
    <TracesClient
      rows={rows}
      filters={filters}
      nextCursor={nextCursor}
      paged={!!cursor}
      hasAnyTrace={(anyTrace.data ?? []).length > 0}
      services={o.services ?? []}
      models={o.models ?? []}
      ranges={RANGES.map(r => ({ value: r, label: RANGE_LABEL[r] }))}
      timezone={ctx.timezone}
      scopedToSelf={!!scope}
      captureAll={captureAll}
      appUrl={process.env.NEXT_PUBLIC_APP_URL || 'https://your-tokenfin-host'}
    />
  )
}
