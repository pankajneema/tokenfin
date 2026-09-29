// Prompt-cache efficiency: pure helpers + a presentational card.
// No hooks and no 'use client' — importable from server pages (to compute) and
// from client components (to render).
import { Database } from 'lucide-react'
import { priceFor } from '@/lib/mcp/pricing'
import { formatCost, formatTokens } from '@/lib/utils'

export type CacheRow = {
  model: string | null
  input_tokens: number | string | null
  cache_read_tokens: number | string | null
  cache_write_tokens: number | string | null
}

export interface CacheSlice {
  model:       string
  input:       number   // uncached input tokens
  cacheRead:   number
  cacheWrite:  number
  hitPct:      number | null   // cacheRead / (input + cacheRead + cacheWrite) * 100
  savedUsd:    number   // cacheRead * (input price − cache read price) / 1e6
  writeCostUsd: number  // cacheWrite * cache write price / 1e6
}

export interface CacheStats {
  input:        number
  cacheRead:    number
  cacheWrite:   number
  hitPct:       number | null
  savedUsd:     number
  writeCostUsd: number
  byModel:      CacheSlice[]
}

const n = (v: number | string | null | undefined) => Number(v ?? 0) || 0

export const cacheHitPct = (input: number, read: number, write: number): number | null => {
  const denom = input + read + write
  return denom > 0 ? +((read / denom) * 100).toFixed(1) : null
}

/** Aggregate cache efficiency (org / user / session scope) from usage_events rows. */
export function computeCacheStats(rows: readonly CacheRow[]): CacheStats {
  const byModel = new Map<string, { input: number; cacheRead: number; cacheWrite: number }>()
  for (const r of rows) {
    const m = r.model || 'unknown'
    const e = byModel.get(m) ?? { input: 0, cacheRead: 0, cacheWrite: 0 }
    e.input += n(r.input_tokens); e.cacheRead += n(r.cache_read_tokens); e.cacheWrite += n(r.cache_write_tokens)
    byModel.set(m, e)
  }
  const slices: CacheSlice[] = Array.from(byModel.entries()).map(([model, e]) => {
    const p = priceFor(model)
    const readPrice  = p.cacheRead  ?? p.in * 0.1
    const writePrice = p.cacheWrite ?? p.in * 1.25
    return {
      model, ...e,
      hitPct:       cacheHitPct(e.input, e.cacheRead, e.cacheWrite),
      savedUsd:     Math.max(0, e.cacheRead * (p.in - readPrice) / 1e6),
      writeCostUsd: e.cacheWrite * writePrice / 1e6,
    }
  }).sort((a, b) => b.savedUsd - a.savedUsd || b.cacheRead - a.cacheRead)

  const input      = slices.reduce((s, x) => s + x.input, 0)
  const cacheRead  = slices.reduce((s, x) => s + x.cacheRead, 0)
  const cacheWrite = slices.reduce((s, x) => s + x.cacheWrite, 0)
  return {
    input, cacheRead, cacheWrite,
    hitPct:       cacheHitPct(input, cacheRead, cacheWrite),
    savedUsd:     slices.reduce((s, x) => s + x.savedUsd, 0),
    writeCostUsd: slices.reduce((s, x) => s + x.writeCostUsd, 0),
    byModel:      slices,
  }
}

const fmtUsd = formatCost
const fmtTok = formatTokens

/** Card: hit %, $ saved, write cost; optional per-model table. */
export function CacheEfficiency({ stats, showModels = false, title = 'Cache efficiency' }: {
  stats: CacheStats; showModels?: boolean; title?: string
}) {
  const hasData = stats.input + stats.cacheRead + stats.cacheWrite > 0
  const net = stats.savedUsd - stats.writeCostUsd
  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <Database size={14} className="text-teal" />
        <p className="text-[13px] font-bold text-[var(--fg)]">{title}</p>
      </div>
      <p className="text-[11px] text-[var(--fg-tertiary)] mb-4">
        Hit rate = cache-read tokens ÷ (input + cache read + cache write). Savings priced at list input vs cache-read rates.
      </p>
      {!hasData ? (
        <p className="text-[12px] text-[var(--fg-tertiary)] py-2">No input-token data yet — cache stats appear once usage with token breakdowns is ingested.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Cache hit rate" value={stats.hitPct == null ? '—' : `${stats.hitPct.toFixed(1)}%`} sub={`${fmtTok(stats.cacheRead)} read tokens`} accent />
            <Stat label="Est. saved by cache" value={fmtUsd(stats.savedUsd)} sub="vs. paying full input price" />
            <Stat label="Cache write cost" value={fmtUsd(stats.writeCostUsd)} sub={`${fmtTok(stats.cacheWrite)} write tokens`} />
            <Stat label="Net cache benefit" value={fmtUsd(net)} sub="saved − write cost" />
          </div>
          {showModels && stats.byModel.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wide text-[var(--fg-tertiary)] border-b border-[var(--border)]">
                    <th className="py-2 pr-3 font-semibold">Model</th>
                    <th className="py-2 px-3 font-semibold text-right">Hit %</th>
                    <th className="py-2 px-3 font-semibold text-right">Input</th>
                    <th className="py-2 px-3 font-semibold text-right">Cache read</th>
                    <th className="py-2 px-3 font-semibold text-right">Cache write</th>
                    <th className="py-2 px-3 font-semibold text-right">Saved</th>
                    <th className="py-2 pl-3 font-semibold text-right">Write cost</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byModel.map(m => (
                    <tr key={m.model} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-2 pr-3 font-medium text-[var(--fg)]">{m.model}</td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        <span className="inline-flex items-center gap-2 justify-end">
                          <span className="hidden sm:block w-14 h-1.5 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                            <span className="block h-full bg-teal rounded-full" style={{ width: `${m.hitPct ?? 0}%` }} />
                          </span>
                          {m.hitPct == null ? '—' : `${m.hitPct.toFixed(1)}%`}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-[var(--fg-secondary)]">{fmtTok(m.input)}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-[var(--fg-secondary)]">{fmtTok(m.cacheRead)}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-[var(--fg-secondary)]">{fmtTok(m.cacheWrite)}</td>
                      <td className="py-2 px-3 text-right tabular-nums font-semibold text-teal">{fmtUsd(m.savedUsd)}</td>
                      <td className="py-2 pl-3 text-right tabular-nums text-[var(--fg-secondary)]">{fmtUsd(m.writeCostUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="bg-[var(--bg-secondary)] rounded-xl px-3 py-2.5">
      <p className="text-[10px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wide">{label}</p>
      <p className={`text-[17px] font-bold tabular-nums mt-0.5 ${accent ? 'text-teal' : 'text-[var(--fg)]'}`}>{value}</p>
      {sub && <p className="text-[10.5px] text-[var(--fg-tertiary)]">{sub}</p>}
    </div>
  )
}
