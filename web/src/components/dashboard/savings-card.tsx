import { PiggyBank, BadgeCheck, Sparkles } from 'lucide-react'

const fmtUsd = (n: number) => n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`
const fmtTok = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`

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
      <div className="text-[24px] font-bold text-[var(--fg)]">{fmtUsd(costSaved)}</div>
      <div className="mt-0.5 text-[11.5px] text-[var(--fg-secondary)]">{fmtTok(tokensSaved)} tokens · {savingsRate}% of spend</div>
    </a>
  )
}
