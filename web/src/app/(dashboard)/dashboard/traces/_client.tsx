'use client'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useTransition } from 'react'
import { Waypoints, AlertTriangle, ChevronRight } from 'lucide-react'
import { cn, formatCost, formatTokens } from '@/lib/utils'

export interface TraceListRow {
  traceId: string
  name: string
  service: string | null
  start: string
  durationMs: number | null
  spans: number
  tokens: number
  cost: number
  errors: number
  models: string[]
}

export interface TraceFilters {
  service: string
  model: string
  status: '' | 'error' | 'ok'
  range: string
}

export const fmtDuration = (ms: number | null) => {
  if (ms == null) return '—'
  if (ms < 1) return `${ms.toFixed(2)}ms`
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

const selectCls = 'rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12.5px] text-[var(--fg)] outline-none focus:border-[var(--border-strong)]'

export function TracesClient(props: {
  rows: TraceListRow[]
  filters: TraceFilters
  nextCursor: string | null
  paged: boolean
  hasAnyTrace: boolean
  /** organizations.trace_capture === 'all' (else only traces with errors / warnings keep full detail) */
  captureAll?: boolean
  services: string[]
  models: string[]
  ranges: { value: string; label: string }[]
  timezone: string
  scopedToSelf: boolean
  appUrl: string
}) {
  const { rows, filters, nextCursor, paged, hasAnyTrace, services, models, ranges, timezone, scopedToSelf, appUrl, captureAll } = props
  const router = useRouter()
  const pathname = usePathname()
  const [pending, start] = useTransition()

  const hrefWith = (patch: Partial<TraceFilters> & { cursor?: string | null }) => {
    const next = { ...filters, ...patch }
    const q = new URLSearchParams()
    if (next.service) q.set('service', next.service)
    if (next.model) q.set('model', next.model)
    if (next.status) q.set('status', next.status)
    if (next.range && next.range !== '7d') q.set('range', next.range)
    if (patch.cursor) q.set('cursor', patch.cursor)
    const s = q.toString()
    return s ? `${pathname}?${s}` : pathname
  }
  const setFilter = (patch: Partial<TraceFilters>) => start(() => router.push(hrefWith({ ...patch, cursor: null })))

  const fmtWhen = (iso: string) => new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
  }).format(new Date(iso))

  const filtered = !!(filters.service || filters.model || filters.status)

  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-[22px] font-bold tracking-tight text-[var(--fg)]"><Waypoints size={19} className="text-teal" /> Traces</h2>
        <p className="mt-0.5 text-[13px] text-[var(--fg-secondary)]">
          OpenTelemetry GenAI traces from your apps and agents · times in {timezone}
          {scopedToSelf && ' · showing your traces and unattributed service traces'}
        </p>
        <p className="mt-1 text-[12px] text-[var(--fg-tertiary)]">
          {captureAll
            ? 'Capturing every trace in full.'
            : <>Only traces with an error or warning are kept in full; the cost of every trace is still counted. Capture all traces in <a href="/dashboard/settings/workspace" className="text-teal hover:underline">Settings → Workspace</a>.</>}
        </p>
      </div>

      {!hasAnyTrace ? <EmptyState appUrl={appUrl} /> : (
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5 dark:bg-[#141428]">
          <div className={cn('mb-4 flex flex-wrap items-center gap-2', pending && 'opacity-60')}>
            <select aria-label="Time range" value={filters.range} onChange={e => setFilter({ range: e.target.value })} className={selectCls}>
              {ranges.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <select aria-label="Service" value={filters.service} onChange={e => setFilter({ service: e.target.value })} className={selectCls}>
              <option value="">All services</option>
              {Array.from(new Set([...services, filters.service].filter(Boolean))).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select aria-label="Model" value={filters.model} onChange={e => setFilter({ model: e.target.value })} className={selectCls}>
              <option value="">All models</option>
              {Array.from(new Set([...models, filters.model].filter(Boolean))).map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select aria-label="Status" value={filters.status} onChange={e => setFilter({ status: e.target.value as TraceFilters['status'] })} className={selectCls}>
              <option value="">Any status</option>
              <option value="error">With errors</option>
              <option value="ok">No errors</option>
            </select>
            {filtered && (
              <button onClick={() => setFilter({ service: '', model: '', status: '' })} className="text-[12px] text-[var(--fg-tertiary)] hover:text-[var(--fg)]">Clear filters</button>
            )}
          </div>

          {rows.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-[var(--fg-secondary)]">
              {paged ? 'No older traces.' : 'No traces match these filters in this range.'}
            </p>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[820px] text-[12.5px]">
                <thead className="text-[11px] uppercase tracking-wide text-[var(--fg-tertiary)]">
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-5 py-2 text-left font-medium">Trace</th>
                    <th className="px-3 py-2 text-left font-medium">Service</th>
                    <th className="px-3 py-2 text-left font-medium">Started</th>
                    <th className="px-3 py-2 text-right font-medium">Duration</th>
                    <th className="px-3 py-2 text-right font-medium">Spans</th>
                    <th className="px-3 py-2 text-right font-medium">Tokens</th>
                    <th className="px-3 py-2 text-right font-medium">Cost</th>
                    <th className="px-3 py-2 text-right font-medium">Errors</th>
                    <th className="w-6" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(t => (
                    <tr key={t.traceId} className="group border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-secondary)]">
                      <td className="max-w-[280px] px-5 py-2.5">
                        <Link href={`/dashboard/traces/${t.traceId}`} className="block">
                          <span className="block truncate font-medium text-[var(--fg)] group-hover:text-teal">{t.name}</span>
                          <span className="block truncate font-mono text-[10.5px] text-[var(--fg-tertiary)]">
                            {t.traceId.slice(0, 16)}{t.models.length ? ` · ${t.models.slice(0, 2).join(', ')}${t.models.length > 2 ? ` +${t.models.length - 2}` : ''}` : ''}
                          </span>
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[var(--fg-secondary)]">{t.service ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[var(--fg-secondary)]">{fmtWhen(t.start)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--fg-secondary)]">{fmtDuration(t.durationMs)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--fg-secondary)]">{t.spans}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--fg-secondary)]">{t.tokens ? formatTokens(t.tokens) : '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--fg)]">{t.cost ? formatCost(t.cost) : '—'}</td>
                      <td className="px-3 py-2.5 text-right">
                        {t.errors > 0
                          ? <span className="inline-flex items-center gap-1 rounded-md bg-[var(--red-bg)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--red)]"><AlertTriangle size={11} />{t.errors}</span>
                          : <span className="text-[var(--fg-tertiary)]">0</span>}
                      </td>
                      <td className="pr-4 text-[var(--fg-tertiary)]"><ChevronRight size={14} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between text-[12.5px]">
            <span className="text-[var(--fg-tertiary)]">{rows.length} trace{rows.length === 1 ? '' : 's'} on this page</span>
            <div className="flex gap-2">
              {paged && <Link href={hrefWith({ cursor: null })} className="btn-secondary rounded-lg px-3 py-1.5">Newest</Link>}
              {nextCursor && <Link href={hrefWith({ cursor: nextCursor })} className="btn-secondary rounded-lg px-3 py-1.5">Older →</Link>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyState({ appUrl }: { appUrl: string }) {
  const endpoint = `${appUrl.replace(/\/$/, '')}/api/otel/v1/traces`
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border)] p-10">
      <Waypoints size={22} className="mx-auto mb-3 text-[var(--fg-tertiary)]" />
      <p className="text-center text-[14px] font-semibold text-[var(--fg)]">No traces yet</p>
      <p className="mx-auto mt-1 max-w-lg text-center text-[12.5px] leading-relaxed text-[var(--fg-secondary)]">
        Point any OpenTelemetry trace exporter (OTel SDK, OpenLLMetry, OpenInference) at TokenFin with an ingest key.
        LLM spans are priced and counted in your usage automatically.
      </p>
      <pre className="mx-auto mt-4 max-w-xl overflow-x-auto rounded-xl bg-[var(--bg-secondary)] p-4 font-mono text-[11.5px] leading-relaxed text-[var(--fg)]">{`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=${endpoint}
OTEL_EXPORTER_OTLP_TRACES_HEADERS="Authorization=Bearer tfk_…"
OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf   # or http/json`}</pre>
      <p className="mx-auto mt-3 max-w-lg text-center text-[12px] text-[var(--fg-tertiary)]">
        Create an ingest key under <Link href="/dashboard/keys" className="text-teal hover:underline">API keys</Link>. See docs/TRACES.md for
        Python / Node setup and the attribute mapping.
      </p>
    </div>
  )
}
