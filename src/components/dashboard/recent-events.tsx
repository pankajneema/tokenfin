'use client'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { formatCost, formatTokens, formatDate } from '@/lib/utils'

interface Event { id: string; model: string; total_tokens: number; cost_usd: number; created_at: string; tags?: Record<string, string> }

const MODEL_BADGE: Record<string, string> = {
  'gpt-4o':            'badge-blue',
  'claude-opus-4-8':   'badge-amber',
  'claude-sonnet-4-6': 'badge-green',
  'claude-haiku-4-5':  'badge-gray',
  'gemini-1.5-pro':    'badge-blue',
}

const DEMO: Event[] = [
  { id: '1', model: 'claude-sonnet-4-6', total_tokens: 12450, cost_usd: 0.0745, created_at: new Date(Date.now() - 120_000).toISOString(), tags: { env: 'prod' } },
  { id: '2', model: 'gpt-4o',            total_tokens: 3200,  cost_usd: 0.0512, created_at: new Date(Date.now() - 540_000).toISOString(), tags: { env: 'dev' } },
  { id: '3', model: 'claude-opus-4-8',   total_tokens: 8900,  cost_usd: 0.2680, created_at: new Date(Date.now() - 1_200_000).toISOString(), tags: {} },
  { id: '4', model: 'claude-haiku-4-5',  total_tokens: 45000, cost_usd: 0.0056, created_at: new Date(Date.now() - 3_600_000).toISOString(), tags: { team: 'ml' } },
]

function reltime(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return `${Math.round(s)}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return formatDate(iso)
}

export function RecentEvents({ events }: { events: Event[] }) {
  const rows = events.length ? events : DEMO
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-[var(--fg)]">Recent Events</h2>
        <Link href="/dashboard/analytics" className="text-xs text-coral hover:underline flex items-center gap-1">
          View all <ExternalLink size={11} />
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {['Model','Tokens','Cost','Tags','Time'].map(h => (
                <th key={h} className="text-left px-2 pb-2.5 label font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map(ev => (
              <tr key={ev.id} className="hover:bg-[var(--bg-hover)] transition-colors">
                <td className="px-2 py-2.5"><span className={`${MODEL_BADGE[ev.model] ?? 'badge-gray'} mono`}>{ev.model}</span></td>
                <td className="px-2 py-2.5 text-[var(--fg-secondary)] tabular-nums mono">{formatTokens(ev.total_tokens)}</td>
                <td className="px-2 py-2.5 text-[var(--fg)] font-medium tabular-nums">{formatCost(ev.cost_usd)}</td>
                <td className="px-2 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(ev.tags ?? {}).slice(0, 2).map(([k, v]) => (
                      <span key={k} className="badge-gray mono">{k}:{v}</span>
                    ))}
                  </div>
                </td>
                <td className="px-2 py-2.5 text-[var(--fg-tertiary)] text-xs whitespace-nowrap">{reltime(ev.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
