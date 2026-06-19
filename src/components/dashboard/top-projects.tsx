'use client'
import Link from 'next/link'
import { ArrowRight, TrendingUp, TrendingDown } from 'lucide-react'
import { formatCost } from '@/lib/utils'
import { cn } from '@/lib/utils'

/* ── Types ──────────────────────────────────────────────────── */
interface Project { id: string; name: string; slug: string }
interface Props { projects: Project[]; events30: { cost_usd?: number; model?: string }[]; totalCost: number }

/* ── Demo data ──────────────────────────────────────────────── */
const DEMO = [
  { id: '1', name: 'Backend API',     slug: 'backend-api',    cost: 1420.50, pct: 49.9, trend: +8.2  },
  { id: '2', name: 'ML Pipeline',     slug: 'ml-pipeline',    cost:  840.30, pct: 29.5, trend: +14.1 },
  { id: '3', name: 'Customer Bot',    slug: 'customer-bot',   cost:  450.10, pct: 15.8, trend: -3.2  },
  { id: '4', name: 'Dev Playground',  slug: 'dev-playground', cost:  136.70, pct:  4.8, trend: +2.1  },
]

const BAR_COLORS = ['#E8533A', '#00C48C', '#8B5CF6', '#60A5FA']

/* ═══════════════════════════════════════════════════════════════ */
export function TopProjects({ projects, events30, totalCost }: Props) {
  // In production: join events30 by project_id; demo for now
  const rows = DEMO

  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 h-full flex flex-col">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--fg)]">Top Projects</h2>
          <p className="text-[11.5px] text-[var(--fg-secondary)] mt-0.5">By spend · last 30 days</p>
        </div>
        <Link
          href="/dashboard/projects"
          className="flex items-center gap-1 text-[11.5px] text-coral font-medium hover:underline"
        >
          All projects <ArrowRight size={11} />
        </Link>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_76px_52px_72px] gap-2 px-2 pb-2.5 border-b border-[var(--border)]">
        {['Project', 'Cost', 'Share', '30d Δ'].map((h, i) => (
          <p
            key={h}
            className={cn(
              'text-[10px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider',
              i > 0 && 'text-right',
            )}
          >
            {h}
          </p>
        ))}
      </div>

      {/* Rows */}
      <div className="flex flex-col gap-0.5 mt-1 flex-1">
        {rows.map((row, i) => (
          <div
            key={row.id}
            className="grid grid-cols-[1fr_76px_52px_72px] gap-2 items-center px-2 py-2.5 rounded-xl
                       hover:bg-[var(--bg-hover)] transition-colors group"
          >
            {/* Name + progress bar */}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: BAR_COLORS[i] }} />
                <p className="text-[12.5px] font-medium text-[var(--fg)] truncate">{row.name}</p>
              </div>
              {/* Mini bar */}
              <div className="h-[3px] bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${row.pct}%`, backgroundColor: BAR_COLORS[i] }}
                />
              </div>
            </div>

            <p className="text-[12.5px] font-semibold text-[var(--fg)] tabular-nums text-right">
              {formatCost(row.cost)}
            </p>
            <p className="text-[11.5px] text-[var(--fg-secondary)] tabular-nums text-right">
              {row.pct}%
            </p>

            {/* Trend */}
            <div className={cn(
              'flex items-center justify-end gap-0.5 text-[11.5px] font-semibold',
              row.trend >= 0 ? 'text-[var(--red)]' : 'text-[var(--green)]',
            )}>
              {row.trend >= 0
                ? <TrendingUp  size={11} strokeWidth={2} />
                : <TrendingDown size={11} strokeWidth={2} />
              }
              {row.trend >= 0 ? '+' : ''}{row.trend}%
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
