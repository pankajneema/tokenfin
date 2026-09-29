import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext } from '@/lib/org-context'
import { promptScope } from '@/lib/rbac'
import { fetchAllPages } from '@/lib/supabase/paginate'
import { sanitizeAttributes, SPAN_KIND_LABEL } from '@/lib/otlp/genai'
import { buildWaterfall } from '../_lib'
import { TraceDetailClient, type DetailSpan, type TraceHeader } from './_client'

export const metadata = { title: 'Trace — TokenFin' }
export const dynamic = 'force-dynamic'

const MAX_SPANS = 5000

function NotFound() {
  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/dashboard/traces" className="text-[12.5px] text-teal">← Traces</Link>
      <p className="mt-6 text-[13px] text-[var(--fg-secondary)]">Trace not found (or it belongs to another member).</p>
    </div>
  )
}

export default async function TraceDetail({ params }: { params: Promise<{ trace_id: string }> }) {
  const { trace_id } = await params
  const ctx = await requireOrgContext()
  const scope = promptScope(ctx.role, ctx.user.id)
  const admin = createAdminClient()

  const { data: trace } = await admin.from('traces').select('*').eq('org_id', ctx.orgId).eq('trace_id', trace_id).maybeSingle()
  // Members: own + unattributed traces only (see ../page.tsx).
  if (!trace || (scope && trace.user_id && trace.user_id !== scope)) return <NotFound />
  // Prompt content: admins, or the member the trace belongs to.
  const canSeeContent = !scope || trace.user_id === scope

  const { data: spanData, error } = await fetchAllPages<Record<string, any>>((from, to) => admin.from('spans')
    .select('span_id, parent_span_id, name, kind, span_kind, operation, model, provider, service_name, status_code, status_message, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, total_tokens, cost_usd, start_time, end_time, duration_ms, user_email, session_id, attributes')
    .eq('org_id', ctx.orgId).eq('trace_id', trace_id)
    .order('start_time', { ascending: true, nullsFirst: false }).order('span_id', { ascending: true })
    .range(from, to), 1000, MAX_SPANS)
  if (error) console.error('[traces] spans read:', String((error as any)?.message ?? error))

  const spans: DetailSpan[] = spanData.map(s => ({
    span_id: s.span_id, parent_span_id: s.parent_span_id, name: s.name ?? s.kind ?? 'span',
    operation: s.operation ?? null, spanKind: SPAN_KIND_LABEL[Number(s.span_kind ?? 0)] ?? 'unspecified',
    model: s.model ?? null, provider: s.provider ?? null, service: s.service_name ?? null,
    statusCode: Number(s.status_code ?? 0), statusMessage: s.status_message ?? null,
    input_tokens: Number(s.input_tokens ?? 0), output_tokens: Number(s.output_tokens ?? 0),
    cache_read_tokens: Number(s.cache_read_tokens ?? 0), cache_write_tokens: Number(s.cache_write_tokens ?? 0),
    reasoning_tokens: Number(s.reasoning_tokens ?? 0), total_tokens: Number(s.total_tokens ?? 0), cost: Number(s.cost_usd ?? 0),
    start_time: s.start_time, end_time: s.end_time, duration_ms: s.duration_ms != null ? Number(s.duration_ms) : null,
    userEmail: canSeeContent ? s.user_email ?? null : null, sessionId: s.session_id ?? null,
    // Re-sanitized on read: rows stored before migration 018 were not redacted,
    // and members don't see prompt content on traces that aren't theirs.
    attributes: sanitizeAttributes((s.attributes ?? {}) as Record<string, unknown>, canSeeContent),
  }))
  const { rows, t0, totalMs } = buildWaterfall(spans)

  const header: TraceHeader = {
    traceId: trace.trace_id, name: trace.name ?? 'trace', service: trace.service_name ?? null,
    start: trace.start_time, durationMs: trace.duration_ms != null ? Number(trace.duration_ms) : totalMs,
    spanCount: Number(trace.span_count ?? spans.length), tokens: Number(trace.total_tokens ?? 0),
    cost: Number(trace.cost_usd ?? 0), errors: Number(trace.error_count ?? 0), models: trace.models ?? [],
    sessionId: trace.session_id ?? null, truncated: spans.length >= MAX_SPANS,
  }

  return <TraceDetailClient header={header} rows={rows} t0={t0} totalMs={totalMs} timezone={ctx.timezone} contentHidden={!canSeeContent} />
}
