'use client'

import Link from 'next/link'
import { Lightbulb, TrendingUp, ArrowUpRight, SearchCheck, AlertTriangle, FlaskConical } from 'lucide-react'
import { formatCost } from '@/lib/utils'
import type { Confidence, ExplainedSpike, Finding, InsightsResult, SpikeDim } from '@/lib/insights/types'

const CONF_STYLE: Record<Confidence, { bg: string; fg: string }> = {
  high:   { bg: 'var(--green-bg)', fg: 'var(--green)' },
  medium: { bg: 'var(--amber-bg)', fg: 'var(--amber)' },
  low:    { bg: 'var(--bg-tertiary)', fg: 'var(--fg-secondary)' },
}

const DIM_LABEL: Record<SpikeDim, string> = {
  model: 'Model', member: 'Member', project: 'Project', source: 'Source', agent: 'Agent', repo: 'Repo',
}

const fmtDay = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export function InsightsClient({ result, error }: { result: InsightsResult | null; error: string | null }) {
  if (!result) {
    return (
      <div className="mx-auto max-w-5xl">
        <Header />
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--red-bg)] p-5 text-[13px] text-[var(--red)]">
          Couldn&apos;t compute insights{error ? `: ${error}` : ''}.
        </div>
      </div>
    )
  }
  if (!result.has_usage) {
    return (
      <div className="mx-auto max-w-5xl">
        <Header scoped={result.scoped_to} />
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-10 text-center">
          <Lightbulb size={22} className="mx-auto mb-3 text-[var(--fg-tertiary)]" />
          <p className="text-[14px] font-semibold text-[var(--fg)]">No usage in the last 30 days</p>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] text-[var(--fg-secondary)]">
            Insights look for waste and cost spikes in real usage. Connect a coding agent on{' '}
            <Link className="text-teal underline" href="/dashboard/setup">Setup</Link> or send events via POST /api/v1/ingest to see findings here.
          </p>
        </div>
      </div>
    )
  }

  const t = result.totals
  return (
    <div className="mx-auto max-w-5xl">
      <Header scoped={result.scoped_to} />

      {/* Headline */}
      <div className="mb-6 grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--green-bg)] p-5">
          <div className="flex items-center gap-2 text-[12px] font-medium text-teal">
            <Lightbulb size={15} /> Potential monthly savings
            <span className="rounded-full bg-[var(--bg)] px-2 py-0.5 text-[10px] text-[var(--fg-secondary)]">estimate</span>
          </div>
          <div className="mt-1 text-[32px] font-bold text-[var(--fg)]">{formatCost(t.monthly_saving_usd)}</div>
          <p className="text-[11.5px] leading-snug text-[var(--fg-secondary)]">
            Run-rate from {fmtDay(result.window.from)} – {fmtDay(result.window.to)}. Findings can overlap, so treat this as an upper bound.
          </p>
        </div>
        <Stat label="Off your bill" value={formatCost(t.bill_saving_usd)} note="metered API spend + seat fees" />
        <Stat label="Notional" value={formatCost(t.notional_saving_usd)} note="subscription usage at API rates — not a bill" />
      </div>

      {/* Findings */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--fg)]"><SearchCheck size={15} /> Waste findings</h2>
          <Link href="/dashboard/analytics/what-if" className="flex items-center gap-1 text-[12px] text-teal hover:underline">
            <FlaskConical size={13} /> Try scenarios in What-if
          </Link>
        </div>
        {result.findings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-[12.5px] text-[var(--fg-secondary)]">
            No waste found in the last 30 days — no expensive short calls, low cache reuse, error storms, runaway sessions, idle keys or idle seats.
          </div>
        ) : (
          <div className="space-y-2.5">{result.findings.map(f => <FindingCard key={f.id} f={f} />)}</div>
        )}
      </section>

      {/* Spikes */}
      <section>
        <h2 className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-[var(--fg)]"><TrendingUp size={15} /> Recent cost spikes</h2>
        <p className="mb-3 text-[11.5px] text-[var(--fg-tertiary)]">
          Days above the trailing mean + 3σ (up to 14 days of history, at least 7), in {result.timezone}.
        </p>
        {result.spikes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-[12.5px] text-[var(--fg-secondary)]">
            No unusual days in the last 30 days.
          </div>
        ) : (
          <div className="space-y-2.5">{result.spikes.map(s => <SpikeCard key={s.day} s={s} />)}</div>
        )}
      </section>
    </div>
  )
}

function Header({ scoped }: { scoped?: string | null }) {
  return (
    <div className="mb-6">
      <div className="text-[19px] font-bold text-[var(--fg)]">Insights</div>
      <p className="text-[13px] text-[var(--fg-secondary)]">
        Where money is being wasted and why costs spiked — from your real usage.
        {scoped ? ' Showing your own usage only.' : ''}
      </p>
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <div className="text-[11.5px] font-medium text-[var(--fg-secondary)]">{label}</div>
      <div className="mt-1 text-[20px] font-bold text-[var(--fg)]">{value}</div>
      <div className="text-[11px] text-[var(--fg-tertiary)]">{note}</div>
    </div>
  )
}

function FindingCard({ f }: { f: Finding }) {
  const c = CONF_STYLE[f.confidence]
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-[var(--fg)]">{f.title}</span>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: c.bg, color: c.fg }}>{f.confidence} confidence</span>
          </div>
          <p className="mt-1 text-[12px] leading-snug text-[var(--fg-secondary)]">{f.detail}</p>
          <p className="mt-1.5 text-[12px] leading-snug text-[var(--fg)]"><span className="font-medium">Do:</span> {f.recommendation}</p>
        </div>
        <div className="text-right">
          <div className="text-[18px] font-bold text-[var(--fg)]">{f.monthly_saving_usd > 0 ? `~${formatCost(f.monthly_saving_usd)}` : '—'}</div>
          <div className="text-[10.5px] text-[var(--fg-tertiary)]">
            {f.monthly_saving_usd > 0 ? '/ month (est.)' : 'hygiene'}
            {f.notional_saving_usd > 0 && f.bill_saving_usd > 0 ? ` · ${formatCost(f.bill_saving_usd)} bill` : f.notional_saving_usd > 0 ? ' · notional' : ''}
          </div>
          <Link href={f.evidence.href} className="mt-1.5 inline-flex items-center gap-0.5 text-[11.5px] text-teal hover:underline">
            {f.evidence.label} <ArrowUpRight size={12} />
          </Link>
        </div>
      </div>
    </div>
  )
}

function SpikeCard({ s }: { s: ExplainedSpike }) {
  const dims = (Object.keys(s.contributors) as SpikeDim[]).filter(d => (s.contributors[d]?.length ?? 0) > 0)
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--fg)]">
            <AlertTriangle size={14} className="text-[var(--amber)]" /> {fmtDay(s.day)} — {formatCost(s.cost)}
          </div>
          <p className="mt-1 text-[12.5px] text-[var(--fg)]">{s.sentence}</p>
          <p className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">
            Baseline {fmtDay(s.baseline_from)} – {fmtDay(s.baseline_to)} ({s.history_days} days): mean {formatCost(s.baseline_mean)}, σ {formatCost(s.baseline_sd)}, threshold {formatCost(s.threshold)}.
          </p>
        </div>
        <Link href={s.evidence.href} className="inline-flex items-center gap-0.5 text-[11.5px] text-teal hover:underline">
          {s.evidence.label} <ArrowUpRight size={12} />
        </Link>
      </div>
      {dims.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {dims.map(d => (
            <div key={d} className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-2.5">
              <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">{DIM_LABEL[d]}</div>
              {s.contributors[d]!.map(c => (
                <div key={c.key} className="flex items-center justify-between gap-2 text-[11.5px]">
                  <span className="truncate text-[var(--fg)]" title={c.label}>{c.label}</span>
                  <span className="shrink-0 tabular-nums text-[var(--fg-secondary)]">+{formatCost(c.delta)} · {c.pct}%</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
