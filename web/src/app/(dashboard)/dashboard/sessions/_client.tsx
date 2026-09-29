'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Search, ArrowUpDown, Terminal, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SessionSummary, SessionsMeta } from './page'

type SortKey = 'start' | 'durationMs' | 'prompts' | 'calls' | 'tokens' | 'cost' | 'cacheHitPct'

const PAGE = 100
const fmtUsd = (n: number) => n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`
const fmtTok = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`
const fmtDuration = (ms: number) => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const DAY_OPTIONS = [7, 30, 90]

export function SessionsClient({ sessions, meta }: { sessions: SessionSummary[]; meta: SessionsMeta }) {
  const router = useRouter()
  const pathname = usePathname()
  const go = (days: number, page = 1) => router.push(`${pathname}?days=${days}${page > 1 ? `&page=${page}` : ''}`)
  const pages = Math.max(1, Math.ceil(meta.total / meta.pageSize))
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ k: SortKey; asc: boolean }>({ k: 'start', asc: false })
  const [limit, setLimit] = useState(PAGE)

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = s ? sessions.filter(x =>
      x.id.toLowerCase().includes(s) || x.user.toLowerCase().includes(s) || x.repo.toLowerCase().includes(s) ||
      x.source.toLowerCase().includes(s) || x.models.some(m => m.model.toLowerCase().includes(s))) : sessions
    return [...list].sort((a, b) => {
      const va = a[sort.k] ?? -1, vb = b[sort.k] ?? -1
      const c = va < vb ? -1 : va > vb ? 1 : 0
      return sort.asc ? c : -c
    })
  }, [sessions, q, sort])

  const cols: { k: SortKey | null; label: string; right?: boolean }[] = [
    { k: 'start', label: 'Started' },
    { k: null, label: 'User' },
    { k: 'durationMs', label: 'Duration', right: true },
    { k: null, label: 'Models' },
    { k: 'prompts', label: 'Prompts', right: true },
    { k: 'calls', label: 'LLM calls', right: true },
    { k: 'tokens', label: 'Tokens', right: true },
    { k: 'cost', label: 'Cost', right: true },
    { k: 'cacheHitPct', label: 'Cache hit', right: true },
    { k: null, label: 'Source · repo' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[13px] text-[var(--fg-secondary)]">
            {meta.total.toLocaleString()} agent session{meta.total === 1 ? '' : 's'} · {meta.windowLabel}
          </p>
          <p className="text-[12px] text-[var(--fg-tertiary)] mt-0.5">
            All activity in this window: {meta.prompts.toLocaleString()} prompts · {meta.calls.toLocaleString()} LLM calls · {fmtUsd(meta.cost)} ({fmtUsd(meta.meteredCost)} metered · {fmtUsd(meta.notionalCost)} notional)
          </p>
          {meta.scopeNote && <p className="text-[12px] font-medium text-[var(--fg-secondary)] mt-1">{meta.scopeNote}</p>}
        </div>
        <div className="flex items-center gap-1 p-1 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl">
          {DAY_OPTIONS.map(d => (
            <button key={d} onClick={() => go(d)}
              className={cn('px-3 py-1 rounded-lg text-[12px] font-semibold transition-all',
                meta.days === d ? 'bg-white dark:bg-[#1e1e3a] text-[var(--fg)] shadow-sm' : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]')}>
              {d}D
            </button>
          ))}
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-12 text-center">
          <Terminal size={24} className="mx-auto mb-3 text-[var(--fg-tertiary)]" />
          <p className="text-[14px] font-semibold text-[var(--fg)]">No sessions · {meta.windowLabel}</p>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-[var(--fg-secondary)]">
            Sessions come from CLI-agent telemetry (Claude Code, Codex, Gemini CLI) that carries a session id. Run{' '}
            <code className="rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 font-mono text-[11.5px]">npx tokenfin@latest setup</code> and start a session.
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5">
          <div className="relative max-w-sm mb-4">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]" />
            <input value={q} onChange={e => { setQ(e.target.value); setLimit(PAGE) }}
              placeholder="Search this page: user, model, repo, source, session id…" className="input pl-8 text-[13px] py-2 w-full" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {cols.map(c => (
                    <th key={c.label} className={cn('py-2 px-2 first:pl-0 text-[10.5px] uppercase tracking-wide font-semibold text-[var(--fg-tertiary)] whitespace-nowrap', c.right ? 'text-right' : 'text-left')}>
                      {c.k ? (
                        <button onClick={() => setSort(s => ({ k: c.k!, asc: s.k === c.k ? !s.asc : false }))}
                          className={cn('inline-flex items-center gap-1 hover:text-[var(--fg)]', sort.k === c.k && 'text-[var(--fg)]')}>
                          {c.label}<ArrowUpDown size={10} />
                        </button>
                      ) : c.label}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map(s => (
                  <tr key={s.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-secondary)] group">
                    <td className="py-2 pr-2 whitespace-nowrap">
                      <Link href={`/dashboard/sessions/${encodeURIComponent(s.id)}`} className="font-semibold text-[var(--fg)] group-hover:text-coral">{fmtWhen(s.start)}</Link>
                      <p className="text-[10px] font-mono text-[var(--fg-tertiary)]">{s.id.slice(0, 12)}</p>
                    </td>
                    <td className="py-2 px-2 truncate max-w-[180px] text-[var(--fg-secondary)]">{s.user}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{fmtDuration(s.durationMs)}</td>
                    <td className="py-2 px-2">
                      <div className="flex flex-wrap gap-1">
                        {s.models.slice(0, 2).map(m => (
                          <span key={m.model} className="px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[10.5px] text-[var(--fg-secondary)] whitespace-nowrap">{m.model} ×{m.calls}</span>
                        ))}
                        {s.models.length > 2 && <span className="text-[10.5px] text-[var(--fg-tertiary)]">+{s.models.length - 2}</span>}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">{s.prompts}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{s.calls}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{fmtTok(s.tokens)}</td>
                    <td className="py-2 px-2 text-right tabular-nums font-semibold">{fmtUsd(s.cost)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{s.cacheHitPct == null ? '—' : `${s.cacheHitPct.toFixed(0)}%`}</td>
                    <td className="py-2 px-2 text-[var(--fg-secondary)] whitespace-nowrap">{s.source}{s.repo && <span className="text-[var(--fg-tertiary)]"> · {s.repo}</span>}</td>
                    <td className="py-2 pl-1"><Link href={`/dashboard/sessions/${encodeURIComponent(s.id)}`} aria-label="Open session"><ChevronRight size={13} className="text-[var(--fg-tertiary)] group-hover:text-coral" /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && <p className="py-6 text-center text-[12px] text-[var(--fg-tertiary)]">No sessions match “{q}”.</p>}
          {filtered.length > limit && (
            <div className="mt-3 text-center">
              <button onClick={() => setLimit(l => l + PAGE)} className="btn-secondary text-[12px]">Show more ({(filtered.length - limit).toLocaleString()} remaining)</button>
            </div>
          )}
          {pages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3 text-[12px] text-[var(--fg-secondary)]">
              <button disabled={meta.page <= 1} onClick={() => go(meta.days, meta.page - 1)} className="btn-secondary text-[12px] disabled:opacity-40">Newer</button>
              <span>Page {meta.page} of {pages}</span>
              <button disabled={meta.page >= pages} onClick={() => go(meta.days, meta.page + 1)} className="btn-secondary text-[12px] disabled:opacity-40">Older</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
