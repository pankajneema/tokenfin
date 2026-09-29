'use client'
import { useState, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import {
  Download, Calendar, Check, AlertTriangle,
  FileText, Clock, Mail, RefreshCw, DollarSign, Zap, BarChart3, TrendingUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ═══════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════ */
export interface DailyRow {
  day:      string   // YYYY-MM-DD (org time zone)
  date:     string
  dow:      string
  cost:     number
  metered:  number   // real bill
  notional: number   // subscription usage priced at API rates — not a bill
  prev:     number
  tokens:   number  // millions
  calls:    number
  prompts:  number
  topModel: string
  topProj:  string
  spike:    boolean
}

export interface CostTotals { cost: number; metered: number; notional: number; prevCost: number; prompts: number }
interface Props { rows: DailyRow[]; days: number; windowLabel: string; orgId: string; totals: CostTotals }

/* ═══════════════════════════════════════════════════════════
   CSV EXPORT
═══════════════════════════════════════════════════════════ */
function downloadCSV(rows: DailyRow[]) {
  const headers = ['Date','Day','Cost (USD)','Metered (USD)','Notional (USD)','vs Prior Period','Tokens (M)','Prompts','LLM Calls','Top Model','Top Project','Anomaly']
  const lines = rows.map(r => [
    r.day, r.dow, r.cost.toFixed(2), r.metered.toFixed(2), r.notional.toFixed(2),
    r.prev > 0 ? ((r.cost - r.prev) / r.prev * 100).toFixed(1) + '%' : 'N/A',
    r.tokens.toFixed(1), r.prompts, r.calls, r.topModel, r.topProj, r.spike ? 'Yes' : 'No',
  ])
  const csv = [headers, ...lines].map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = 'tokenfin-costs.csv'; a.click()
  URL.revokeObjectURL(url)
}

/* ═══════════════════════════════════════════════════════════
   PAGE
═══════════════════════════════════════════════════════════ */
const DAY_OPTIONS = [{ label:'7D', value:7 }, { label:'30D', value:30 }, { label:'90D', value:90 }]

export function CostsClient({ rows: initialRows, days, windowLabel, orgId, totals }: Props) {
  const [cbMonth, setCbMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [cbGroup, setCbGroup] = useState<'team' | 'project' | 'member'>('team')
  const chargebackHref = `/api/v1/export/chargeback?org_id=${orgId}&month=${cbMonth}&group=${cbGroup}`
  const router   = useRouter()
  const pathname = usePathname()
  const [showSched, setShowSched] = useState(false)
  const [exportDone,setExportDone]= useState(false)
  const [sortAsc,   setSortAsc]   = useState(false)

  function setDays(d: number) { router.push(`${pathname}?days=${d}`) }

  const rows = useMemo(() => sortAsc ? [...initialRows] : [...initialRows].reverse(), [initialRows, sortAsc])

  const total     = totals.cost
  const totalPrev = totals.prevCost
  const totalTok  = initialRows.reduce((s, r) => s + r.tokens, 0)
  const totalCall = initialRows.reduce((s, r) => s + r.calls, 0)
  const delta     = totalPrev > 0 ? ((total - totalPrev) / totalPrev) * 100 : null
  // Per calendar day of the window (quiet days count as $0).
  const avgDay    = days > 0 ? total / days : 0
  const projected = avgDay * 30
  const maxDay    = initialRows.length > 0 ? Math.max(...initialRows.map(r => r.cost)) : 1
  const spikeRow  = initialRows.find(r => r.spike)

  function handleExport() {
    downloadCSV(rows)
    setExportDone(true)
    setTimeout(() => setExportDone(false), 2500)
  }

  if (initialRows.length === 0) {
    return (
      <div className="space-y-5">
        <p className="text-[13px] text-[var(--fg-secondary)]">Daily spend breakdown · {windowLabel}</p>
        <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-10 text-center">
          <DollarSign size={32} className="mx-auto mb-3 text-[var(--fg-tertiary)]" />
          <p className="text-[14px] font-semibold text-[var(--fg)]">No cost data yet</p>
          <p className="text-[12px] text-[var(--fg-tertiary)] mt-1">Start sending usage events via <code className="font-mono bg-[var(--bg-secondary)] px-1 rounded">POST /api/v1/ingest</code> to see daily breakdowns here.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-[13px] text-[var(--fg-secondary)]">Daily spend breakdown · {windowLabel}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 p-1 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl">
            {DAY_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => setDays(opt.value)}
                className={cn('px-3 py-1 rounded-lg text-[12px] font-semibold transition-all',
                  days === opt.value
                    ? 'bg-white dark:bg-[#1e1e3a] text-[var(--fg)] shadow-sm'
                    : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]')}>
                {opt.label}
              </button>
            ))}
          </div>
          <button onClick={handleExport}
            className={cn('flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12.5px] font-semibold border transition-all',
              exportDone ? 'bg-teal/10 border-teal/30 text-teal' : 'btn-secondary')}>
            {exportDone ? <><Check size={13} /> Exported!</> : <><Download size={13} /> Export CSV</>}
          </button>
          <button onClick={() => setShowSched(v => !v)} className="btn-primary">
            <Clock size={13} /> Scheduled reports
          </button>
        </div>
      </div>

      {/* ── Summary KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label:`Spend · ${windowLabel}`, value:`$${total.toFixed(2)}`, sub:`$${totals.metered.toFixed(2)} metered · $${totals.notional.toFixed(2)} notional${delta == null ? '' : ` · ${delta>=0?'+':''}${delta.toFixed(1)}% vs prior`}`, color:'#D97757', icon:DollarSign },
          { label:'Daily average',   value:`$${avgDay.toFixed(2)}`,   sub:'per calendar day',                                color:'#4285F4', icon:BarChart3     },
          { label:'Projected 30 days', value:`$${projected.toFixed(0)}`,sub:'at current pace',                                 color:'#F59E0B', icon:TrendingUp    },
          { label:'Tokens',          value:`${totalTok.toFixed(1)}M`, sub:`${(totalTok/Math.max(initialRows.length,1)).toFixed(1)}M/day`, color:'#20B2AA', icon:Zap },
          { label:'Highest day',     value:`$${maxDay.toFixed(2)}`,   sub: spikeRow ? `${spikeRow.date} · anomaly spike` : 'no anomaly', color:'#EF4444', icon:AlertTriangle },
        ].map(s => {
          const Icon = s.icon
          return (
            <div key={s.label} className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-4 flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background:`${s.color}18` }}>
                <Icon size={15} style={{ color: s.color }} />
              </div>
              <div>
                <p className="text-[17px] font-bold text-[var(--fg)] tabular-nums">{s.value}</p>
                <p className="text-[10px] text-[var(--fg-tertiary)] mt-0.5">{s.label}</p>
                <p className="text-[10px] text-[var(--fg-tertiary)]">{s.sub}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Scheduled reports ── */}
      {showSched && (
        <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 space-y-2">
          <p className="text-[13px] font-bold text-[var(--fg)]">Scheduled reports</p>
          <p className="text-[12px] text-[var(--fg-secondary)]">
            TokenFin sends a weekly spend digest (cost, prompts, top members, models and projects, budgets at risk)
            every Monday by email, in-app and to your Slack or webhook integration.
            Turn it on or off per person in{' '}
            <a href="/dashboard/settings/notifications" className="text-coral underline">Settings → Notifications</a>.
          </p>
        </div>
      )}

      {/* ── Daily breakdown table ── */}
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <p className="text-[13.5px] font-bold text-[var(--fg)]">Daily breakdown</p>
          <button onClick={() => setSortAsc(v => !v)}
            className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--fg-secondary)] hover:text-[var(--fg)] transition-colors">
            <RefreshCw size={12} /> {sortAsc ? 'Oldest first' : 'Newest first'}
          </button>
        </div>

        {/* Col headers */}
        <div className="grid grid-cols-[120px_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-5 py-2.5 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          {['Date','Cost','vs Prior','Tokens','Prompts / Calls','Top model','Top project'].map(h => (
            <p key={h} className="text-[10.5px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider">{h}</p>
          ))}
        </div>

        {/* Rows */}
        <div className="divide-y divide-[var(--border)]">
          {rows.map((r, i) => {
            const rowDelta = r.prev > 0 ? ((r.cost - r.prev) / r.prev) * 100 : 0
            const barW     = (r.cost / maxDay) * 100
            return (
              <div key={i}
                className={cn('grid grid-cols-[120px_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-5 py-3.5 items-center hover:bg-[var(--bg-hover)] transition-colors',
                  r.spike && 'bg-[var(--amber)]/5')}>

                {/* Date */}
                <div className="flex items-center gap-2">
                  {r.spike && <AlertTriangle size={11} className="text-[var(--amber)] flex-shrink-0" />}
                  <div>
                    <p className="text-[12.5px] font-semibold text-[var(--fg)]">{r.date}</p>
                    <p className="text-[10px] text-[var(--fg-tertiary)]">{r.dow}</p>
                  </div>
                </div>

                {/* Cost with mini bar */}
                <div className="space-y-1">
                  <p className="text-[13px] font-bold text-[var(--fg)] tabular-nums">${r.cost.toFixed(2)}</p>
                  {r.notional > 0 && <p className="text-[10px] text-[var(--fg-tertiary)] tabular-nums">${r.metered.toFixed(2)} metered · ${r.notional.toFixed(2)} notional</p>}
                  <div className="h-1 bg-[var(--bg-secondary)] rounded-full overflow-hidden w-[70px]">
                    <div className="h-full rounded-full bg-coral" style={{ width:`${barW}%` }} />
                  </div>
                </div>

                {/* vs prior */}
                <div className={cn('flex items-center gap-0.5 text-[12px] font-semibold',
                  rowDelta>0?'text-[var(--red)]':'text-teal')}>
                  {r.prev > 0 ? `${rowDelta>0?'+':''}${rowDelta.toFixed(1)}%` : '—'}
                  {r.prev > 0 && <span className="text-[10px] text-[var(--fg-tertiary)] font-normal ml-1">prev ${r.prev.toFixed(2)}</span>}
                </div>

                {/* Tokens */}
                <p className="text-[12.5px] text-[var(--fg)] tabular-nums">{r.tokens.toFixed(2)}M</p>

                {/* Calls */}
                <div>
                  <p className="text-[12.5px] text-[var(--fg)] tabular-nums">{r.prompts.toLocaleString()}</p>
                  <p className="text-[10.5px] text-[var(--fg-tertiary)] tabular-nums">{r.calls.toLocaleString()} calls</p>
                </div>

                {/* Top model */}
                <p className="text-[11.5px] text-[var(--fg-secondary)] truncate">{r.topModel || '—'}</p>

                {/* Top project */}
                <p className="text-[11.5px] text-[var(--fg-secondary)] truncate">{r.topProj || '—'}</p>
              </div>
            )
          })}
        </div>

        {/* Table footer */}
        <div className="grid grid-cols-[120px_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-5 py-4 border-t border-[var(--border)] bg-[var(--bg-secondary)]">
          <p className="text-[11px] font-bold text-[var(--fg-secondary)] uppercase tracking-wider">TOTAL</p>
          <p className="text-[13px] font-bold text-[var(--fg)] tabular-nums">${total.toFixed(2)}</p>
          <p className={cn('text-[12px] font-bold', delta == null ? 'text-[var(--fg-tertiary)]' : delta>0?'text-[var(--red)]':'text-teal')}>
            {delta == null ? '—' : `${delta>0?'+':''}${delta.toFixed(1)}%`}
          </p>
          <p className="text-[12.5px] font-bold text-[var(--fg)] tabular-nums">{totalTok.toFixed(2)}M</p>
          <div>
            <p className="text-[12.5px] font-bold text-[var(--fg)] tabular-nums">{totals.prompts.toLocaleString()}</p>
            <p className="text-[10.5px] text-[var(--fg-tertiary)] tabular-nums">{totalCall.toLocaleString()} calls</p>
          </div>
          <span />
          <span />
        </div>
      </div>

      {/* ── Export options ── */}
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5">
        <p className="text-[13px] font-bold text-[var(--fg)] mb-4">Export</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <button onClick={handleExport}
            className="flex items-center gap-3 p-4 border border-[var(--border)] rounded-2xl hover:border-coral/40 hover:bg-coral/5 transition-all group text-left">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:'#20B2AA18' }}>
              <Download size={16} style={{ color: '#20B2AA' }} />
            </div>
            <div>
              <p className="text-[12.5px] font-semibold text-[var(--fg)] group-hover:text-coral transition-colors">Daily breakdown CSV</p>
              <p className="text-[10.5px] text-[var(--fg-tertiary)]">The rows above · cost, prompts, calls, tokens, top model and project</p>
            </div>
          </button>

          <div className="p-4 border border-[var(--border)] rounded-2xl space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:'#D9775718' }}>
                <FileText size={16} style={{ color: '#D97757' }} />
              </div>
              <div>
                <p className="text-[12.5px] font-semibold text-[var(--fg)]">Monthly chargeback CSV</p>
                <p className="text-[10.5px] text-[var(--fg-tertiary)]">Metered and subscription cost kept separate · share of bill · prompts · calls</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input id="chargeback-month" type="month" value={cbMonth} onChange={e => setCbMonth(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[12px] text-[var(--fg)]" />
              <select id="chargeback-group" value={cbGroup} onChange={e => setCbGroup(e.target.value as 'team' | 'project' | 'member')}
                className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[12px] text-[var(--fg)]">
                <option value="team">By team</option>
                <option value="project">By project</option>
                <option value="member">By member</option>
              </select>
              <a href={chargebackHref} className="btn-primary text-[12px]"><Download size={12} /> Download</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
