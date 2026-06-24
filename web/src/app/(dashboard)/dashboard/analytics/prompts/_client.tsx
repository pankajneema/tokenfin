'use client'
import { useState, useMemo } from 'react'
import {
  Zap, Clock, DollarSign, Hash, ArrowUpDown,
  ArrowUp, ArrowDown, Info, Repeat2, AlertTriangle, TrendingUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PromptPattern } from './page'

/* ── Formatting helpers ──────────────────────────────────────────────────────── */
function fmtUsd(n: number) {
  if (n >= 1)   return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(3)}`
  return `$${n.toFixed(5)}`
}
function fmtMs(ms: number | null) {
  if (ms === null) return '—'
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms >= 1_000)  return `${(ms / 1000).toFixed(2)}s`
  return `${ms}ms`
}
function fmtNum(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toString()
}

/* ── Insight badges ──────────────────────────────────────────────────────────── */
function insights(p: PromptPattern) {
  const tags: { label: string; color: string; bg: string; tip: string }[] = []

  if (p.count >= 50)
    tags.push({ label: 'High volume', color: 'var(--blue)',  bg: 'var(--blue-bg)',  tip: `Sent ${p.count}× — consider caching` })
  if ((p.io_ratio ?? 0) > 3)
    tags.push({ label: 'Verbose',     color: 'var(--amber)', bg: 'var(--amber-bg)', tip: `I/O ratio ${p.io_ratio} — prompt may be too long` })
  if ((p.avg_latency_ms ?? 0) > 3000)
    tags.push({ label: 'Slow',        color: 'var(--red)',   bg: 'var(--red-bg)',   tip: `Avg ${fmtMs(p.avg_latency_ms)} — try a faster model` })
  if (p.avg_output_tokens < 20 && p.count >= 5)
    tags.push({ label: 'Low output',  color: 'var(--fg-secondary)', bg: 'var(--bg-tertiary)', tip: 'Very short output — may be errors or refusals' })

  return tags
}

/* ── Sort config ─────────────────────────────────────────────────────────────── */
type SortKey = 'total_cost_usd' | 'count' | 'avg_cost_usd' | 'avg_input_tokens' | 'avg_latency_ms'
type SortDir = 'asc' | 'desc'

const SORT_LABELS: Record<SortKey, string> = {
  total_cost_usd:   'Total cost',
  count:            'Requests',
  avg_cost_usd:     'Avg cost',
  avg_input_tokens: 'Avg tokens',
  avg_latency_ms:   'Avg latency',
}

/* ── Stat card ───────────────────────────────────────────────────────────────── */
function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string
  icon: React.ElementType; color: string
}) {
  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 flex items-start gap-4">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
        <Icon size={17} style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-[12px] text-[var(--fg-secondary)] font-medium">{label}</p>
        <p className="text-[20px] font-bold text-[var(--fg)] leading-tight tracking-tight mt-0.5">{value}</p>
        {sub && <p className="text-[11px] text-[var(--fg-tertiary)] mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

/* ── Column header with sort ─────────────────────────────────────────────────── */
function SortTh({ label, sk, active, dir, onSort }: {
  label: string; sk: SortKey; active: boolean; dir: SortDir; onSort: (k: SortKey) => void
}) {
  return (
    <th className="text-left">
      <button
        onClick={() => onSort(sk)}
        className={cn(
          'flex items-center gap-1 text-[11.5px] font-semibold uppercase tracking-wide transition-colors whitespace-nowrap',
          active ? 'text-[var(--fg)]' : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]'
        )}>
        {label}
        {active
          ? (dir === 'desc' ? <ArrowDown size={11} /> : <ArrowUp size={11} />)
          : <ArrowUpDown size={10} className="opacity-40" />}
      </button>
    </th>
  )
}

/* ── Model pill ──────────────────────────────────────────────────────────────── */
const MODEL_COLORS: Record<string, string> = {
  'gpt-4o': '#10A37F', 'gpt-4o-mini': '#0D8A6A',
  'claude-opus-4-8': '#D97757', 'claude-sonnet-4-6': '#E8896A',
  'claude-haiku-4-5': '#F0AC8A', 'claude-haiku-4-5-20251001': '#F0AC8A',
  'gemini-1.5-pro': '#4285F4', 'gemini-1.5-flash': '#669DF6',
}
function modelColor(m: string) {
  return MODEL_COLORS[m] ?? '#9898B0'
}

/* ══════════════════════════════════════════════════════════════════════════════ */

interface Props {
  patterns:        PromptPattern[]
  orgId:           string
  totalRequests:   number
  hashedRequests:  number
  totalCost:       number
  avgLatencyMs:    number | null
}

export function PromptsClient({
  patterns, totalRequests, hashedRequests, totalCost, avgLatencyMs,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('total_cost_usd')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [expanded, setExpanded] = useState<string | null>(null)

  function handleSort(k: SortKey) {
    if (k === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(k); setSortDir('desc') }
  }

  const sorted = useMemo(() => {
    return [...patterns].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity
      const bv = b[sortKey] ?? -Infinity
      return sortDir === 'desc'
        ? (bv as number) - (av as number)
        : (av as number) - (bv as number)
    })
  }, [patterns, sortKey, sortDir])

  const coverageP = totalRequests > 0
    ? Math.round((hashedRequests / totalRequests) * 100)
    : 0

  const verboseCount = patterns.filter(p => (p.io_ratio ?? 0) > 3).length
  const slowCount    = patterns.filter(p => (p.avg_latency_ms ?? 0) > 3000).length
  const highVolCount = patterns.filter(p => p.count >= 50).length

  /* ── Empty state ── */
  if (patterns.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Prompt Analytics</h1>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">Cost and latency patterns across your AI calls</p>
        </div>
        <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl py-20 flex flex-col items-center gap-4 text-center px-6">
          <div className="w-14 h-14 rounded-2xl bg-[var(--bg-secondary)] flex items-center justify-center">
            <Hash size={24} className="text-[var(--fg-tertiary)]" />
          </div>
          <div>
            <p className="text-[15px] font-semibold text-[var(--fg)]">No prompt data yet</p>
            <p className="text-[13px] text-[var(--fg-secondary)] mt-1 max-w-sm">
              Prompt analytics appear once your proxy sends events with metadata.
              Make sure you&apos;re on proxy version 1.1+.
            </p>
          </div>
          <a href="/dashboard/resources" className="btn-primary text-[13px]">
            View setup guide →
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Prompt Analytics</h1>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">
            Cost and latency patterns · last 30 days · {patterns.length} unique patterns
          </p>
        </div>
        {coverageP < 100 && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--amber-bg)] border border-[var(--amber)]/20 rounded-xl">
            <Info size={13} className="text-[var(--amber)] flex-shrink-0" />
            <p className="text-[12px] text-[var(--fg-secondary)]">
              {coverageP}% of requests have prompt fingerprints · update proxy to capture all
            </p>
          </div>
        )}
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Unique patterns"
          value={patterns.length.toString()}
          sub={`${hashedRequests.toLocaleString()} fingerprinted requests`}
          icon={Hash}
          color="var(--blue)"
        />
        <StatCard
          label="Total cost (30d)"
          value={fmtUsd(totalCost)}
          sub={`${fmtUsd(totalCost / Math.max(hashedRequests, 1))} avg per call`}
          icon={DollarSign}
          color="var(--green)"
        />
        <StatCard
          label="Avg latency"
          value={fmtMs(avgLatencyMs)}
          sub={`${slowCount} patterns > 3s`}
          icon={Clock}
          color="var(--amber)"
        />
        <StatCard
          label="Optimisation hints"
          value={(verboseCount + slowCount + highVolCount).toString()}
          sub={`${verboseCount} verbose · ${highVolCount} cacheable`}
          icon={TrendingUp}
          color="var(--red)"
        />
      </div>

      {/* ── Insight callouts ── */}
      {(highVolCount > 0 || verboseCount > 0 || slowCount > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {highVolCount > 0 && (
            <div className="flex items-start gap-3 p-4 bg-[var(--blue-bg)] border border-[var(--blue)]/20 rounded-2xl">
              <Repeat2 size={16} className="text-[var(--blue)] mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[13px] font-semibold text-[var(--fg)]">{highVolCount} high-volume pattern{highVolCount > 1 ? 's' : ''}</p>
                <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">
                  Sent 50+ times — caching identical prompts could cut cost significantly
                </p>
              </div>
            </div>
          )}
          {verboseCount > 0 && (
            <div className="flex items-start gap-3 p-4 bg-[var(--amber-bg)] border border-[var(--amber)]/20 rounded-2xl">
              <AlertTriangle size={16} className="text-[var(--amber)] mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[13px] font-semibold text-[var(--fg)]">{verboseCount} verbose pattern{verboseCount > 1 ? 's' : ''}</p>
                <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">
                  Input/output ratio &gt; 3 — prompts may be longer than needed
                </p>
              </div>
            </div>
          )}
          {slowCount > 0 && (
            <div className="flex items-start gap-3 p-4 bg-[var(--red-bg)] border border-[var(--red)]/20 rounded-2xl">
              <Clock size={16} className="text-[var(--red)] mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[13px] font-semibold text-[var(--fg)]">{slowCount} slow pattern{slowCount > 1 ? 's' : ''}</p>
                <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">
                  Average response &gt; 3s — switching model could improve latency
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Table ── */}
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-secondary)]">
                <th className="text-left px-5 py-3 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
                  Pattern
                </th>
                <SortTh label="Requests"    sk="count"            active={sortKey === 'count'}            dir={sortDir} onSort={handleSort} />
                <SortTh label="Total cost"  sk="total_cost_usd"   active={sortKey === 'total_cost_usd'}   dir={sortDir} onSort={handleSort} />
                <SortTh label="Avg cost"    sk="avg_cost_usd"     active={sortKey === 'avg_cost_usd'}     dir={sortDir} onSort={handleSort} />
                <SortTh label="Avg tokens"  sk="avg_input_tokens" active={sortKey === 'avg_input_tokens'} dir={sortDir} onSort={handleSort} />
                <SortTh label="Avg latency" sk="avg_latency_ms"   active={sortKey === 'avg_latency_ms'}   dir={sortDir} onSort={handleSort} />
                <th className="text-left px-5 py-3 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
                  Signals
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {sorted.map((p, i) => {
                const tags   = insights(p)
                const isOpen = expanded === p.hash

                return (
                  <>
                    <tr
                      key={p.hash}
                      onClick={() => setExpanded(isOpen ? null : p.hash)}
                      className={cn(
                        'cursor-pointer transition-colors',
                        isOpen
                          ? 'bg-[var(--bg-secondary)]'
                          : 'hover:bg-[var(--bg-secondary)]'
                      )}>
                      {/* Pattern */}
                      <td className="px-5 py-3.5 max-w-xs">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-[11px] text-[var(--fg-tertiary)] w-5 text-right tabular-nums flex-shrink-0">{i + 1}</span>
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: modelColor(p.top_model) }}
                          />
                          {p.prompt_preview ? (
                            <span className="text-[13px] text-[var(--fg)] truncate" title={p.prompt_preview}>
                              {p.prompt_preview}
                            </span>
                          ) : (
                            <code className="text-[11.5px] font-mono bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-md text-[var(--fg-secondary)] flex-shrink-0">
                              #{p.hash}
                            </code>
                          )}
                        </div>
                      </td>

                      {/* Requests */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[var(--blue)]"
                              style={{ width: `${Math.min(100, (p.count / (sorted[0]?.count ?? 1)) * 100)}%` }}
                            />
                          </div>
                          <span className="tabular-nums text-[var(--fg)] font-medium">{p.count.toLocaleString()}</span>
                        </div>
                      </td>

                      {/* Total cost */}
                      <td className="px-5 py-3.5 tabular-nums font-semibold text-[var(--fg)]">
                        {fmtUsd(p.total_cost_usd)}
                      </td>

                      {/* Avg cost */}
                      <td className="px-5 py-3.5 tabular-nums text-[var(--fg-secondary)]">
                        {fmtUsd(p.avg_cost_usd)}
                      </td>

                      {/* Avg tokens */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5 tabular-nums text-[var(--fg-secondary)]">
                          <span>{fmtNum(p.avg_input_tokens)}</span>
                          <span className="text-[var(--fg-tertiary)]">/</span>
                          <span>{fmtNum(p.avg_output_tokens)}</span>
                          {p.io_ratio !== null && (
                            <span className={cn(
                              'text-[10.5px] font-medium px-1 py-0.5 rounded ml-1',
                              p.io_ratio > 3
                                ? 'bg-[var(--amber-bg)] text-[var(--amber)]'
                                : 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]'
                            )}>
                              {p.io_ratio}:1
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Avg latency */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <span className={cn(
                            'tabular-nums font-medium',
                            (p.avg_latency_ms ?? 0) > 3000
                              ? 'text-[var(--red)]'
                              : (p.avg_latency_ms ?? 0) > 1500
                                ? 'text-[var(--amber)]'
                                : 'text-[var(--fg-secondary)]'
                          )}>
                            {fmtMs(p.avg_latency_ms)}
                          </span>
                          {p.p95_latency_ms !== null && p.p95_latency_ms !== p.avg_latency_ms && (
                            <span className="text-[10.5px] text-[var(--fg-tertiary)]">
                              p95 {fmtMs(p.p95_latency_ms)}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Signals */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {tags.length === 0
                            ? <span className="text-[11.5px] text-[var(--fg-tertiary)]">—</span>
                            : tags.map(t => (
                                <span
                                  key={t.label}
                                  title={t.tip}
                                  className="inline-flex text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md cursor-help"
                                  style={{ background: t.bg, color: t.color }}>
                                  {t.label}
                                </span>
                              ))
                          }
                        </div>
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isOpen && (
                      <tr key={`${p.hash}-detail`} className="bg-[var(--bg-secondary)]">
                        <td colSpan={7} className="px-8 pb-5 pt-2">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            {p.prompt_preview && (
                              <div className="col-span-2 sm:col-span-4 mb-1">
                                <p className="text-[11px] text-[var(--fg-tertiary)] font-medium uppercase tracking-wide mb-1">Prompt preview</p>
                                <p className="text-[12.5px] text-[var(--fg)] italic leading-relaxed">
                                  &ldquo;{p.prompt_preview}&rdquo;
                                </p>
                              </div>
                            )}
                            <div>
                              <p className="text-[11px] text-[var(--fg-tertiary)] font-medium uppercase tracking-wide mb-1">Top model</p>
                              <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: modelColor(p.top_model) }} />
                                <span className="text-[12.5px] text-[var(--fg)]">{p.top_model}</span>
                              </div>
                            </div>
                            <div>
                              <p className="text-[11px] text-[var(--fg-tertiary)] font-medium uppercase tracking-wide mb-1">Prompt size</p>
                              <p className="text-[12.5px] text-[var(--fg)]">
                                {p.prompt_chars > 0 ? `~${p.prompt_chars.toLocaleString()} chars` : '—'}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] text-[var(--fg-tertiary)] font-medium uppercase tracking-wide mb-1">P95 latency</p>
                              <p className="text-[12.5px] text-[var(--fg)]">{fmtMs(p.p95_latency_ms)}</p>
                            </div>
                            <div>
                              <p className="text-[11px] text-[var(--fg-tertiary)] font-medium uppercase tracking-wide mb-1">Cost share</p>
                              <p className="text-[12.5px] text-[var(--fg)]">
                                {totalCost > 0 ? `${((p.total_cost_usd / totalCost) * 100).toFixed(1)}% of total` : '—'}
                              </p>
                            </div>
                          </div>
                          {tags.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-[var(--border)]">
                              <p className="text-[11px] text-[var(--fg-tertiary)] font-medium uppercase tracking-wide mb-2">Optimisation notes</p>
                              <ul className="space-y-1">
                                {tags.map(t => (
                                  <li key={t.label} className="text-[12.5px] text-[var(--fg-secondary)] flex items-start gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: t.color }} />
                                    {t.tip}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--bg-secondary)]">
          <p className="text-[11.5px] text-[var(--fg-tertiary)]">
            Showing {sorted.length} pattern{sorted.length !== 1 ? 's' : ''} ·
            Preview shows first 120 chars of last user message ·
            Click a row to expand details
          </p>
        </div>
      </div>

    </div>
  )
}
