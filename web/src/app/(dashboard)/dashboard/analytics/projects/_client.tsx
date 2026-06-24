'use client'
import { useState, useMemo } from 'react'
import { ArrowUpRight, ArrowDownRight, Download, Check, Users, Layers, DollarSign, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ═══════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════ */
type TeamFilter = 'all' | string

export interface ProjectRow {
  id:         string
  name:       string
  team:       string
  teamColor:  string
  color:      string
  cost30d:    number
  costPrev:   number
  tokens30d:  number
  calls30d:   number
  callsPrev:  number
  models:     string[]
  budget?:    number
  pctOfTotal: number
}

interface Props { projects: ProjectRow[] }

/* ═══════════════════════════════════════════════════════════
   CSV EXPORT
═══════════════════════════════════════════════════════════ */
function downloadProjectsCSV(rows: ProjectRow[]) {
  const headers = ['Project','Team','Cost 30d ($)','vs Prior (%)','Tokens (M)','API Calls','Budget ($)','Budget Used (%)','% of Total']
  const lines = rows.map(p => {
    const delta   = p.costPrev > 0 ? ((p.cost30d - p.costPrev) / p.costPrev * 100).toFixed(1) + '%' : 'N/A'
    const budgPct = p.budget ? (p.cost30d / p.budget * 100).toFixed(1) + '%' : 'N/A'
    return [p.name, p.team, p.cost30d.toFixed(4), delta, p.tokens30d.toFixed(2), p.calls30d, p.budget?.toFixed(2) ?? 'N/A', budgPct, p.pctOfTotal.toFixed(1) + '%']
  })
  const csv = [headers, ...lines].map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = 'tokenfin-by-project.csv'; a.click()
  URL.revokeObjectURL(url)
}

/* ═══════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════ */
function fmtTokens(millions: number): string {
  if (millions >= 1)      return `${millions.toFixed(1)}M tok`
  if (millions >= 0.001)  return `${(millions * 1000).toFixed(0)}K tok`
  if (millions > 0)       return `<1K tok`
  return '—'
}

function fmtCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  if (usd < 1)   return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

function DeltaBadge({ curr, prev, size = 11 }: { curr: number; prev: number; size?: number }) {
  if (prev === 0) return null
  const d = ((curr - prev) / prev) * 100
  return (
    <span className={cn('font-semibold flex items-center gap-0.5', d > 0 ? 'text-[var(--red)]' : 'text-teal')}
      style={{ fontSize: size }}>
      {d > 0 ? <ArrowUpRight size={size - 1} /> : <ArrowDownRight size={size - 1} />}
      {Math.abs(d).toFixed(1)}%
    </span>
  )
}

/* ═══════════════════════════════════════════════════════════
   TREEMAP CARD
═══════════════════════════════════════════════════════════ */
function TreeCard({ p, max }: { p: ProjectRow; max: number }) {
  const budgetPct = p.budget ? (p.cost30d / p.budget) * 100 : null
  const teamLabel = p.team && p.team !== '—' ? p.team : null
  return (
    <div className={cn(
      'rounded-2xl p-4 flex flex-col justify-between border transition-all hover:shadow-md cursor-pointer',
      budgetPct && budgetPct > 90 ? 'border-[var(--red)]/40' : 'border-[var(--border)]',
    )}
      style={{
        background: `${p.color}15`,
        minHeight: `${Math.max(110, (max > 0 ? (p.cost30d / max) : 0.5) * 200)}px`,
      }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-bold text-[var(--fg)]">{p.name}</p>
          {teamLabel && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md mt-1 inline-block"
              style={{ background:`${p.teamColor}25`, color: p.teamColor }}>
              {teamLabel}
            </span>
          )}
        </div>
        {budgetPct !== null && (
          <div className={cn('text-[10.5px] font-bold px-2 py-1 rounded-lg flex-shrink-0',
            budgetPct > 90 ? 'bg-[var(--red)]/15 text-[var(--red)]' :
            budgetPct > 70 ? 'bg-[var(--amber)]/15 text-[var(--amber)]' :
            'bg-[var(--green-bg)] text-teal')}>
            {budgetPct.toFixed(0)}% budget
          </div>
        )}
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="flex items-end justify-between">
          <p className="text-[22px] font-bold text-[var(--fg)] tabular-nums leading-none">{fmtCost(p.cost30d)}</p>
          <DeltaBadge curr={p.cost30d} prev={p.costPrev} />
        </div>
        {p.budget && (
          <div className="h-1.5 bg-black/10 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{ width:`${Math.min((p.cost30d/p.budget)*100,100)}%`, background:p.color }} />
          </div>
        )}
        <div className="flex items-center gap-3 text-[10px] text-[var(--fg-secondary)]">
          <span>{p.calls30d.toLocaleString()} calls</span>
          <span>{fmtTokens(p.tokens30d)}</span>
          {p.models.length > 0 && <span>{p.models.length} model{p.models.length !== 1 ? 's' : ''}</span>}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   PAGE
═══════════════════════════════════════════════════════════ */
export function ProjectsClient({ projects }: Props) {
  const [teamFil,    setTeamFil]    = useState<TeamFilter>('all')
  const [viewMode,   setViewMode]   = useState<'treemap'|'table'>('treemap')
  const [exportDone, setExportDone] = useState(false)

  function handleExport() {
    downloadProjectsCSV(filtered)
    setExportDone(true)
    setTimeout(() => setExportDone(false), 2500)
  }

  const dateRange = (() => {
    const now = new Date()
    const start = new Date(now.getTime() - 30 * 86400_000)
    return `${start.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${now.toLocaleDateString('en-US',{month:'short',day:'numeric'})}`
  })()

  const filtered = useMemo(() =>
    projects.filter(p => teamFil === 'all' || p.team === teamFil),
    [projects, teamFil])

  const totalCost  = projects.reduce((s, p) => s + p.cost30d, 0)
  const totalCalls = projects.reduce((s, p) => s + p.calls30d, 0)
  const maxCost    = filtered.length > 0 ? Math.max(...filtered.map(p => p.cost30d)) : 1

  const teams = ['all', ...Array.from(new Set(projects.map(p => p.team).filter(t => t !== '—')))]

  if (projects.length === 0) {
    return (
      <div className="space-y-5">
        <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">By Project</h1>
        <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-12 text-center">
          <Layers size={32} className="mx-auto mb-3 text-[var(--fg-tertiary)]" />
          <p className="text-[14px] font-semibold text-[var(--fg)]">No project usage yet</p>
          <p className="text-[12px] text-[var(--fg-tertiary)] mt-1">
            Send events with a <code className="font-mono bg-[var(--bg-secondary)] px-1 rounded">project_id</code> to see project-level cost attribution here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">By Project</h1>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">Cost leaderboard, team attribution, and budget tracking — {dateRange}</p>
        </div>
        <button onClick={handleExport}
          className={cn('flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12.5px] font-semibold border transition-all',
            exportDone ? 'bg-teal/10 border-teal/30 text-teal' : 'btn-secondary')}>
          {exportDone ? <><Check size={13} /> Exported!</> : <><Download size={13} /> Export CSV</>}
        </button>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:'Total spend',     value:`$${totalCost.toFixed(2)}`, icon:DollarSign, color:'#D97757' },
          { label:'Active projects', value:`${projects.filter(p=>p.name!=='Uncategorized').length}`,  icon:Layers,    color:'#4285F4' },
          { label:'Total API calls', value:totalCalls.toLocaleString(), icon:BarChart3,  color:'#20B2AA' },
          { label:'Teams tracked',   value:`${new Set(projects.map(p=>p.team).filter(t=>t!=='—')).size}`, icon:Users, color:'#8B5CF6' },
        ].map(s => {
          const Icon = s.icon
          return (
            <div key={s.label} className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:`${s.color}18` }}>
                <Icon size={16} style={{ color: s.color }} />
              </div>
              <div>
                <p className="text-[19px] font-bold text-[var(--fg)] tabular-nums">{s.value}</p>
                <p className="text-[10.5px] text-[var(--fg-tertiary)]">{s.label}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Filters + view toggle ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl">
          {teams.map(t => (
            <button key={t} onClick={() => setTeamFil(t)}
              className={cn('px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all capitalize',
                teamFil===t?'bg-[var(--fg)] text-[var(--bg)]':'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
              {t === 'all' ? 'All teams' : t}
            </button>
          ))}
        </div>
        <div className="flex gap-0.5 p-0.5 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl">
          {([['treemap','Heatmap'],['table','Table']] as const).map(([v,l]) => (
            <button key={v} onClick={() => setViewMode(v)}
              className={cn('px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all',
                viewMode===v?'bg-[var(--fg)] text-[var(--bg)]':'text-[var(--fg-secondary)] hover:text-[var(--fg)]')}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* ── Treemap ── */}
      {viewMode === 'treemap' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(p => <TreeCard key={p.id} p={p} max={maxCost} />)}
        </div>
      )}

      {/* ── Table ── */}
      {viewMode === 'table' && (
        <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
            {['Project','Team','Cost MTD','vs Budget','Calls','% of Total'].map(h => (
              <p key={h} className="text-[10.5px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider">{h}</p>
            ))}
          </div>
          <div className="divide-y divide-[var(--border)]">
            {filtered.map((p, i) => {
              const budgetPct = p.budget ? (p.cost30d / p.budget) * 100 : null
              const teamLabel = p.team && p.team !== '—' ? p.team : null
              return (
                <div key={p.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-5 py-4 hover:bg-[var(--bg-secondary)]/40 transition-colors items-center">
                  <div className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-lg text-[10px] font-bold flex items-center justify-center flex-shrink-0"
                      style={{ background:`${p.color}20`, color:p.color }}>{i+1}</span>
                    <div>
                      <p className="text-[12.5px] font-semibold text-[var(--fg)]">{p.name}</p>
                      <p className="text-[10px] text-[var(--fg-tertiary)]">
                        {p.models.length > 0 ? `${p.models.length} model${p.models.length>1?'s':''}` : 'No models yet'}
                        {' · '}{fmtTokens(p.tokens30d)}
                      </p>
                    </div>
                  </div>
                  <span className={cn('text-[11.5px] font-semibold px-2 py-1 rounded-lg inline-block w-fit',
                    teamLabel ? '' : 'text-[var(--fg-tertiary)]')}
                    style={teamLabel ? { background:`${p.teamColor}18`, color:p.teamColor } : {}}>
                    {teamLabel ?? '—'}
                  </span>
                  <div>
                    <p className="text-[13px] font-bold text-[var(--fg)] tabular-nums">{fmtCost(p.cost30d)}</p>
                    <div className="mt-0.5">
                      <DeltaBadge curr={p.cost30d} prev={p.costPrev} size={10} />
                      {p.costPrev === 0 && <span className="text-[10px] text-[var(--fg-tertiary)]">No prior data</span>}
                    </div>
                  </div>
                  <div>
                    {budgetPct !== null ? (
                      <>
                        <p className={cn('text-[12px] font-bold tabular-nums',
                          budgetPct>90?'text-[var(--red)]':budgetPct>70?'text-[var(--amber)]':'text-teal')}>
                          {budgetPct.toFixed(0)}%
                        </p>
                        <p className="text-[10px] text-[var(--fg-tertiary)]">of ${p.budget} budget</p>
                      </>
                    ) : <span className="text-[11px] text-[var(--fg-tertiary)]">No budget</span>}
                  </div>
                  <p className="text-[12.5px] font-semibold text-[var(--fg)] tabular-nums">{p.calls30d.toLocaleString()}</p>
                  <div>
                    <p className="text-[12.5px] font-semibold text-[var(--fg)] tabular-nums">{p.pctOfTotal.toFixed(1)}%</p>
                    <div className="h-1 bg-[var(--bg-secondary)] rounded-full overflow-hidden mt-1 w-[60px]">
                      <div className="h-full rounded-full" style={{ width:`${p.pctOfTotal}%`, background:p.color }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Budget warnings ── */}
      {projects.filter(p => p.budget && (p.cost30d / p.budget) > 0.8).length > 0 && (
        <div className="bg-[var(--amber-bg)] border border-[var(--amber)]/30 rounded-2xl p-5 space-y-2">
          <p className="text-[13px] font-bold text-[var(--amber)]">Budget alerts</p>
          {projects.filter(p => p.budget && (p.cost30d / p.budget) > 0.8).map(p => {
            const pct = (p.cost30d / p.budget!) * 100
            return (
              <div key={p.id} className="flex items-center justify-between py-2 px-3 bg-white/40 dark:bg-black/10 rounded-xl">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background:p.color }} />
                  <p className="text-[12.5px] font-semibold text-[var(--fg)]">{p.name}</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[12px] text-[var(--fg-secondary)]">${p.cost30d.toFixed(0)} of ${p.budget}</span>
                  <span className={cn('text-[12px] font-bold', pct>95?'text-[var(--red)]':'text-[var(--amber)]')}>
                    {pct.toFixed(0)}% used
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Team attribution ── */}
      {(() => {
        // Derive real teams from project data — skip unassigned ('—')
        const teamNames = Array.from(new Set(projects.map(p => p.team).filter(t => t && t !== '—')))
        if (teamNames.length === 0) return null
        return (
          <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 space-y-4">
            <p className="text-[13px] font-bold text-[var(--fg)]">Team attribution</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {teamNames.map(team => {
                const teamProjects = projects.filter(p => p.team === team)
                const teamCost = teamProjects.reduce((s, p) => s + p.cost30d, 0)
                const teamPrev = teamProjects.reduce((s, p) => s + p.costPrev, 0)
                const delta    = teamPrev > 0 ? ((teamCost - teamPrev) / teamPrev) * 100 : null
                const pct      = totalCost > 0 ? (teamCost / totalCost) * 100 : 0
                const tColor   = teamProjects[0]?.teamColor ?? '#6B7280'
                return (
                  <div key={team} className="p-4 rounded-2xl border border-[var(--border)] space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Users size={14} style={{ color: tColor }} />
                        <p className="text-[13px] font-bold text-[var(--fg)]">{team}</p>
                      </div>
                      {delta !== null && (
                        <span className={cn('text-[11px] font-semibold flex items-center gap-0.5', delta>0?'text-[var(--red)]':'text-teal')}>
                          {delta>0?<ArrowUpRight size={11}/>:<ArrowDownRight size={11}/>}{Math.abs(delta).toFixed(1)}%
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="text-[20px] font-bold text-[var(--fg)] tabular-nums">${teamCost.toFixed(2)}</p>
                      <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-0.5">{pct.toFixed(0)}% of org spend · {teamProjects.length} project{teamProjects.length!==1?'s':''}</p>
                    </div>
                    <div className="h-1.5 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width:`${Math.min(pct,100)}%`, background: tColor }} />
                    </div>
                    {teamProjects.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {teamProjects.map(p => (
                          <span key={p.id} className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--bg-secondary)] text-[var(--fg-tertiary)]">{p.name}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
