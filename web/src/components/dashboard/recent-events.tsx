'use client'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { formatCost, formatTokens, formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { TimeAgo } from '@/components/ui/time-ago'

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

const TOOL_LABEL: Record<string, string> = {
  codex:      'Codex',
  cursor:     'Cursor',
  cowork:     'Cowork',
  'claude-cli': 'Claude CLI',
  opencode:   'OpenCode',
  mcp:        'MCP',
  api:        'API',
}

function reltime(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60)    return `${Math.round(s)}s ago`
  if (s < 3600)  return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return formatDate(iso)
}

/* ═══════════════════════════════════════════════════════════════ */
export function RecentEvents({ events }: { events: Event[] }) {

  if (!events.length) {
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
        <p className="text-[12.5px] text-[var(--fg-tertiary)] text-center py-8">
          No events yet · send usage data via <code className="font-mono text-coral">POST /api/v1/ingest</code>
        </p>
      </div>
    )
  }

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
            {events.map((ev, i) => (
              <tr key={ev.id}
                className={cn('hover:bg-[var(--bg-hover)] transition-colors', i < events.length - 1 && 'border-b border-[var(--border)]')}>
                <td className="px-3 py-3"><ModelBadge model={ev.model} /></td>
                <td className="px-3 py-3 text-[12.5px] text-[var(--fg-secondary)] tabular-nums font-mono">{formatTokens(ev.total_tokens)}</td>
                <td className="px-3 py-3"><CostChip cost={ev.cost_usd} /></td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    {/* tool tag → "via Codex" badge */}
                    {ev.tags?.tool && (
                      <span className="text-[10.5px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--bg-tertiary)] text-[var(--fg-secondary)]">
                        via {TOOL_LABEL[ev.tags.tool] ?? ev.tags.tool}
                      </span>
                    )}
                    {/* env tag → coloured */}
                    {ev.tags?.env && (
                      <span className={cn('text-[10.5px] font-medium px-1.5 py-0.5 rounded-md', ENV_BADGE[ev.tags.env] ?? 'bg-[var(--bg-tertiary)] text-[var(--fg-secondary)]')}>
                        {ev.tags.env}
                      </span>
                    )}
                    {/* any other tags — skip internal keys */}
                    {Object.entries(ev.tags ?? {})
                      .filter(([k]) => k !== 'tool' && k !== 'env' && k !== 'source')
                      .slice(0, 1)
                      .map(([k, v]) => (
                        <span key={k} className="text-[10.5px] font-medium px-1.5 py-0.5 rounded-md font-mono bg-[var(--bg-tertiary)] text-[var(--fg-secondary)]">
                          {k}:{v}
                        </span>
                      ))}
                  </div>
                </td>
                <td className="px-3 py-3 text-[11.5px] text-[var(--fg-tertiary)] whitespace-nowrap"><TimeAgo value={ev.created_at} format={reltime} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
