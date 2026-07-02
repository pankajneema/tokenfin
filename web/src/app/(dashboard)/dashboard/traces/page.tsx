import { createClient, createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Waypoints } from 'lucide-react'

export const metadata = { title: 'Traces — TokenFin' }

const fmtUsd = (n: number) => n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`
const fmtTok = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`

export default async function TracesPage() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: membership } = await admin
    .from('members').select('org_id').eq('user_id', user!.id).order('joined_at', { ascending: true }).limit(1)
  const orgId = membership?.[0]?.org_id ?? ''

  const { data: traces } = await admin
    .from('traces')
    .select('trace_id, name, span_count, total_tokens, cost_usd, start_time, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(50)

  const rows = traces ?? []

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-1 flex items-center gap-2 text-[19px] font-bold text-[var(--fg)]"><Waypoints size={18} className="text-teal" /> Traces</div>
      <p className="mb-6 text-[13px] text-[var(--fg-secondary)]">OpenTelemetry GenAI traces ingested at <code className="font-mono">/api/otel/v1/traces</code> (point any OTLP exporter here with your key).</p>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-10 text-center">
          <Waypoints size={22} className="mx-auto mb-3 text-[var(--fg-tertiary)]" />
          <p className="text-[14px] font-semibold text-[var(--fg)]">No traces yet</p>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] text-[var(--fg-secondary)]">
            Send OTLP traces to <code className="font-mono">/api/otel/v1/traces</code> with header <code className="font-mono">x-api-key: tfk_…</code>.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
          <table className="w-full text-[12.5px]">
            <thead className="bg-[var(--bg-secondary)] text-[var(--fg-tertiary)]">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Trace</th>
                <th className="px-4 py-2 text-right font-medium">Spans</th>
                <th className="px-4 py-2 text-right font-medium">Tokens</th>
                <th className="px-4 py-2 text-right font-medium">Cost</th>
                <th className="px-4 py-2 text-right font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(t => (
                <tr key={t.trace_id} className="border-t border-[var(--border)] hover:bg-[var(--bg-secondary)]">
                  <td className="px-4 py-2 font-medium text-[var(--fg)]">
                    <Link href={`/dashboard/traces/${t.trace_id}`} className="hover:text-teal">
                      {t.name} <span className="font-mono text-[10.5px] text-[var(--fg-tertiary)]">{t.trace_id.slice(0, 12)}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right text-[var(--fg-secondary)]">{t.span_count}</td>
                  <td className="px-4 py-2 text-right text-[var(--fg-secondary)]">{fmtTok(Number(t.total_tokens))}</td>
                  <td className="px-4 py-2 text-right text-[var(--fg)]">{fmtUsd(Number(t.cost_usd))}</td>
                  <td className="px-4 py-2 text-right text-[var(--fg-tertiary)]">{new Date(t.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
