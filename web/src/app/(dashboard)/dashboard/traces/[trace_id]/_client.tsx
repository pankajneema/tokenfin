'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ArrowLeft, AlertTriangle, Layers } from 'lucide-react'
import { cn, formatCost, formatTokens } from '@/lib/utils'
import { fmtDuration } from '../_client'
import type { TreeRow } from '../_lib'

export interface DetailSpan {
  span_id: string
  parent_span_id: string | null
  name: string
  operation: string | null
  spanKind: string
  model: string | null
  provider: string | null
  service: string | null
  statusCode: number
  statusMessage: string | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  total_tokens: number
  cost: number
  start_time: string | null
  end_time: string | null
  duration_ms: number | null
  userEmail: string | null
  sessionId: string | null
  attributes: Record<string, unknown>
}

export interface TraceHeader {
  traceId: string
  name: string
  service: string | null
  start: string | null
  durationMs: number
  spanCount: number
  tokens: number
  cost: number
  errors: number
  models: string[]
  sessionId: string | null
  truncated: boolean
}

const INDENT = 14
/** Per-span costs are tiny — show them precisely rather than "<$0.01". */
const fmtUsd = (n: number) => (n > 0 && n < 0.01 ? `$${n.toFixed(5)}` : formatCost(n))
const LABEL_W = 300

/** Where a bar's duration label fits: after the bar, before it, or inside a wide bar. */
const labelPos = (r: { offsetPct: number; widthPct: number }) =>
  r.offsetPct + r.widthPct <= 80 ? 'after' : r.offsetPct >= 20 ? 'before' : 'inside'

function barColor(s: DetailSpan, aggregate: boolean) {
  if (s.statusCode === 2) return 'bg-[var(--red)]'
  if (s.total_tokens > 0 && !aggregate) return 'bg-teal'
  if (s.operation === 'execute_tool' || s.operation === 'tool') return 'bg-[var(--amber)]'
  return 'bg-[var(--blue)]'
}

export function TraceDetailClient({ header, rows, totalMs, timezone, contentHidden }: {
  header: TraceHeader
  rows: TreeRow<DetailSpan>[]
  t0: number
  totalMs: number
  timezone: string
  contentHidden: boolean
}) {
  const [selected, setSelected] = useState<string | null>(rows[0]?.span.span_id ?? null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const sel = rows.find(r => r.span.span_id === selected) ?? null

  // Hide descendants of collapsed spans (rows are in DFS order).
  const visible = useMemo(() => {
    const out: TreeRow<DetailSpan>[] = []
    let hideBelow: number | null = null
    for (const r of rows) {
      if (hideBelow != null && r.depth > hideBelow) continue
      hideBelow = collapsed.has(r.span.span_id) ? r.depth : null
      out.push(r)
    }
    return out
  }, [rows, collapsed])

  const toggle = (id: string) => setCollapsed(prev => {
    const n = new Set(prev)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const when = header.start ? new Intl.DateTimeFormat('en-US', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(header.start)) : '—'

  return (
    <div className="space-y-5">
      <div>
        <Link href="/dashboard/traces" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-teal"><ArrowLeft size={13} /> Traces</Link>
        <h2 className="text-[20px] font-bold tracking-tight text-[var(--fg)]">{header.name}</h2>
        <p className="mt-0.5 font-mono text-[11px] text-[var(--fg-tertiary)]">{header.traceId}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['Service', header.service ?? '—'],
          ['Started', when],
          ['Duration', fmtDuration(header.durationMs)],
          ['Spans', String(header.spanCount)],
          ['Tokens', formatTokens(header.tokens)],
          ['Cost', fmtUsd(header.cost)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-[var(--border)] bg-white px-3.5 py-2.5 dark:bg-[#141428]">
            <div className="text-[10.5px] uppercase tracking-wide text-[var(--fg-tertiary)]">{k}</div>
            <div className="mt-0.5 truncate text-[13.5px] font-semibold text-[var(--fg)]" title={v}>{v}</div>
          </div>
        ))}
      </div>
      {(header.errors > 0 || header.models.length > 0 || header.sessionId || header.truncated || contentHidden) && (
        <div className="flex flex-wrap gap-2 text-[11.5px]">
          {header.errors > 0 && <span className="inline-flex items-center gap-1 rounded-md bg-[var(--red-bg)] px-2 py-0.5 text-[var(--red)]"><AlertTriangle size={11} /> {header.errors} error span{header.errors === 1 ? '' : 's'}</span>}
          {header.models.map(m => <span key={m} className="rounded-md bg-[var(--bg-secondary)] px-2 py-0.5 font-mono text-[var(--fg-secondary)]">{m}</span>)}
          {header.sessionId && <span className="rounded-md bg-[var(--bg-secondary)] px-2 py-0.5 text-[var(--fg-secondary)]">session <span className="font-mono">{header.sessionId}</span></span>}
          {header.truncated && <span className="rounded-md bg-[var(--amber-bg)] px-2 py-0.5 text-[var(--amber)]">Showing the first 5,000 spans</span>}
          {contentHidden && <span className="rounded-md bg-[var(--bg-secondary)] px-2 py-0.5 text-[var(--fg-tertiary)]">Prompt content hidden (not your trace)</span>}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Waterfall */}
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white dark:bg-[#141428]">
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div className="flex border-b border-[var(--border)] text-[10.5px] text-[var(--fg-tertiary)]">
                <div className="shrink-0 px-3 py-2 font-medium uppercase tracking-wide" style={{ width: LABEL_W }}>Span</div>
                <div className="relative mr-4 flex-1 py-2">
                  {ticks.map(t => (
                    <span key={t} className="absolute top-2 -translate-x-1/2 tabular-nums" style={{ left: `${t * 100}%` }}>
                      {t === 0 ? '0' : fmtDuration(totalMs * t)}
                    </span>
                  ))}
                </div>
              </div>
              {visible.map(r => {
                const s = r.span
                const active = s.span_id === selected
                return (
                  <button key={s.span_id} onClick={() => setSelected(s.span_id)}
                    className={cn('flex w-full items-center border-b border-[var(--border)] text-left text-[11.5px] last:border-0 hover:bg-[var(--bg-secondary)]',
                      active && 'bg-[var(--bg-secondary)]')}>
                    <div className="flex shrink-0 items-center gap-1 overflow-hidden px-3 py-1.5" style={{ width: LABEL_W, paddingLeft: 12 + r.depth * INDENT }}>
                      {r.childCount > 0 ? (
                        <span role="button" tabIndex={-1} aria-label={collapsed.has(s.span_id) ? 'Expand' : 'Collapse'}
                          onClick={e => { e.stopPropagation(); toggle(s.span_id) }}
                          className="w-3 shrink-0 text-[10px] text-[var(--fg-tertiary)] hover:text-[var(--fg)]">
                          {collapsed.has(s.span_id) ? '▸' : '▾'}
                        </span>
                      ) : <span className="w-3 shrink-0" />}
                      {s.statusCode === 2 && <AlertTriangle size={11} className="shrink-0 text-[var(--red)]" />}
                      <span className="truncate font-medium text-[var(--fg)]" title={s.name}>{s.name}</span>
                      {s.total_tokens > 0 && (
                        <span className="ml-auto shrink-0 pl-2 tabular-nums text-[10.5px] text-[var(--fg-tertiary)]" title={r.aggregate ? 'Aggregate of child spans — not counted again' : undefined}>
                          {r.aggregate && 'Σ '}{formatTokens(s.total_tokens)}
                        </span>
                      )}
                    </div>
                    <div className="relative mr-4 h-6 flex-1">
                      <div className={cn('absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm', barColor(s, r.aggregate), r.aggregate && 'opacity-50')}
                        style={{ left: `${r.offsetPct}%`, width: `${r.widthPct}%` }} />
                      <span className={cn('absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] tabular-nums',
                          labelPos(r) === 'inside' ? 'pl-1.5 font-medium text-white' : 'text-[var(--fg-tertiary)]')}
                        style={labelPos(r) === 'after' ? { left: `${r.offsetPct + r.widthPct}%`, paddingLeft: 4 }
                          : labelPos(r) === 'before' ? { right: `${100 - r.offsetPct}%`, paddingRight: 4 }
                          : { left: `${r.offsetPct}%` }}>
                        {fmtDuration(r.durMs)}{s.cost > 0 && !r.aggregate ? ` · ${fmtUsd(s.cost)}` : ''}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex flex-wrap gap-3 border-t border-[var(--border)] px-3 py-2 text-[10.5px] text-[var(--fg-tertiary)]">
            <Legend cls="bg-teal" label="LLM call (counted)" />
            <Legend cls="bg-[var(--blue)] opacity-80" label="Other span" />
            <Legend cls="bg-[var(--amber)]" label="Tool" />
            <Legend cls="bg-[var(--red)]" label="Error" />
            <span>Σ = aggregate of child LLM calls (not counted twice)</span>
          </div>
        </div>

        {/* Span panel */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-4 dark:bg-[#141428] xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
          {!sel ? <p className="text-[12.5px] text-[var(--fg-tertiary)]">Select a span.</p> : <SpanPanel row={sel} />}
        </div>
      </div>
    </div>
  )
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={cn('inline-block h-2 w-3 rounded-sm', cls)} />{label}</span>
}

function SpanPanel({ row }: { row: TreeRow<DetailSpan> }) {
  const s = row.span
  const facts: Array<[string, string | null]> = [
    ['Operation', s.operation], ['Kind', s.spanKind], ['Service', s.service], ['Model', s.model], ['Provider', s.provider],
    ['Duration', fmtDuration(row.durMs)], ['Starts at', `+${fmtDuration(row.startMs)}`], ['User', s.userEmail], ['Session', s.sessionId],
  ]
  const attrs = Object.entries(s.attributes).sort(([a], [b]) => a.localeCompare(b))
  return (
    <div className="space-y-4 text-[12px]">
      <div>
        <div className="flex items-center gap-1.5 text-[14px] font-semibold text-[var(--fg)]"><Layers size={14} className="text-teal" /> <span className="break-all">{s.name}</span></div>
        <div className="mt-0.5 font-mono text-[10.5px] text-[var(--fg-tertiary)]">span {s.span_id}{s.parent_span_id ? ` · parent ${s.parent_span_id}` : ''}</div>
      </div>

      {s.statusCode === 2 && (
        <div className="rounded-lg bg-[var(--red-bg)] px-3 py-2 text-[var(--red)]">
          <div className="font-semibold">Error</div>
          {s.statusMessage && <div className="mt-0.5 break-words">{s.statusMessage}</div>}
        </div>
      )}

      {s.total_tokens > 0 && (
        <div className="rounded-xl bg-[var(--bg-secondary)] p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[10.5px] uppercase tracking-wide text-[var(--fg-tertiary)]">Tokens &amp; cost</span>
            <span className="text-[14px] font-semibold text-[var(--fg)]">{fmtUsd(s.cost)}</span>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
            {([
              ['Input (uncached)', s.input_tokens], ['Output', s.output_tokens], ['Cache read', s.cache_read_tokens],
              ['Cache write', s.cache_write_tokens], ['Reasoning', s.reasoning_tokens], ['Total', s.total_tokens],
            ] as Array<[string, number]>).filter(([k, v]) => v > 0 || ['Input (uncached)', 'Output', 'Total'].includes(k)).map(([k, v]) => (
              <div key={k} className="flex justify-between"><dt className="text-[var(--fg-tertiary)]">{k}</dt><dd className="text-[var(--fg)]">{v.toLocaleString()}</dd></div>
            ))}
          </dl>
          {row.aggregate && <p className="mt-2 text-[11px] text-[var(--fg-tertiary)]">Aggregate of its child LLM calls — counted once, on the children.</p>}
        </div>
      )}

      <dl className="space-y-1">
        {facts.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="flex gap-3"><dt className="w-20 shrink-0 text-[var(--fg-tertiary)]">{k}</dt><dd className="min-w-0 break-all text-[var(--fg)]">{v}</dd></div>
        ))}
      </dl>

      <div>
        <div className="mb-1.5 text-[10.5px] uppercase tracking-wide text-[var(--fg-tertiary)]">Attributes (redacted)</div>
        {attrs.length === 0 ? <p className="text-[var(--fg-tertiary)]">None.</p> : (
          <div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {attrs.map(([k, v]) => (
              <div key={k} className="px-2.5 py-1.5">
                <div className="break-all font-mono text-[10.5px] text-[var(--fg-tertiary)]">{k}</div>
                <div className="whitespace-pre-wrap break-all font-mono text-[11px] text-[var(--fg)]">{typeof v === 'string' ? v : JSON.stringify(v)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
