'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Download, Receipt, Link2, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { totals, toCsv, VARIANCE_FLAG_PCT, type ReconRow } from '@/lib/billing-sync/reconcile'

interface Props {
  rows:         ReconRow[]
  days:         number
  since:        string
  providers:    string[]
  connections:  { provider: string; status: string; last_synced_at: string | null; last_error: string | null }[]
  meteredError: boolean
}

const NAME: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI' }
const usd = (n: number) => (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (n: number | null) => n === null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`

export function ReconciliationClient({ rows, days, since, providers, connections, meteredError }: Props) {
  const router = useRouter()
  const [provider, setProvider] = useState<string>('all')
  const [flaggedOnly, setFlaggedOnly] = useState(false)

  const visible = useMemo(
    () => rows.filter(r => (provider === 'all' || r.provider === provider) && (!flaggedOnly || r.flagged)),
    [rows, provider, flaggedOnly])
  const scoped = useMemo(() => rows.filter(r => provider === 'all' || r.provider === provider), [rows, provider])
  const t = totals(scoped)
  const perProvider = providers.map(p => ({ p, ...totals(rows.filter(r => r.provider === p)) }))

  function exportCsv() {
    const blob = new Blob([toCsv(visible)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `tokenfin-reconciliation-${since}-${days}d.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const header = (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <p className="text-[13px] text-[var(--fg-secondary)] max-w-[720px]">
          <Receipt size={13} className="inline -mt-0.5 mr-1" />
          What Anthropic / OpenAI billed (from their cost APIs) vs the metered spend TokenFin recorded, per UTC day.
          Subscription (notional) usage is excluded — providers don’t bill it per token.
        </p>
      </div>
      {providers.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <select value={days} onChange={e => router.push(`?days=${e.target.value}`)} aria-label="Period"
            className="px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] text-[12.5px] text-[var(--fg)]">
            {[7, 14, 30, 60, 90].map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
          <button onClick={exportCsv} disabled={visible.length === 0} className="btn-secondary text-[12.5px] disabled:opacity-40">
            <Download size={13} /> Export CSV
          </button>
        </div>
      )}
    </div>
  )

  if (providers.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl px-6 py-12 flex flex-col items-center text-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[var(--bg-secondary)] flex items-center justify-center"><Link2 size={20} className="text-[var(--fg-tertiary)]" /></div>
          <p className="text-[15px] font-bold text-[var(--fg)]">Connect a provider billing key to reconcile</p>
          <p className="text-[12.5px] text-[var(--fg-secondary)] max-w-[520px]">
            Add a read-only <strong>Anthropic Admin key</strong> (sk-ant-admin…) or <strong>OpenAI Admin key</strong> (sk-admin-…) under
            Integrations → Provider billing. TokenFin pulls the provider’s daily cost report every day and compares it with the spend it metered.
          </p>
          <Link href="/dashboard/integrations" className="btn-primary text-[12.5px] mt-2">Go to Integrations</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {header}

      {meteredError && (
        <p className="text-[12px] text-[var(--red)] bg-[var(--red-bg)] border border-[var(--red)]/20 rounded-xl px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={12} /> TokenFin metered totals could not be loaded; the TokenFin column shows $0.
        </p>
      )}
      {connections.filter(c => c.status === 'error').map(c => (
        <p key={c.provider} className="text-[12px] text-[var(--red)] bg-[var(--red-bg)] border border-[var(--red)]/20 rounded-xl px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={12} /> {NAME[c.provider] ?? c.provider} sync is failing: {c.last_error ?? 'unknown error'}.{' '}
          <Link href="/dashboard/integrations" className="underline">Fix in Integrations</Link>
        </p>
      ))}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Provider billed',      value: usd(t.providerCost) },
          { label: 'TokenFin metered',     value: usd(t.tokenfinCost) },
          { label: 'Variance (billed − metered)', value: `${usd(t.variance)} · ${pct(t.variancePct)}`, warn: t.flagged },
          { label: `Days > ${VARIANCE_FLAG_PCT}% off`, value: String(t.flaggedDays), warn: t.flaggedDays > 0 },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-4">
            <p className="text-[10.5px] text-[var(--fg-tertiary)] uppercase tracking-wider font-semibold">{s.label}</p>
            <p className={cn('text-[18px] font-bold tabular-nums mt-1', s.warn ? 'text-[var(--amber)]' : 'text-[var(--fg)]')}>{s.value}</p>
          </div>
        ))}
      </div>

      {perProvider.length > 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {perProvider.map(x => (
            <div key={x.p} className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-4 text-[12.5px] flex items-center justify-between gap-3">
              <span className="font-bold text-[var(--fg)]">{NAME[x.p] ?? x.p}</span>
              <span className="tabular-nums text-[var(--fg-secondary)]">
                {usd(x.providerCost)} billed · {usd(x.tokenfinCost)} metered ·{' '}
                <span className={cn(x.flagged && 'text-[var(--amber)] font-semibold')}>{pct(x.variancePct)}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border)] flex-wrap">
          <div className="flex items-center gap-1">
            {['all', ...providers].map(p => (
              <button key={p} onClick={() => setProvider(p)}
                className={cn('px-3 py-1.5 rounded-lg text-[12px] font-semibold',
                  provider === p ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
                {p === 'all' ? 'All providers' : NAME[p] ?? p}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[12px] text-[var(--fg-secondary)]">
            <input type="checkbox" checked={flaggedOnly} onChange={e => setFlaggedOnly(e.target.checked)} /> Only days &gt; {VARIANCE_FLAG_PCT}% off
          </label>
        </div>

        {visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-[var(--fg-tertiary)]">
            {rows.length === 0
              ? 'No cost data in this period yet. The first sync runs when you connect a key, then daily.'
              : 'No days match this filter.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wider text-[var(--fg-tertiary)] border-b border-[var(--border)]">
                  <th className="px-4 py-2.5 font-semibold">Day (UTC)</th>
                  <th className="px-4 py-2.5 font-semibold">Provider</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Provider billed</th>
                  <th className="px-4 py-2.5 font-semibold text-right">TokenFin metered</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Variance</th>
                  <th className="px-4 py-2.5 font-semibold text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(r => (
                  <tr key={`${r.day}-${r.provider}`} className={cn('border-b border-[var(--border)] last:border-0', r.flagged && 'bg-[var(--amber-bg)]')}>
                    <td className="px-4 py-2.5 font-mono text-[var(--fg)]">{r.day}</td>
                    <td className="px-4 py-2.5 text-[var(--fg-secondary)]">{NAME[r.provider] ?? r.provider}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg)]">{usd(r.providerCost)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg)]">{usd(r.tokenfinCost)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg)]">{usd(r.variance)}</td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums', r.flagged ? 'text-[var(--amber)] font-semibold' : 'text-[var(--fg-secondary)]')}>
                      {r.flagged && <AlertTriangle size={11} className="inline mr-1 -mt-0.5" aria-label="Flagged" />}{pct(r.variancePct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11.5px] text-[var(--fg-tertiary)] flex items-start gap-1.5">
        <Info size={12} className="mt-0.5 flex-shrink-0" />
        Positive variance = the provider billed more than TokenFin saw (untracked keys or apps). Provider data can lag a few hours, so today is usually partial.
        TokenFin rows are attributed by model (claude-* → Anthropic; gpt-*, o1/o3/o4 → OpenAI); usage marked as another provider (e.g. Bedrock, Azure) is excluded.
      </p>
    </div>
  )
}
