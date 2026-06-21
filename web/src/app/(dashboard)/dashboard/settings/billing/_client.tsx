'use client'
import { useState } from 'react'
import {
  Sparkles, Zap, Check, Download,
  CreditCard, AlertTriangle, ArrowUpRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ── Types ── */
interface Invoice {
  id: string; date: string; amount: number; status: 'paid' | 'pending' | 'failed'; desc: string
}

/* Invoices come from Stripe — empty until Stripe integration is connected */
const INVOICES: Invoice[] = []

const PLANS = [
  {
    id: 'free', name: 'Free', price: 0,
    tokens: '1M', seats: 1, projects: 1,
    features: ['1M tokens/month', '1 team member', '1 project', 'Basic analytics'],
  },
  {
    id: 'pro', name: 'Pro', price: 49,
    tokens: '25M', seats: 10, projects: 999,
    features: ['25M tokens/month', '10 team members', 'Unlimited projects', 'Advanced analytics', 'Budget controls', 'Priority support'],
  },
  {
    id: 'enterprise', name: 'Enterprise', price: null,
    tokens: 'Unlimited', seats: 999, projects: 999,
    features: ['Unlimited tokens', 'Unlimited members', 'SSO / SAML', 'Custom contracts', 'SLA guarantee', 'Dedicated CSM'],
  },
]

const PLAN_PRICE: Record<string, number> = { free: 0, pro: 49, enterprise: 0 }
const PLAN_TOKEN_LIMIT: Record<string, number> = { free: 1_000_000, pro: 25_000_000, enterprise: Infinity }

/* ── helpers ── */
function Section({ title, desc, children, action }: {
  title: string; desc?: string; children: React.ReactNode; action?: React.ReactNode
}) {
  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
        <div>
          <h2 className="text-[13.5px] font-bold text-[var(--fg)]">{title}</h2>
          {desc && <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">{desc}</p>}
        </div>
        {action}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: Invoice['status'] }) {
  const map = {
    paid:    'bg-[var(--green-bg)] text-[var(--green)]',
    pending: 'bg-[var(--amber-bg)] text-[var(--amber)]',
    failed:  'bg-[var(--red-bg)] text-[var(--red)]',
  }
  return <span className={cn('px-2 py-0.5 rounded-full text-[10.5px] font-semibold capitalize', map[status])}>{status}</span>
}

/* ════════════════════════════════════════════════════════════
   CLIENT
════════════════════════════════════════════════════════════ */
interface Props {
  currentPlan: string   // 'free' | 'pro' | 'team' | 'enterprise'
  orgName:     string
}

export function BillingClient({ currentPlan, orgName }: Props) {
  const [cancelModal, setCancelModal] = useState(false)
  const [confirmText,     setConfirmText]     = useState('')

  const planMeta   = PLANS.find(p => p.id === currentPlan) ?? PLANS[0]
  const planPrice  = PLAN_PRICE[currentPlan] ?? 0
  const tokenLimit = PLAN_TOKEN_LIMIT[currentPlan] ?? 1_000_000

  // Usage is 0 until real usage data flows (usage_agg)
  const tokensUsed = 0
  const usagePct   = tokenLimit === Infinity ? 0 : (tokensUsed / tokenLimit) * 100
  const costToDate = 0.00

  return (
    <>
      {/* Current plan + usage */}
      <Section
        title={`Current plan${orgName ? ` · ${orgName}` : ''}`}
        desc={`Your workspace is on the ${planMeta.name} plan`}
        action={
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-coral/10 border border-coral/20 text-[11px] font-bold text-coral">
            <Sparkles size={10} /> {planMeta.name}
          </span>
        }
      >
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[28px] font-bold text-[var(--fg)] tracking-tight">
                {planPrice === 0 ? 'Free' : `$${planPrice}`}
              </span>
              {planPrice > 0 && <span className="text-[13px] text-[var(--fg-secondary)]">/ month</span>}
            </div>
            {planPrice > 0 && (
              <p className="text-[12px] text-[var(--fg-secondary)] mt-1">
                Renews <span className="font-semibold text-[var(--fg)]">July 1, 2026</span> · billed monthly
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[11px] text-[var(--fg-tertiary)]">Spent this period</p>
            <p className="text-[20px] font-bold text-[var(--fg)] tabular-nums">${costToDate.toFixed(2)}</p>
            {planPrice > 0 && <p className="text-[10.5px] text-[var(--fg-tertiary)]">of ${planPrice}.00 included</p>}
          </div>
        </div>

        {/* Token usage bar */}
        <div className="bg-[var(--bg-secondary)] rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Zap size={13} className="text-coral" />
              <span className="text-[12.5px] font-semibold text-[var(--fg)]">Token usage</span>
            </div>
            <span className="text-[12px] font-semibold text-[var(--fg)] tabular-nums">
              {(tokensUsed / 1_000_000).toFixed(1)}M
              {tokenLimit !== Infinity && <span className="text-[var(--fg-tertiary)] font-normal"> / {tokenLimit / 1_000_000}M</span>}
            </span>
          </div>
          <div className="h-2.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${Math.max(usagePct, 2)}%`, background: usagePct >= 90 ? '#E8533A' : usagePct >= 70 ? '#F59E0B' : '#00C48C' }} />
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-[11px] text-[var(--fg-tertiary)]">
              {tokensUsed === 0 ? 'No usage yet' : `${usagePct.toFixed(0)}% used`} · resets Jul 1
            </p>
            {tokenLimit !== Infinity && (
              <p className="text-[11px] text-[var(--fg-tertiary)]">
                {((tokenLimit - tokensUsed) / 1_000_000).toFixed(1)}M tokens remaining
              </p>
            )}
          </div>
        </div>

        {/* Plan features */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: 'Team members',    value: planMeta.seats === 999 ? 'Unlimited' : planMeta.seats.toString()    },
            { label: 'Projects',        value: planMeta.projects === 999 ? 'Unlimited' : planMeta.projects.toString() },
            { label: 'Data retention',  value: currentPlan === 'enterprise' ? '365 days' : '90 days'              },
          ].map(item => (
            <div key={item.label} className="text-center p-3 bg-[var(--bg-secondary)] rounded-xl">
              <p className="text-[15px] font-bold text-[var(--fg)]">{item.value}</p>
              <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-0.5">{item.label}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {currentPlan !== 'enterprise' && (
            <button className="btn-primary text-[13px]">
              <ArrowUpRight size={13} /> Upgrade to Enterprise
            </button>
          )}
          {currentPlan !== 'free' && (
            <button onClick={() => setCancelModal(true)} className="btn-secondary text-[13px] text-[var(--fg-secondary)]">
              Cancel subscription
            </button>
          )}
        </div>
      </Section>

      {/* Plan comparison */}
      <Section title="Plans" desc="Compare and switch plans">
        <div className="grid grid-cols-3 gap-3">
          {PLANS.map(plan => {
            const isCurrent = plan.id === currentPlan
            return (
              <div key={plan.id} className={cn('relative rounded-2xl border p-4 transition-all',
                isCurrent ? 'border-coral bg-[#FDECEA]/30 dark:bg-coral/5' : 'border-[var(--border)] hover:border-[var(--border-strong)]')}>
                {isCurrent && (
                  <div className="absolute -top-2.5 left-4">
                    <span className="px-2 py-0.5 bg-coral text-white text-[10px] font-bold rounded-full">Current</span>
                  </div>
                )}
                <div className="mb-3">
                  <p className="text-[13.5px] font-bold text-[var(--fg)]">{plan.name}</p>
                  {plan.price !== null ? (
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-[20px] font-bold text-[var(--fg)]">${plan.price}</span>
                      <span className="text-[11px] text-[var(--fg-tertiary)]">/mo</span>
                    </div>
                  ) : (
                    <p className="text-[14px] font-bold text-[var(--fg)] mt-1">Custom</p>
                  )}
                </div>
                <ul className="space-y-1.5 mb-4">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-1.5 text-[11.5px] text-[var(--fg-secondary)]">
                      <Check size={11} className="text-teal mt-0.5 flex-shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
                {!isCurrent && (
                  <button className={cn('w-full py-2 rounded-xl text-[12px] font-semibold transition-colors',
                    plan.id === 'enterprise'
                      ? 'border border-[var(--border)] text-[var(--fg-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--fg)]'
                      : 'bg-coral text-white hover:opacity-90')}>
                    {plan.id === 'enterprise' ? 'Contact sales'
                      : (plan.price ?? 0) > planPrice ? 'Upgrade' : 'Downgrade'}
                  </button>
                )}
                {isCurrent && (
                  <div className="w-full py-2 rounded-xl text-[12px] font-semibold text-center text-coral bg-coral/10">
                    Active plan
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Section>

      {/* Payment method */}
      <Section title="Payment method">
        <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
          <div className="w-10 h-10 rounded-xl bg-[var(--bg-secondary)] flex items-center justify-center">
            <CreditCard size={18} className="text-[var(--fg-tertiary)]" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-[var(--fg)]">No payment method on file</p>
            <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">
              Connect Stripe in <a href="/dashboard/integrations" className="text-coral hover:underline">Integrations</a> to manage billing and payment methods.
            </p>
          </div>
        </div>
      </Section>

      {/* Invoice history */}
      <Section title="Invoice history" desc="Download past invoices for your records">
        <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
          <div className="w-10 h-10 rounded-xl bg-[var(--bg-secondary)] flex items-center justify-center">
            <Download size={18} className="text-[var(--fg-tertiary)]" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-[var(--fg)]">No invoices yet</p>
            <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">
              Connect Stripe in <a href="/dashboard/integrations" className="text-coral hover:underline">Integrations</a> to sync your invoice history automatically.
            </p>
          </div>
        </div>
      </Section>

      {/* Cancel modal */}
      {cancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={() => setCancelModal(false)} />
          <div className="relative bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-[420px] overflow-hidden">
            <div className="px-6 py-5 border-b border-[var(--border)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-[var(--red-bg)] flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={18} className="text-[var(--red)]" />
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-[var(--fg)]">Cancel subscription</h3>
                  <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">Access ends at end of billing period</p>
                </div>
              </div>
            </div>
            <div className="px-6 py-5">
              <p className="text-[13px] text-[var(--fg-secondary)] mb-4">
                You&apos;ll lose access to {planMeta.name} features. Your data will be retained for 30 days.
              </p>
              <div className="bg-[var(--red-bg)] rounded-xl p-3 mb-4 border border-[var(--red)]/20">
                <p className="text-[11.5px] text-[var(--fg-secondary)] mb-2">Type <span className="font-mono font-bold text-[var(--fg)]">cancel</span> to confirm</p>
                <input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="cancel"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--red)]/30 text-[12.5px] bg-[var(--bg)] focus:outline-none focus:border-[var(--red)] transition-colors" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setCancelModal(false)} className="btn-secondary flex-1 justify-center">Keep plan</button>
                <button disabled={confirmText !== 'cancel'}
                  className="flex-1 justify-center flex items-center gap-1.5 py-2 rounded-xl bg-[var(--red)] text-white text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity">
                  Cancel subscription
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
