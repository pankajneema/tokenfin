'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { FlaskConical, ArrowRight } from 'lucide-react'
import { formatCost, formatTokens } from '@/lib/utils'
import { makePricer } from '@/lib/insights/pricer'
import { simulate, type Scenario } from '@/lib/insights/whatif'
import type { WhatIfData } from '@/lib/insights/load'
import type { OrgModelPrice } from '@/lib/pricing-overrides'

/** Common cheaper / alternative targets offered next to the models you already use. */
const TARGETS = [
  'claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5',
  'gpt-5.6-terra', 'gpt-5.4-mini', 'gpt-5-mini', 'gpt-5.6-luna',
  'gemini-3.5-flash', 'gemini-3.1-flash-lite',
]

interface Props { data: WhatIfData; overrides: OrgModelPrice[]; scoped: boolean; defaultSeatUsd: number }

export function WhatIfClient({ data, overrides, scoped, defaultSeatUsd }: Props) {
  const pricer = useMemo(() => makePricer(overrides), [overrides])
  const used = useMemo(() => [...new Set(data.groups.map(g => g.model))], [data.groups])
  const targets = useMemo(() => [...new Set([...TARGETS, ...used])], [used])

  const [swOn, setSwOn] = useState(false)
  const [swFrom, setSwFrom] = useState(used[0] ?? '')
  const [swTo, setSwTo] = useState('claude-sonnet-5')
  const [swShare, setSwShare] = useState(50)
  const [cacheOn, setCacheOn] = useState(false)
  const [cacheHit, setCacheHit] = useState(60)
  const [capOn, setCapOn] = useState(false)
  const [cap, setCap] = useState(1000)
  const [seatOn, setSeatOn] = useState(false)
  const [seatUsd, setSeatUsd] = useState(defaultSeatUsd)

  const scenario: Scenario = {
    switch: swOn ? { from: swFrom, to: swTo, share: swShare / 100 } : null,
    cache: cacheOn ? { hitRate: cacheHit / 100 } : null,
    outputCap: capOn ? { maxOutput: cap } : null,
    seats: seatOn ? { seatUsd } : null,
  }
  const r = useMemo(() => simulate(data.groups, data.seats, scenario, pricer),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, pricer, swOn, swFrom, swTo, swShare, cacheOn, cacheHit, capOn, cap, seatOn, seatUsd])

  if (!data.groups.length) {
    return (
      <div className="mx-auto max-w-5xl">
        <Header scoped={scoped} />
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-10 text-center">
          <FlaskConical size={22} className="mx-auto mb-3 text-[var(--fg-tertiary)]" />
          <p className="text-[14px] font-semibold text-[var(--fg)]">No usage in the last 30 days to simulate</p>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] text-[var(--fg-secondary)]">
            Connect a coding agent on <Link className="text-teal underline" href="/dashboard/setup">Setup</Link> or send events via POST /api/v1/ingest, then come back to try scenarios.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Header scoped={scoped} />
      <p className="mb-4 text-[11.5px] text-[var(--fg-tertiary)]">
        Last 30 days ({data.window.from} – {data.window.to}). Costs are re-priced from exact token counts with your price overrides
        {overrides.length ? ` (${overrides.length} active)` : ''}; recorded spend was {formatCost(data.recorded.metered_usd)} metered + {formatCost(data.recorded.notional_usd)} notional.
      </p>

      <div className="mb-6 grid gap-3 md:grid-cols-2">
        <Control title="Switch model" on={swOn} setOn={setSwOn}>
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <select className="input h-8 text-[12px]" value={swFrom} onChange={e => setSwFrom(e.target.value)}>
              {used.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <ArrowRight size={13} className="text-[var(--fg-tertiary)]" />
            <select className="input h-8 text-[12px]" value={swTo} onChange={e => setSwTo(e.target.value)}>
              {targets.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <Slider label="Share moved" value={swShare} set={setSwShare} min={0} max={100} suffix="%" />
        </Control>
        <Control title="Raise cache-hit rate" on={cacheOn} setOn={setCacheOn}>
          <Slider label="Target cache-hit" value={cacheHit} set={setCacheHit} min={0} max={95} suffix="%" />
          <p className="text-[11px] text-[var(--fg-tertiary)]">Only raises models below the target. Adds ~1 cache write per 10 reads.</p>
        </Control>
        <Control title="Cap output tokens" on={capOn} setOn={setCapOn}>
          <Slider label="Max output / call" value={cap} set={setCap} min={100} max={8000} step={100} suffix=" tok" />
          <p className="text-[11px] text-[var(--fg-tertiary)]">Uses per-model averages, so the real saving is at least this.</p>
        </Control>
        <Control title="Move light seats to API" on={seatOn} setOn={setSeatOn} disabled={scoped || data.seats.length === 0}
          disabledNote={scoped ? 'Org-level scenario (owners/admins).' : 'No subscription (notional) users in this window.'}>
          <label className="flex items-center gap-2 text-[12px] text-[var(--fg-secondary)]">
            Seat price $/month
            <input type="number" min={0} max={10000} className="input h-8 w-24 text-[12px]" value={seatUsd}
              onChange={e => setSeatUsd(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <p className="text-[11px] text-[var(--fg-tertiary)]">{data.seats.length} subscription user(s). Seats whose API-rate cost is below the seat price move to pay-as-you-go.</p>
        </Control>
      </div>

      {/* Before / after */}
      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <Side title="Before" s={r.before} />
        <Side title="After" s={r.after} />
        <div className="rounded-2xl border border-[var(--border)] p-4" style={{ background: r.delta.bill_usd < 0 || r.delta.notional_usd < 0 ? 'var(--green-bg)' : 'var(--bg-secondary)' }}>
          <div className="text-[11.5px] font-medium text-[var(--fg-secondary)]">Change (30 days)</div>
          <div className="mt-1 text-[24px] font-bold text-[var(--fg)]">{signed(r.delta.bill_usd)}</div>
          <div className="text-[11px] text-[var(--fg-tertiary)]">on your bill (metered + seats)</div>
          <div className="mt-2 text-[12px] text-[var(--fg-secondary)]">Notional: {signed(r.delta.notional_usd)}</div>
          {seatOn && r.seats.total > 0 && <div className="text-[12px] text-[var(--fg-secondary)]">Seats moved: {r.seats.moved} / {r.seats.total}</div>}
        </div>
      </div>

      {r.notes.length > 0 && (
        <ul className="mb-4 list-disc space-y-0.5 pl-5 text-[11.5px] text-[var(--fg-secondary)]">
          {r.notes.map(n => <li key={n}>{n}</li>)}
        </ul>
      )}

      <div className="overflow-x-auto rounded-2xl border border-[var(--border)]">
        <table className="w-full text-[12px]">
          <thead className="bg-[var(--bg-secondary)] text-left text-[11px] text-[var(--fg-tertiary)]">
            <tr>
              <th className="px-3 py-2 font-medium">Model</th><th className="px-3 py-2 font-medium">Basis</th>
              <th className="px-3 py-2 text-right font-medium">Calls</th><th className="px-3 py-2 text-right font-medium">Output tok</th>
              <th className="px-3 py-2 text-right font-medium">Before</th><th className="px-3 py-2 text-right font-medium">After</th>
              <th className="px-3 py-2 text-right font-medium">Δ</th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map(l => (
              <tr key={`${l.model}|${l.basis}`} className="border-t border-[var(--border)]">
                <td className="px-3 py-1.5 font-mono text-[11.5px] text-[var(--fg)]">{l.model}</td>
                <td className="px-3 py-1.5 text-[var(--fg-secondary)]">{l.basis}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{l.requests === l.requests_after ? l.requests.toLocaleString('en-US') : `${l.requests.toLocaleString('en-US')} → ${l.requests_after.toLocaleString('en-US')}`}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatTokens(Math.round(l.tokens_before.output_tokens))} → {formatTokens(Math.round(l.tokens_after.output_tokens))}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatCost(l.before_usd)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatCost(l.after_usd)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{signed(+(l.after_usd - l.before_usd).toFixed(2))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const signed = (n: number) => (n > 0 ? `+${formatCost(n)}` : n < 0 ? `−${formatCost(-n)}` : '$0.00')

function Header({ scoped }: { scoped: boolean }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 text-[19px] font-bold text-[var(--fg)]"><FlaskConical size={18} /> What-if</div>
      <p className="text-[13px] text-[var(--fg-secondary)]">
        Replay the last 30 days under a different setup and see the cost before and after.{scoped ? ' Your own usage only.' : ''}
        {' '}See <Link href="/dashboard/insights" className="text-teal hover:underline">Insights</Link> for suggested changes.
      </p>
    </div>
  )
}

function Control({ title, on, setOn, children, disabled, disabledNote }: {
  title: string; on: boolean; setOn: (v: boolean) => void; children: React.ReactNode; disabled?: boolean; disabledNote?: string
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4" style={{ opacity: disabled ? 0.6 : 1 }}>
      <label className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[var(--fg)]">
        <input type="checkbox" checked={on && !disabled} disabled={disabled} onChange={e => setOn(e.target.checked)} />
        {title}
      </label>
      {disabled ? <p className="text-[11px] text-[var(--fg-tertiary)]">{disabledNote}</p> : <div className="space-y-2" style={{ opacity: on ? 1 : 0.55 }}>{children}</div>}
    </div>
  )
}

function Slider({ label, value, set, min, max, step = 1, suffix }: { label: string; value: number; set: (n: number) => void; min: number; max: number; step?: number; suffix: string }) {
  return (
    <label className="block text-[12px] text-[var(--fg-secondary)]">
      <div className="flex justify-between"><span>{label}</span><span className="tabular-nums text-[var(--fg)]">{value.toLocaleString('en-US')}{suffix}</span></div>
      <input type="range" className="w-full" min={min} max={max} step={step} value={value} onChange={e => set(Number(e.target.value))} />
    </label>
  )
}

function Side({ title, s }: { title: string; s: { metered_usd: number; notional_usd: number; seat_fees_usd: number; bill_usd: number } }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <div className="text-[11.5px] font-medium text-[var(--fg-secondary)]">{title}</div>
      <div className="mt-1 text-[24px] font-bold text-[var(--fg)]">{formatCost(s.bill_usd)}</div>
      <div className="text-[11px] text-[var(--fg-tertiary)]">bill = metered {formatCost(s.metered_usd)}{s.seat_fees_usd > 0 ? ` + seats ${formatCost(s.seat_fees_usd)}` : ''}</div>
      <div className="mt-2 text-[12px] text-[var(--fg-secondary)]">Notional: {formatCost(s.notional_usd)}</div>
    </div>
  )
}
