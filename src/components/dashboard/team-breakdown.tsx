'use client'
import Link from 'next/link'
import { Users, ArrowRight } from 'lucide-react'
import { formatCost } from '@/lib/utils'
import { cn } from '@/lib/utils'

/* ── Types ──────────────────────────────────────────────────── */
interface Props { memberCount: number }

const DEMO_TEAM = [
  { id: '1', name: 'Alex Chen',   email: 'alex@co.io',   cost: 842.30, reqs: 5420, lastMin: 2  },
  { id: '2', name: 'Sam Rivera',  email: 'sam@co.io',    cost: 631.10, reqs: 3840, lastMin: 5  },
  { id: '3', name: 'Priya Patel', email: 'priya@co.io',  cost: 421.40, reqs: 2910, lastMin: 12 },
  { id: '4', name: 'Jordan Kim',  email: 'jordan@co.io', cost: 254.80, reqs: 1820, lastMin: 45 },
]

const AVATAR_COLORS = [
  'bg-[#FDECEA] text-coral border-coral/25',
  'bg-[var(--green-bg)] text-teal border-teal/25',
  'bg-purple-50 text-purple-500 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800',
  'bg-[var(--blue-bg)] text-[var(--blue)] border-[var(--blue)]/20',
]

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}
function reltime(mins: number) {
  if (mins < 60)   return `${mins}m ago`
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`
  return `${Math.round(mins / 1440)}d ago`
}

/* ═══════════════════════════════════════════════════════════════ */
export function TeamBreakdown({ memberCount }: Props) {
  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 h-full flex flex-col">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--fg)]">Team Activity</h2>
          <p className="text-[11.5px] text-[var(--fg-secondary)] mt-0.5">Top spenders · last 30 days</p>
        </div>
        <Link href="/dashboard/teams" className="flex items-center gap-1 text-[11.5px] text-coral font-medium hover:underline">
          View all <ArrowRight size={11} />
        </Link>
      </div>

      {/* Member rows */}
      <div className="flex flex-col gap-0.5 flex-1">
        {DEMO_TEAM.map((m, i) => (
          <div key={m.id} className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-[var(--bg-hover)] transition-colors">
            <div className={cn('w-8 h-8 rounded-full border flex items-center justify-center flex-shrink-0 text-[11px] font-bold', AVATAR_COLORS[i % AVATAR_COLORS.length])}>
              {initials(m.name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12.5px] font-semibold text-[var(--fg)] truncate">{m.name}</p>
              <p className="text-[10.5px] text-[var(--fg-tertiary)]">{reltime(m.lastMin)}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-[12.5px] font-semibold text-[var(--fg)] tabular-nums">{formatCost(m.cost)}</p>
              <p className="text-[10.5px] text-[var(--fg-tertiary)] tabular-nums">{m.reqs.toLocaleString()} req</p>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-center gap-2">
        <Users size={12} className="text-[var(--fg-tertiary)]" />
        <span className="text-[11.5px] text-[var(--fg-tertiary)]">{memberCount || DEMO_TEAM.length} engineers tracked</span>
      </div>
    </div>
  )
}
