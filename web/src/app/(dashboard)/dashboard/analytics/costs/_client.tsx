'use client'
import { useState, useMemo } from 'react'
import {
  Download, Calendar, Check, AlertTriangle,
  FileText, Clock, Mail, RefreshCw, DollarSign, Zap, BarChart3, TrendingUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ═══════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════ */
export interface DailyRow {
  date:     string
  dow:      string
  cost:     number
  prev:     number
  tokens:   number  // millions
  calls:    number
  topModel: string
  topProj:  string
  spike:    boolean
}

interface Props { rows: DailyRow[] }

/* ═══════════════════════════════════════════════════════════
   CSV EXPORT
═══════════════════════════════════════════════════════════ */
function downloadCSV(rows: DailyRow[]) {
  const headers = ['Date','Day','Cost (USD)','vs Prior Period','Tokens (M)','API Calls','Top Model','Top Project','Anomaly']
  const lines = rows.map(r => [
    r.date, r.dow, r.cost.toFixed(2),
    r.prev > 0 ? ((r.cost - r.prev) / r.prev * 100).toFixed(1) + '%' : 'N/A',
    r.tokens.toFixed(1), r.calls, r.topModel, r.topProj, r.spike ? 'Yes' : 'No',
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
export function CostsClient({ rows: initialRows }: Props) {
  const [period,    setPeriod]    = useState<'mtd'|'last30'|'last90'>('last30')
  const [showSched, setShowSched] = useState(false)
  const [exportDone,setExportDone]= useState(false)
  const [sortAsc,   setSortAsc]   = useState(false)

  const rows = useMemo(() => sortAsc ? [...initialRows] : [...initialRows].reverse(), [initialRows, sortAsc])

  const total     = initialRows.reduce((s, r) => s + r.cost, 0)
  const totalPrev = initialRows.reduce((s, r) => s + r.prev, 0)
  const totalTok  = initialRows.reduce((s, r) => s + r.tokens, 0)
  const totalCall = initialRows.reduce((s, r) => s + r.calls, 0)
  const delta     = totalPrev > 0 ? ((total - totalPrev) / totalPrev) * 100 : 0
  const projected = initialRows.length > 0 ? (total / initialRows.length) * 30 : 0
  const avgDay    = initialRows.length > 0 ? total / initialRows.length : 0
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
        <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Cost Reports</h1>
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
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Cost Reports</h1>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">Daily spend breakdown · last {initialRows.length} days</p>
        </div>
        <div className="flex items-center gap-2">
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

      {/* ── Period selector ── */}
      <div className="flex items-center gap-2">
        <Calendar size={14} className="text-[var(--fg-tertiary)]" />
        <div className="flex gap-0.5 p-0.5 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl">
          {([['last30','Last 30 days'],['mtd','MTD']] as const).map(([v,l]) => (
            <button key={v} onClick={() => setPeriod(v)}
              className={cn('px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all',
                period===v?'bg-[var(--fg)] text-[var(--bg)]':'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* ── Summary KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label:'Period spend',    value:`$${total.toFixed(2)}`,    sub:`${delta>=0?'+':''}${delta.toFixed(1)}% vs prior`, color:'#D97757', icon:DollarSign    },
          { label:'Daily average',   value:`$${avgDay.toFixed(2)}`,   sub:'per calendar day',                                color:'#4285F4', icon:BarChart3     },
          { label:'Projected EOM',   value:`$${projected.toFixed(0)}`,sub:'at current pace',                                 color:'#F59E0B', icon:TrendingUp    },
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

      {/* ── Scheduled reports panel ── */}
      {showSched && (
        <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-bold text-[var(--fg)]">Scheduled reports</p>
            <button className="btn-primary text-[12px]"><Clock size={12} /> New schedule</button>
          </div>
          <p className="text-[12px] text-[var(--fg-tertiary)]">
            Scheduled reports are not yet configured. Connect Slack or email via{' '}
            <a href="/dashboard/integrations" className="text-coral underline">Integrations</a> to set them up.
          </p>
          <p className="text-[11px] text-[var(--fg-tertiary)]">Reports will be delivered as PDF / CSV attachments or inline email summaries.</p>
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
          {['Date','Cost','vs Prior','Tokens','Calls','Top model','Top project'].map(h => (
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
                <p className="text-[12.5px] text-[var(--fg)] tabular-nums">{r.calls.toLocaleString()}</p>

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
          <p className={cn('text-[12px] font-bold', delta>0?'text-[var(--red)]':'text-teal')}>
            {delta>0?'+':''}{delta.toFixed(1)}%
          </p>
          <p className="text-[12.5px] font-bold text-[var(--fg)] tabular-nums">{totalTok.toFixed(2)}M</p>
          <p className="text-[12.5px] font-bold text-[var(--fg)] tabular-nums">{totalCall.toLocaleString()}</p>
          <span />
          <span />
        </div>
      </div>

      {/* ── Export options ── */}
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5">
        <p className="text-[13px] font-bold text-[var(--fg)] mb-4">Export options</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label:'Export CSV',     desc:'Daily rows · all fields · UTF-8',        icon:Download, color:'#20B2AA', action:handleExport },
            { label:'Export PDF',     desc:'Formatted report with charts & summary',  icon:FileText, color:'#D97757', action:()=>{}       },
            { label:'Send to email',  desc:'Email this report to your inbox now',     icon:Mail,     color:'#4285F4', action:()=>{}       },
          ].map(o => {
            const Icon = o.icon
            return (
              <button key={o.label} onClick={o.action}
                className="flex items-center gap-3 p-4 border border-[var(--border)] rounded-2xl hover:border-coral/40 hover:bg-coral/5 transition-all group text-left">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-coral/10 transition-colors"
                  style={{ background:`${o.color}18` }}>
                  <Icon size={16} style={{ color: o.color }} />
                </div>
                <div>
                  <p className="text-[12.5px] font-semibold text-[var(--fg)] group-hover:text-coral transition-colors">{o.label}</p>
                  <p className="text-[10.5px] text-[var(--fg-tertiary)]">{o.desc}</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
