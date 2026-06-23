'use client'
import Link from 'next/link'
import { Users, ArrowRight, Crown } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ── Types ──────────────────────────────────────────────── */
export interface MemberStat {
  userId: string
  name:   string
  email:  string
  team:   string
  role:   string
  cost:   number
}

interface Props {
  memberRows:  MemberStat[]
  memberCount: number
}

const ROLE_BADGE: Record<string, string> = {
  owner:     'bg-[#8B5CF6]/10 text-[#8B5CF6]',
  admin:     'bg-[var(--blue-bg)] text-[var(--blue)]',
  developer: 'bg-[var(--green-bg)] text-teal',
  viewer:    'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]',
}

const AVATAR_COLORS = ['#D97757','#4285F4','#8B5CF6','#20B2AA','#F59E0B','#10A37F']

function initials(name: string) {
  return name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase() || '?'
}

function fmtCost(usd: number) {
  if (usd === 0) return null
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  if (usd < 1)    return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

/* ════════════════════════════════════════════════════════ */
export function TeamBreakdown({ memberRows, memberCount }: Props) {
  const topMembers  = memberRows.slice(0, 4)
  const hasCostData = memberRows.some(m => m.cost > 0)
  const maxCost     = Math.max(...memberRows.map(m => m.cost), 0.0001)

  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 h-full flex flex-col">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--fg)]">Team Activity</h2>
          <p className="text-[11.5px] text-[var(--fg-secondary)] mt-0.5">
            {memberCount} member{memberCount !== 1 ? 's' : ''} · last 30 days
          </p>
        </div>
        <Link href="/dashboard/teams" className="flex items-center gap-1 text-[11.5px] text-coral font-medium hover:underline">
          View all <ArrowRight size={11} />
        </Link>
      </div>

      {/* Member list */}
      {topMembers.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 py-4">
          <div className="w-12 h-12 rounded-2xl bg-[var(--bg-secondary)] flex items-center justify-center">
            <Users size={20} className="text-[var(--fg-tertiary)]" />
          </div>
          <div className="text-center">
            <p className="text-[13px] font-semibold text-[var(--fg)]">No members yet</p>
            <p className="text-[11.5px] text-[var(--fg-tertiary)] mt-1">
              Invite teammates to start tracking team activity
            </p>
          </div>
          <Link href="/dashboard/teams"
            className="text-[11.5px] font-semibold text-coral hover:underline flex items-center gap-1">
            Manage team <ArrowRight size={11} />
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-1 flex-1">
          {topMembers.map((m, i) => {
            const cost     = fmtCost(m.cost)
            const barWidth = hasCostData ? Math.round((m.cost / maxCost) * 100) : 0
            const color    = AVATAR_COLORS[i % AVATAR_COLORS.length]
            const isTop    = i === 0 && m.cost > 0

            return (
              <div key={m.userId}
                className="flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-[var(--bg-hover)] transition-colors group">

                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-[11px] font-bold"
                    style={{ backgroundColor: color }}>
                    {initials(m.name)}
                  </div>
                  {isTop && (
                    <div className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[var(--amber)] flex items-center justify-center">
                      <Crown size={8} className="text-white" />
                    </div>
                  )}
                </div>

                {/* Name + team + bar */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <p className="text-[12px] font-medium text-[var(--fg)] truncate leading-tight">{m.name}</p>
                    {m.role !== 'developer' && (
                      <span className={cn('px-1.5 py-px rounded-full text-[9.5px] font-semibold capitalize flex-shrink-0',
                        ROLE_BADGE[m.role] ?? ROLE_BADGE.viewer)}>
                        {m.role}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-[10.5px] text-[var(--fg-tertiary)] truncate">
                      {m.team !== '—' ? m.team : m.email || 'No team'}
                    </p>
                    {hasCostData && barWidth > 0 && (
                      <div className="flex-1 h-[3px] bg-[var(--bg-tertiary)] rounded-full overflow-hidden min-w-[24px]">
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${barWidth}%`, backgroundColor: color }} />
                      </div>
                    )}
                  </div>
                </div>

                {/* Cost */}
                <div className="text-right flex-shrink-0">
                  {cost ? (
                    <p className="text-[12px] font-semibold text-[var(--fg)] tabular-nums">{cost}</p>
                  ) : (
                    <p className="text-[11px] text-[var(--fg-tertiary)]">—</p>
                  )}
                </div>
              </div>
            )
          })}

          {/* Cost attribution note when no cost data */}
          {!hasCostData && (
            <p className="text-[10.5px] text-[var(--fg-tertiary)] text-center mt-2 leading-relaxed px-2">
              Cost attribution appears once API keys are used per project
            </p>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Users size={11} className="text-[var(--fg-tertiary)]" />
          <span className="text-[11px] text-[var(--fg-tertiary)]">{memberCount} member{memberCount !== 1 ? 's' : ''}</span>
        </div>
        <Link href="/dashboard/teams"
          className="text-[11px] font-semibold text-coral hover:underline flex items-center gap-1">
          Manage <ArrowRight size={10} />
        </Link>
      </div>
    </div>
  )
}
