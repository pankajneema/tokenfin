'use client'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { formatCost } from '@/lib/utils'
import { cn } from '@/lib/utils'

/* ── Types ──────────────────────────────────────────────────── */
interface ProjectRow {
  id:       string
  name:     string
  cost30d:  number
  calls30d: number
  pct:      number
}

interface Props {
  topProjects: ProjectRow[]
  totalCost:   number
}

const BAR_COLORS = ['#E8533A', '#00C48C', '#8B5CF6', '#60A5FA', '#F5C842']

/* ═══════════════════════════════════════════════════════════════ */
export function TopProjects({ topProjects }: Props) {

  if (!topProjects.length) {
    return (
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 h-full flex flex-col">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-[13px] font-semibold text-[var(--fg)]">Top Projects</h2>
            <p className="text-[11.5px] text-[var(--fg-secondary)] mt-0.5">By spend · last 30 days</p>
          </div>
          <Link href="/dashboard/projects" className="flex items-center gap-1 text-[11.5px] text-coral font-medium hover:underline">
            All projects <ArrowRight size={11} />
          </Link>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[12.5px] text-[var(--fg-tertiary)] text-center px-4">
            No usage data yet · start sending events to see projects here
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 h-full flex flex-col">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--fg)]">Top Projects</h2>
          <p className="text-[11.5px] text-[var(--fg-secondary)] mt-0.5">By spend · last 30 days</p>
        </div>
        <Link href="/dashboard/projects" className="flex items-center gap-1 text-[11.5px] text-coral font-medium hover:underline">
          All projects <ArrowRight size={11} />
        </Link>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_76px_52px_60px] gap-2 px-2 pb-2.5 border-b border-[var(--border)]">
        {['Project', 'Cost', 'Share', 'Calls'].map((h, i) => (
          <p key={h} className={cn('text-[10px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider', i > 0 && 'text-right')}>
            {h}
          </p>
        ))}
      </div>

      {/* Rows */}
      <div className="flex flex-col gap-0.5 mt-1 flex-1">
        {topProjects.map((row, i) => (
          <div key={row.id}
            className="grid grid-cols-[1fr_76px_52px_60px] gap-2 items-center px-2 py-2.5 rounded-xl hover:bg-[var(--bg-hover)] transition-colors">
            {/* Name + progress bar */}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }} />
                <p className="text-[12.5px] font-medium text-[var(--fg)] truncate">{row.name}</p>
              </div>
              <div className="h-[3px] bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${row.pct}%`, backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }} />
              </div>
            </div>

            <p className="text-[12.5px] font-semibold text-[var(--fg)] tabular-nums text-right">
              {formatCost(row.cost30d)}
            </p>
            <p className="text-[11.5px] text-[var(--fg-secondary)] tabular-nums text-right">
              {row.pct}%
            </p>
            <p className="text-[11.5px] text-[var(--fg-tertiary)] tabular-nums text-right">
              {row.calls30d.toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
