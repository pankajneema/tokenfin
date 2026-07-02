import { createClient, createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export const metadata = { title: 'Trace — TokenFin' }

const fmtUsd = (n: number) => n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`
const fmtTok = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`
const ms = (a: string | null, b: string | null) => a && b ? Math.max(0, new Date(b).getTime() - new Date(a).getTime()) : 0

export default async function TraceDetail({ params }: { params: { trace_id: string } }) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: membership } = await admin
    .from('members').select('org_id').eq('user_id', user!.id).order('joined_at', { ascending: true }).limit(1)
  const orgId = membership?.[0]?.org_id ?? ''

  const { data: trace } = await admin.from('traces').select('*').eq('trace_id', params.trace_id).eq('org_id', orgId).maybeSingle()
  const { data: spanData } = await admin.from('spans').select('*').eq('trace_id', params.trace_id).eq('org_id', orgId)
  const spans = (spanData ?? []).slice().sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))

  if (!trace) {
    return <div className="mx-auto max-w-4xl"><Link href="/dashboard/traces" className="text-[12.5px] text-teal">← Traces</Link><p className="mt-6 text-[13px] text-[var(--fg-secondary)]">Trace not found.</p></div>
  }

  // Timeline bounds + depth (via parent chain) for the waterfall.
  const starts = spans.map(s => s.start_time ? new Date(s.start_time).getTime() : 0).filter(Boolean)
  const ends = spans.map(s => s.end_time ? new Date(s.end_time).getTime() : 0).filter(Boolean)
  const t0 = starts.length ? Math.min(...starts) : 0
  const t1 = ends.length ? Math.max(...ends) : t0 + 1
  const span = Math.max(1, t1 - t0)
  const byId = new Map(spans.map(s => [s.span_id, s]))
  const depth = (s: any): number => { let d = 0, cur = s; const seen = new Set<string>(); while (cur?.parent_span_id && byId.has(cur.parent_span_id) && !seen.has(cur.span_id)) { seen.add(cur.span_id); cur = byId.get(cur.parent_span_id); d++ } return Math.min(d, 6) }

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/dashboard/traces" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-teal"><ArrowLeft size={13} /> Traces</Link>
      <div className="mb-1 text-[18px] font-bold text-[var(--fg)]">{trace.name}</div>
      <div className="mb-5 text-[12px] text-[var(--fg-tertiary)]">
        <span className="font-mono">{trace.trace_id}</span> · {trace.span_count} spans · {fmtTok(Number(trace.total_tokens))} tokens · {fmtUsd(Number(trace.cost_usd))} · {ms(trace.start_time, trace.end_time)}ms
      </div>

      <div className="space-y-1.5 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
        {spans.map(s => {
          const off = ((s.start_time ? new Date(s.start_time).getTime() : t0) - t0) / span * 100
          const w = Math.max(1.5, ms(s.start_time, s.end_time) / span * 100)
          return (
            <div key={s.span_id} className="text-[11.5px]">
              <div className="flex items-center justify-between" style={{ paddingLeft: `${depth(s) * 14}px` }}>
                <span className="font-medium text-[var(--fg)]">{s.kind} <span className="text-[var(--fg-tertiary)]">{s.model ?? s.name}</span></span>
                <span className="text-[var(--fg-tertiary)]">{s.total_tokens ? fmtTok(Number(s.total_tokens)) + ' tok · ' : ''}{Number(s.cost_usd) ? fmtUsd(Number(s.cost_usd)) + ' · ' : ''}{ms(s.start_time, s.end_time)}ms</span>
              </div>
              <div className="mt-0.5 h-1.5 w-full rounded bg-[var(--bg-tertiary)]" style={{ paddingLeft: `${depth(s) * 14}px` }}>
                <div className="h-full rounded bg-teal/70" style={{ marginLeft: `${off}%`, width: `${w}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
