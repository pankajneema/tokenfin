import { PiggyBank, BadgeCheck, Sparkles } from 'lucide-react'
import { formatCost, formatTokens } from '@/lib/utils'


/** Reusable savings summary card for Overview / My Usage. */
export function SavingsCard({ costSaved, tokensSaved, savingsRate, measured, href = '/dashboard/analytics/savings' }: {
  costSaved: number; tokensSaved: number; savingsRate: number; measured: boolean; href?: string
}) {
  return (
    <a href={href} className="block rounded-2xl border border-[var(--border)] bg-[var(--green-bg)] p-4 transition-colors hover:border-teal">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-teal"><PiggyBank size={14} /> Saved by TokenFin (30d)</div>
        <span className="flex items-center gap-1 rounded-full bg-[var(--bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--fg-secondary)]">
          {measured ? <><BadgeCheck size={10} className="text-teal" /> measured</> : <><Sparkles size={10} /> estimated</>}
        </span>
      </div>
      <div className="text-[24px] font-bold text-[var(--fg)]">{formatCost(costSaved)}</div>
      <div className="mt-0.5 text-[11.5px] text-[var(--fg-secondary)]">{formatTokens(tokensSaved)} tokens · {savingsRate}% of spend</div>
    </a>
  )
}
