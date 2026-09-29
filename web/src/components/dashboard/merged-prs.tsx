'use client'
/**
 * Cost per merged PR (GitHub). Pure display — load data on the server with
 * loadMergedPrData() from '@/lib/connectors/merged-prs' and pass it in:
 *
 *   const prs = await loadMergedPrData(createAdminClient(), orgId, 30, people)
 *   <MergedPrs data={prs} />
 */
import { useState } from 'react'
import Link from 'next/link'
import { GitMerge, Info, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MergedPrData, MergedPrAgg } from '@/lib/connectors/merged-prs'

const usd = (v: number | null) => v === null ? '—' : v >= 100 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`
const card = 'bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl'

export function MergedPrs({ data, connectHref = '/dashboard/coding-tools' }: { data: MergedPrData; connectHref?: string }) {
  const [view, setView] = useState<'repo' | 'author' | 'recent'>('repo')

  const title = (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h2 className="text-[15px] font-bold text-[var(--fg)] flex items-center gap-2"><GitMerge size={15} /> Cost per merged PR</h2>
        <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">Last {data.days} days · AI usage TokenFin recorded in each PR’s repo by its author</p>
      </div>
      {data.totals.prs > 0 && (
        <div className="flex items-center gap-1" role="tablist" aria-label="Group merged PRs by">
          {(['repo', 'author', 'recent'] as const).map(v => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={cn('px-3 py-1.5 rounded-lg text-[12px] font-semibold',
                view === v ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
              {v === 'repo' ? 'By repo' : v === 'author' ? 'By developer' : 'Recent PRs'}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  if (!data.connected && data.totals.prs === 0) {
    return (
      <section className={cn(card, 'p-5 space-y-3')} aria-label="Cost per merged PR">
        {title}
        <p className="text-[12.5px] text-[var(--fg-secondary)]">
          Connect GitHub with a read-only fine-grained token to see what each merged pull request cost in AI usage.
        </p>
        <Link href={connectHref} className="btn-secondary text-[12.5px] inline-flex">Connect GitHub</Link>
      </section>
    )
  }

  const t = data.totals
  return (
    <section className={cn(card, 'overflow-hidden')} aria-label="Cost per merged PR">
      <div className="p-5 space-y-4 border-b border-[var(--border)]">
        {title}
        {data.lastError && (
          <p className="text-[12px] text-[var(--amber)] bg-[var(--amber-bg)] rounded-xl px-3 py-2 flex items-center gap-2">
            <AlertTriangle size={12} /> {data.lastError}
          </p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Merged PRs', value: String(t.prs) },
            { label: 'Attributed to a developer', value: `${t.attributed} of ${t.prs}` },
            { label: 'AI cost (attributed)', value: usd(t.cost) },
            { label: 'Cost per merged PR', value: usd(t.costPerPr) },
          ].map(s => (
            <div key={s.label}>
              <p className="text-[10.5px] text-[var(--fg-tertiary)] uppercase tracking-wider font-semibold">{s.label}</p>
              <p className="text-[18px] font-bold tabular-nums text-[var(--fg)] mt-0.5">{s.value}</p>
            </div>
          ))}
        </div>
        {t.notional > 0 && (
          <p className="text-[11.5px] text-[var(--fg-tertiary)]">
            {usd(t.notional)} of this is <strong>notional</strong> — subscription CLI usage priced at API rates, not a bill.
          </p>
        )}
      </div>

      {t.prs === 0 ? (
        <p className="px-5 py-10 text-center text-[12.5px] text-[var(--fg-tertiary)]">
          No merged PRs in this period yet. GitHub is synced daily; the first sync runs when you connect.
        </p>
      ) : view === 'recent' ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wider text-[var(--fg-tertiary)] border-b border-[var(--border)]">
                <th className="px-4 py-2.5 font-semibold">PR</th>
                <th className="px-4 py-2.5 font-semibold">Author</th>
                <th className="px-4 py-2.5 font-semibold">Merged</th>
                <th className="px-4 py-2.5 font-semibold text-right">Lines</th>
                <th className="px-4 py-2.5 font-semibold text-right">AI cost</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map(r => (
                <tr key={`${r.repo}#${r.number}`} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-2.5 text-[var(--fg)]">
                    <span className="font-mono text-[11.5px] text-[var(--fg-tertiary)]">{r.repo}#{r.number}</span>{' '}
                    <span className="truncate">{r.title}</span>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--fg-secondary)]">@{r.author_login}{!r.user_key && <span className="text-[var(--fg-tertiary)]"> · unmapped</span>}</td>
                  <td className="px-4 py-2.5 font-mono text-[var(--fg-secondary)]">{r.merged_at.slice(0, 10)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg-secondary)]">
                    {r.additions === null ? '—' : <><span className="text-[var(--green)]">+{r.additions}</span> <span className="text-[var(--red)]">−{r.deletions ?? 0}</span></>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg)]">{r.user_key ? usd(Number(r.cost_usd)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <AggTable rows={view === 'repo' ? data.byRepo : data.byAuthor} first={view === 'repo' ? 'Repository' : 'Developer'} />
      )}

      <p className="px-5 py-3 text-[11.5px] text-[var(--fg-tertiary)] flex items-start gap-1.5 border-t border-[var(--border)]">
        <Info size={12} className="mt-0.5 flex-shrink-0" />
        <span>
          How it’s attributed: a PR is charged with the AI usage TokenFin recorded <em>in that repository</em> by <em>that author</em> between
          their previous merge in the same repo (or, for their first PR, when the PR was opened) and this merge. Authors are matched by
          the GitHub-login → email mapping, else the head commit’s email; unmatched PRs count toward “Merged PRs” but not the cost.
          Usage needs a repo tag (Claude Code sends it with <span className="font-mono">OTEL_METRICS_INCLUDE_REPOSITORY=1</span>).
        </span>
      </p>
    </section>
  )
}

function AggTable({ rows, first }: { rows: MergedPrAgg[]; first: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-wider text-[var(--fg-tertiary)] border-b border-[var(--border)]">
            <th className="px-4 py-2.5 font-semibold">{first}</th>
            <th className="px-4 py-2.5 font-semibold text-right">Merged PRs</th>
            <th className="px-4 py-2.5 font-semibold text-right">Attributed</th>
            <th className="px-4 py-2.5 font-semibold text-right">Lines +/−</th>
            <th className="px-4 py-2.5 font-semibold text-right">AI cost</th>
            <th className="px-4 py-2.5 font-semibold text-right">Cost / PR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className="border-b border-[var(--border)] last:border-0">
              <td className="px-4 py-2.5">
                <p className="text-[var(--fg)] font-medium">{r.label}</p>
                {r.sub && <p className="text-[11px] text-[var(--fg-tertiary)]">{r.sub}</p>}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg)]">{r.prs}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg-secondary)]">{r.attributed}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg-secondary)]">+{r.additions} / −{r.deletions}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg)]">{usd(r.cost)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-[var(--fg)]">{usd(r.costPerPr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
