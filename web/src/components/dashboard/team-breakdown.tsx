'use client'
import Link from 'next/link'
import { Users, ArrowRight } from 'lucide-react'

/* ── Types ──────────────────────────────────────────────────── */
interface Props { memberCount: number }

/* ═══════════════════════════════════════════════════════════════ */
export function TeamBreakdown({ memberCount }: Props) {
  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-5 h-full flex flex-col">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--fg)]">Team Activity</h2>
          <p className="text-[11.5px] text-[var(--fg-secondary)] mt-0.5">Members · last 30 days</p>
        </div>
        <Link href="/dashboard/teams" className="flex items-center gap-1 text-[11.5px] text-coral font-medium hover:underline">
          View all <ArrowRight size={11} />
        </Link>
      </div>

      {/* Empty / placeholder */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3 py-4">
        <div className="w-12 h-12 rounded-2xl bg-[var(--bg-secondary)] flex items-center justify-center">
          <Users size={20} className="text-[var(--fg-tertiary)]" />
        </div>
        <div className="text-center">
          <p className="text-[13px] font-semibold text-[var(--fg)]">{memberCount} member{memberCount !== 1 ? 's' : ''}</p>
          <p className="text-[11.5px] text-[var(--fg-tertiary)] mt-1 leading-relaxed max-w-[180px]">
            Per-member cost attribution requires usage events tagged with <code className="font-mono text-coral">user_id</code>
          </p>
        </div>
        <Link href="/dashboard/teams"
          className="text-[11.5px] font-semibold text-coral hover:underline flex items-center gap-1">
          Manage team <ArrowRight size={11} />
        </Link>
      </div>

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-center gap-2">
        <Users size={12} className="text-[var(--fg-tertiary)]" />
        <span className="text-[11.5px] text-[var(--fg-tertiary)]">{memberCount} engineer{memberCount !== 1 ? 's' : ''} tracked</span>
      </div>
    </div>
  )
}
