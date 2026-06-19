'use client'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { formatCost, formatTokens, formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'

/* ── Types ──────────────────────────────────────────────────── */
interface Event {
  id:           string
  model:        string
  total_tokens: number
  cost_usd:     number
  created_at:   string
  tags?:        Record<string, string>
  metadata?:    Record<string, unknown>
}

/* ── Provider theming ───────────────────────────────────────── */
type Provider = 'anthropic' | 'openai' | 'google' | 'other'

const PROV: Record<Provider, { bg: string; text: string; dot: string }> = {
  anthropic: { bg: 'bg-[var(--amber-bg)]',   text: 'text-[var(--amber)]',        dot: '#F5C842' },
  openai:    { bg: 'bg-[var(--green-bg)]',    text: 'text-[var(--green)]',        dot: '#00C48C' },
  google:    { bg: 'bg-[var(--blue-bg)]',     text: 'text-[var(--blue)]',         dot: '#60A5FA' },
  other:     { bg: 'bg-[var(--bg-tertiary)]', text: 'text-[var(--fg-secondary)]', dot: '#9898B0' },
}

function getProvider(model: string): Provider {
  if (model.startsWith('claude'))  return 'anthropic'
  if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) return 'openai'
  if (model.startsWith('gemini')) return 'google'
  return 'other'
}

function ModelBadge({ model }: { model: string }) {
  const s = PROV[getProvider(model)]
  const label = model.length > 22 ? model.slice(0, 20) + '…' : model
  return (
    <div className={cn('inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium font-mono', s.bg, s.text)}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.dot }} />
      {label}
    </div>
  )
}

function CostChip({ cost }: { cost: number }) {
  const level = cost >= 0.1 ? 'high' : cost >= 0.02 ? 'mid' : 'low'
  return (
    <span className={cn(
      'text-[12.5px] font-semibold tabular-nums',
      level === 'high' ? 'text-[var(--red)]' : level === 'mid' ? 'text-[var(--amber)]' : 'text-[var(--green)]',
    )}>
      {formatCost(cost)}
    </span>
  )
}

const ENV_BADGE: Record<string, string> = {
  prod:    'bg-[var(--red-bg)] text-[var(--red)]',
  staging: 'bg-[var(--amber-bg)] text-[var(--amber)]',
  dev:     'bg-[var(--bg-tertiary)] text-[var(--fg-secondary)]',
}

const DEMO: Event[] = [
  { id: '1', model: 'claude-sonnet-4-6', total_tokens: 12450, cost_usd: 0.1245, created_at: new Date(Date.now() -   120_000).toISOString(), tags: { env: 'prod', team: 'backend' } },
  { id: '2', model: 'gpt-4o',            total_tokens:  3200, cost_usd: 0.0512, created_at: new Date(Date.now() -   540_000).toISOString(), tags: { env: 'dev' } },
  { id: '3', model: 'claude-opus-4-8',   total_tokens:  8900, cost_usd: 0.2680, created_at: new Date(Date.now() - 1_200_000).toISOString(), tags: {} },
  { id: '4', model: 'claude-haiku-4-5',  total_tokens: 45000, cost_usd: 0.0056, created_at: new Date(Date.now() - 3_600_000).toISOString(), tags: { team: 'ml', env: 'prod' } },
  { id: '5', model: 'gemini-1.5-pro',    total_tokens:  6800, cost_usd: 0.0408, created_at: new Date(Date.now() - 7_200_000).toISOString(), tags: { env: 'staging' } },
]

function reltime(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60)    return `${Math.round(s)}s ago`
  if (s < 3600)  return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return formatDate(iso)
}

/* ═══════════════════════════════════════════════════════════════ */
export function RecentEvents({ events }: { events: Event[] }) {
  const rows = events.length ? events : DEMO

  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--fg)]">Recent Events</h2>
          <p className="text-[11.5px] text-[var(--fg-secondary)] mt-0.5">Latest API calls · real-time</p>
        </div>
        <Link href="/dashboard/analytics" className="flex items-center gap-1.5 text-[11.5px] text-coral font-medium hover:underline">
          View all <ArrowRight size={11} />
        </Link>
      </div>

      <div className="overflow-x-auto -mx-1">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {['Model', 'Tokens', 'Cost', 'Tags', 'Time'].map(h => (
                <th key={h} className="text-left px-3 pb-2.5 text-[10px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((ev, i) => (
              <tr
                key={ev.id}
                className={cn('hover:bg-[var(--bg-hover)] transition-colors', i < rows.length - 1 && 'border-b border-[var(--border)]')}
              >
                <td className="px-3 py-3"><ModelBadge model={ev.model} /></td>
                <td className="px-3 py-3 text-[12.5px] text-[var(--fg-secondary)] tabular-nums font-mono">{formatTokens(ev.total_tokens)}</td>
                <td className="px-3 py-3"><CostChip cost={ev.cost_usd} /></td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(ev.tags ?? {}).slice(0, 2).map(([k, v]) => (
                      <span key={k} className={cn('text-[10.5px] font-medium px-1.5 py-0.5 rounded-md font-mono', ENV_BADGE[v] ?? 'bg-[var(--bg-tertiary)] text-[var(--fg-secondary)]')}>
                        {k}:{v}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-3 text-[11.5px] text-[var(--fg-tertiary)] whitespace-nowrap">{reltime(ev.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
