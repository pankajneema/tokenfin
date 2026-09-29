/**
 * Price catalog findings for a workspace (server component — mount from a
 * server page.tsx only; it reads with the service-role client).
 *
 *   <PriceFindings orgId={orgId} />
 *
 * Shows open price_sync_findings (nightly /api/v1/cron/prices) for models this
 * workspace used in the last 7 days. Renders nothing when there are none or
 * before migration 014 is applied.
 */
import { AlertTriangle, Tag } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/server'

type Finding = {
  id: string; model: string; kind: 'price_mismatch' | 'unpriced_seen'
  ours: Record<string, number | undefined> & { fallback?: Record<string, number>; events_7d?: number }
  theirs: Record<string, number | string | string[] | null | undefined>
  first_seen: string; last_seen: string
}

const m = (v: unknown) => (typeof v === 'number' ? `$${+v.toFixed(4)}` : '—')

export async function PriceFindings({ orgId }: { orgId: string }) {
  if (!orgId) return null
  const { data, error } = await createAdminClient().from('price_sync_findings')
    .select('id, model, kind, ours, theirs, first_seen, last_seen')
    .contains('orgs', [orgId]).is('resolved_at', null)
    .order('kind', { ascending: false }).order('model').limit(50)
  if (error || !data || data.length === 0) return null
  const rows = data as Finding[]

  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-[var(--border)]">
        <AlertTriangle size={14} className="text-[var(--amber)]" />
        <h3 className="text-[13.5px] font-bold text-[var(--fg)]">Price checks</h3>
        <span className="text-[11.5px] text-[var(--fg-tertiary)]">
          Models you used this week whose price is missing or differs from the public LiteLLM catalog. Verify with the provider, then set a custom price.
        </span>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {rows.map(f => (
          <li key={f.id} className="px-5 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
            <Tag size={12} className="text-[var(--fg-tertiary)]" />
            <span className="font-mono text-[var(--fg)]">{f.model}</span>
            {f.kind === 'unpriced_seen' ? (
              <>
                <span className="px-1.5 py-0.5 rounded-md text-[10.5px] font-semibold bg-[var(--red-bg)] text-[var(--red)]">Unpriced</span>
                <span className="text-[var(--fg-secondary)]">
                  {f.ours.events_7d ?? 0} calls priced at the fallback rate
                  {typeof f.theirs.in === 'number' && <> · catalog lists {m(f.theirs.in)} in / {m(f.theirs.out)} out per 1M</>}
                </span>
              </>
            ) : (
              <>
                <span className="px-1.5 py-0.5 rounded-md text-[10.5px] font-semibold bg-[var(--amber-bg)] text-[var(--amber)]">Differs</span>
                <span className="text-[var(--fg-secondary)]">
                  ours {m(f.ours.in)} / {m(f.ours.out)} · catalog {m(f.theirs.in)} / {m(f.theirs.out)} per 1M
                  {Array.isArray(f.theirs.fields) && <> ({f.theirs.fields.join(', ')})</>}
                </span>
              </>
            )}
            <span className="ml-auto text-[11px] text-[var(--fg-tertiary)]">since {f.first_seen.slice(0, 10)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
