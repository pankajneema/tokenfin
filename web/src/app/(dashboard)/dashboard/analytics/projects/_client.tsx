'use client'
import { useState, useMemo } from 'react'
import { ArrowUpRight, ArrowDownRight, Download, Users, Layers, DollarSign, BarChart3 } from 'lucide-react'
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
  users:      number
}

interface Props { projects: ProjectRow[] }

/* ═══════════════════════════════════════════════════════════
   TREEMAP CARD
═══════════════════════════════════════════════════════════ */
function TreeCard({ p, max }: { p: ProjectRow; max: number }) {
  const costDelta = ((p.cost30d - p.costPrev) / p.costPrev) * 100
  const budgetPct = p.budget ? (p.cost30d / p.budget) * 100 : null
  return (
    <div className={cn(
      'rounded-2xl p-4 flex flex-col justify-between border transition-all hover:shadow-md cursor-pointer',
      budgetPct && budgetPct > 90 ? 'border-[var(--red)]/40' : 'border-white/20',
    )}
      style={{
        background: `${p.color}22`,
        minHeight: `${Math.max(100, (p.cost30d / max) * 200)}px`,
      }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-bold text-[var(--fg)]">{p.name}</p>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md mt-1 inline-block"
            style={{ background:`${p.teamColor}25`, color: p.teamColor }}>
            {p.team}
          </span>
        </div>
        {budgetPct !== null && (
          <div className={cn('text-[10.5px] font-bold px-2 py-1 rounded-lg',
            budgetPct > 90 ? 'bg-[var(--red)]/15 text-[var(--red)]' :
            budgetPct > 70 ? 'bg-[var(--amber)]/15 text-[var(--amber)]' :
            'bg-[var(--green-bg)] text-teal')}>
            {budgetPct.toFixed(0)}% of budget
          </div>
        )}
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="flex items-end justify-between">
          <p className="text-[22px] font-bold text-[var(--fg)] tabular-nums leading-none">${p.cost30d.toFixed(0)}</p>
          <span className={cn('text-[11px] font-semibold flex items-center gap-0.5',
            costDelta>0?'text-[var(--red)]':'text-teal')}>
            {costDelta>0?<ArrowUpRight size={11}/>:<ArrowDownRight size={11}/>}
            {Math.abs(costDelta).toFixed(1)}%
          </span>
        </div>
        {p.budget && (
          <div className="h-1.5 bg-black/10 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{ width:`${Math.min((p.cost30d/p.budget)*100,100)}%`, background:p.color }} />
          </div>
        )}
        <div className="flex items-center gap-3 text-[10px] text-[var(--fg-secondary)]">
          <span>{p.calls30d.toLocaleString()} calls</span>
          <span>{p.users} users</span>
          <span>{p.tokens30d.toFixed(0)}M tok</span>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   PAGE
═══════════════════════════════════════════════════════════ */
export function ProjectsClient({ projects }: Props) {
  const [teamFil,   setTeamFil]   = useState<TeamFilter>('all')
  const [viewMode,  setViewMode]  = useState<'treemap'|'table'>('treemap')

  const filtered = useMemo(() =>
    projects.filter(p => teamFil === 'all' || p.team === teamFil),
    [projects, teamFil])

  const totalCost  = projects.reduce((s, p) => s + p.cost30d, 0)
  const totalCalls = projects.reduce((s, p) => s + p.calls30d, 0)
  const maxCost    = filtered.length > 0 ? Math.max(...filtered.map(p => p.cost30d)) : 1

  const teams = ['all', ...Array.from(new Set(projects.map(p => p.team).filter(t => t !== '—')))]

  return (
    <div className="space-y-5 max-w-[1160px]">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">By Project</h1>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">Cost leaderboard, team attribution, and budget tracking — Jun 1–17</p>
        </div>
        <button className="btn-secondary"><Download size={13} /> Export CSV</button>
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
              const costDelta = ((p.cost30d - p.costPrev) / p.costPrev) * 100
              const budgetPct = p.budget ? (p.cost30d / p.budget) * 100 : null
              return (
                <div key={p.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-5 py-4 hover:bg-[var(--bg-hover)] transition-colors items-center">
                  <div className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-lg text-[10px] font-bold flex items-center justify-center flex-shrink-0"
                      style={{ background:`${p.color}20`, color:p.color }}>{i+1}</span>
                    <div>
                      <p className="text-[12.5px] font-semibold text-[var(--fg)]">{p.name}</p>
                      <p className="text-[10px] text-[var(--fg-tertiary)]">{p.models.length} model{p.models.length>1?'s':''} · {p.users} users</p>
                    </div>
                  </div>
                  <span className="text-[11.5px] font-semibold px-2 py-1 rounded-lg inline-block w-fit"
                    style={{ background:`${p.teamColor}18`, color:p.teamColor }}>
                    {p.team}
                  </span>
                  <div>
                    <p className="text-[13px] font-bold text-[var(--fg)] tabular-nums">${p.cost30d.toFixed(2)}</p>
                    <div className={cn('flex items-center gap-0.5 text-[10px] font-semibold',
                      costDelta>0?'text-[var(--red)]':'text-teal')}>
                      {costDelta>0?<ArrowUpRight size={10}/>:<ArrowDownRight size={10}/>}
                      {Math.abs(costDelta).toFixed(1)}% vs last period
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
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 space-y-4">
        <p className="text-[13px] font-bold text-[var(--fg)]">Team attribution</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {['Engineering','Product','Growth'].map(team => {
            const teamProjects = projects.filter(p => p.team === team)
            const teamCost = teamProjects.reduce((s, p) => s + p.cost30d, 0)
            const teamPrev = teamProjects.reduce((s, p) => s + p.costPrev, 0)
            const delta = ((teamCost - teamPrev) / teamPrev) * 100
            const pct = (teamCost / totalCost) * 100
            const tColor = teamProjects[0]?.teamColor ?? '#6B7280'
            return (
              <div key={team} className="p-4 rounded-2xl border border-[var(--border)] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users size={14} style={{ color: tColor }} />
                    <p className="text-[13px] font-bold text-[var(--fg)]">{team}</p>
                  </div>
                  <span className={cn('text-[11px] font-semibold flex items-center gap-0.5', delta>0?'text-[var(--red)]':'text-teal')}>
                    {delta>0?<ArrowUpRight size={11}/>:<ArrowDownRight size={11}/>}{Math.abs(delta).toFixed(1)}%
                  </span>
                </div>
                <div>
                  <p className="text-[20px] font-bold text-[var(--fg)] tabular-nums">${teamCost.toFixed(0)}</p>
                  <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-0.5">{pct.toFixed(0)}% of org spend · {teamProjects.length} project{teamProjects.length>1?'s':''}</p>
                </div>
                <div className="h-1.5 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width:`${pct}%`, background: tColor }} />
                </div>
                <div className="flex flex-wrap gap-1">
                  {teamProjects.map(p => (
                    <span key={p.id} className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--bg-secondary)] text-[var(--fg-tertiary)]">{p.name}</span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
