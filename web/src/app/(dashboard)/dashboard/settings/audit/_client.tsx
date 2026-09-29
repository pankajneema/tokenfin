'use client'
import { useCallback, useEffect, useState } from 'react'
import { ScrollText, Download } from 'lucide-react'
import { cn } from '@/lib/utils'

type Entry = {
  id: string; actor_email: string | null; action: string; target_type: string | null
  target_id: string | null; details: Record<string, unknown>; ip: string | null; created_at: string
}

const FILTERS: { label: string; value: string }[] = [
  { label: 'All',          value: '' },
  { label: 'API keys',     value: 'key.' },
  { label: 'Limits',       value: 'limit.' },
  { label: 'Members',      value: 'member.' },
  { label: 'Projects',     value: 'project.' },
  { label: 'Data',         value: 'data.' },
  { label: 'Integrations', value: 'integration.' },
  { label: 'Workspace',    value: 'org.' },
]

// Plain-language description of each action for the table.
const LABEL: Record<string, string> = {
  'key.create': 'Created API key', 'key.delete': 'Deleted API key', 'key.toggle': 'Enabled/disabled API key', 'key.reveal': 'Revealed API key',
  'limit.create': 'Created budget limit', 'limit.update': 'Changed budget limit', 'limit.delete': 'Deleted budget limit',
  'project.create': 'Created project', 'project.update': 'Changed project', 'project.delete': 'Deleted project',
  'team.create': 'Created team', 'team.update': 'Changed team', 'team.delete': 'Deleted team',
  'member.invite': 'Invited members', 'member.role_change': 'Changed member role', 'member.remove': 'Removed member',
  'org.update': 'Changed workspace settings', 'org.timezone': 'Changed time zone', 'org.privacy': 'Changed prompt capture',
  'allocation.create': 'Added an allocation rule', 'allocation.update': 'Changed an allocation rule', 'allocation.delete': 'Removed an allocation rule',
  'data.delete': 'Deleted monitoring data', 'data.retention': 'Changed data retention',
  'integration.connect': 'Connected integration', 'integration.disconnect': 'Disconnected integration',
  'provider.connect': 'Connected provider billing', 'provider.disconnect': 'Disconnected provider billing',
  'alert.create': 'Created alert rule', 'alert.update': 'Changed alert rule', 'alert.delete': 'Deleted alert rule',
  'price.update': 'Changed custom model prices',
}

const summarize = (d: Record<string, unknown>) =>
  Object.entries(d ?? {}).slice(0, 4).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')

export function AuditClient({ orgId, canView }: { orgId: string; canView: boolean }) {
  const [filter, setFilter]   = useState('')
  const [rows, setRows]       = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const load = useCallback(async (before?: string) => {
    setLoading(true); setError(null)
    const qs = new URLSearchParams({ org_id: orgId, limit: '100' })
    if (filter) qs.set('action', filter)
    if (before) qs.set('before', before)
    const res = await fetch(`/api/v1/audit?${qs}`)
    setLoading(false)
    if (!res.ok) { setError('Could not load the audit log.'); return }
    const data: Entry[] = await res.json()
    setRows(prev => before ? [...prev, ...data] : data)
    setHasMore(data.length === 100)
  }, [orgId, filter])

  useEffect(() => { if (canView) load() }, [canView, load])

  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [['time', 'who', 'action', 'target', 'details', 'ip'].join(',')]
    for (const r of rows) lines.push([r.created_at, r.actor_email, r.action, `${r.target_type ?? ''}:${r.target_id ?? ''}`, JSON.stringify(r.details), r.ip].map(esc).join(','))
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `tokenfin-audit-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  if (!canView) {
    return <p className="text-[13px] text-[var(--fg-secondary)]">Only workspace owners and admins can view the audit log.</p>
  }

  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <ScrollText size={15} className="text-[var(--fg-secondary)]" />
          <h2 className="text-[15px] font-bold text-[var(--fg)]">Audit log</h2>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map(f => (
            <button key={f.label} id={`audit-filter-${f.label}`} onClick={() => setFilter(f.value)}
              className={cn('px-2.5 py-1 rounded-lg text-[12px] border transition-colors',
                filter === f.value ? 'border-coral bg-coral/10 text-coral' : 'border-[var(--border)] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]')}>
              {f.label}
            </button>
          ))}
          <button onClick={exportCsv} disabled={rows.length === 0} className="btn-secondary text-[12px] disabled:opacity-50"><Download size={12} /> CSV</button>
        </div>
      </div>

      {error && <p className="px-5 py-4 text-[12.5px] text-[var(--red)]">{error}</p>}
      {!loading && !error && rows.length === 0 && (
        <p className="px-5 py-10 text-center text-[12.5px] text-[var(--fg-tertiary)]">
          No changes recorded yet. Key, limit, member, project, integration and data changes appear here.
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wide text-[var(--fg-tertiary)] border-b border-[var(--border)]">
                <th className="px-5 py-2.5 font-semibold">When</th>
                <th className="px-3 py-2.5 font-semibold">Who</th>
                <th className="px-3 py-2.5 font-semibold">What</th>
                <th className="px-3 py-2.5 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-[var(--border)] last:border-0 align-top">
                  <td className="px-5 py-2.5 whitespace-nowrap text-[var(--fg-secondary)] tabular-nums">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-[var(--fg)]">{r.actor_email ?? 'System'}</td>
                  <td className="px-3 py-2.5 text-[var(--fg)] font-medium whitespace-nowrap">{LABEL[r.action] ?? r.action}</td>
                  <td className="px-3 py-2.5 text-[var(--fg-tertiary)] break-all">{summarize(r.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && (
        <div className="px-5 py-3 border-t border-[var(--border)]">
          <button onClick={() => load(rows[rows.length - 1]?.created_at)} disabled={loading} className="btn-secondary text-[12px]">
            {loading ? 'Loading…' : 'Load older'}
          </button>
        </div>
      )}
    </div>
  )
}
