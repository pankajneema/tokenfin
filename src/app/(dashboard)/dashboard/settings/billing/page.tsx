'use client'
import { useState } from 'react'
import {
  Sparkles, Zap, Check, Download, ExternalLink,
  CreditCard, RefreshCw, AlertTriangle, ArrowUpRight,
  Shield, Clock, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ── Types ── */
interface Invoice {
  id: string; date: string; amount: number; status: 'paid' | 'pending' | 'failed'; desc: string
}

/* ── Demo data ── */
const INVOICES: Invoice[] = [
  { id: 'INV-2024-006', date: 'Jun 1, 2026',  amount: 49.00, status: 'paid',    desc: 'Pro Plan · June 2026'     },
  { id: 'INV-2024-005', date: 'May 1, 2026',  amount: 49.00, status: 'paid',    desc: 'Pro Plan · May 2026'      },
  { id: 'INV-2024-004', date: 'Apr 1, 2026',  amount: 49.00, status: 'paid',    desc: 'Pro Plan · April 2026'    },
  { id: 'INV-2024-003', date: 'Mar 1, 2026',  amount: 49.00, status: 'paid',    desc: 'Pro Plan · March 2026'    },
  { id: 'INV-2024-002', date: 'Feb 1, 2026',  amount: 29.00, status: 'paid',    desc: 'Starter Plan · Feb 2026'  },
  { id: 'INV-2024-001', date: 'Jan 1, 2026',  amount: 29.00, status: 'paid',    desc: 'Starter Plan · Jan 2026'  },
]

const PLANS = [
  {
    id: 'starter', name: 'Starter', price: 29, current: false,
    tokens: '5M', seats: 3, projects: 3,
    features: ['5M tokens/month', '3 team members', '3 projects', 'Basic analytics', 'Email support'],
  },
  {
    id: 'pro', name: 'Pro', price: 49, current: true,
    tokens: '25M', seats: 10, projects: 10,
    features: ['25M tokens/month', '10 team members', 'Unlimited projects', 'Advanced analytics', 'Budget controls', 'Priority support'],
  },
  {
    id: 'enterprise', name: 'Enterprise', price: null, current: false,
    tokens: 'Unlimited', seats: 999, projects: 999,
    features: ['Unlimited tokens', 'Unlimited members', 'SSO / SAML', 'Custom contracts', 'SLA guarantee', 'Dedicated CSM'],
  },
]

/* ── Section card ── */
function Section({ title, desc, children, action }: {
  title: string; desc?: string; children: React.ReactNode
  action?: React.ReactNode
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

/* ── Invoice status badge ── */
function StatusBadge({ status }: { status: Invoice['status'] }) {
  const map = {
    paid:    'bg-[var(--green-bg)] text-[var(--green)]',
    pending: 'bg-[var(--amber-bg)] text-[var(--amber)]',
    failed:  'bg-[var(--red-bg)] text-[var(--red)]',
  }
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-[10.5px] font-semibold capitalize', map[status])}>
      {status}
    </span>
  )
}

/* ═══════════════════════════════════════════════════════════════ */
export default function BillingPage() {
  const [showAllInvoices, setShowAllInvoices] = useState(false)
  const [cancelModal, setCancelModal] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  const tokensUsed  = 8_420_000
  const tokensLimit = 25_000_000
  const usagePct    = (tokensUsed / tokensLimit) * 100
  const costToDate  = 32.40

  const displayInvoices = showAllInvoices ? INVOICES : INVOICES.slice(0, 3)

  return (
    <>
      {/* ── Current plan + usage ── */}
      <Section
        title="Current plan"
        desc="Your workspace is on the Pro plan"
        action={
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-coral/10 border border-coral/20 text-[11px] font-bold text-coral">
            <Sparkles size={10}/> Pro
          </span>
        }
      >
        {/* Plan summary */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[28px] font-bold text-[var(--fg)] tracking-tight">$49</span>
              <span className="text-[13px] text-[var(--fg-secondary)]">/ month</span>
            </div>
            <p className="text-[12px] text-[var(--fg-secondary)] mt-1">
              Renews <span className="font-semibold text-[var(--fg)]">July 1, 2026</span> · billed monthly
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-[var(--fg-tertiary)]">Spent this period</p>
            <p className="text-[20px] font-bold text-[var(--fg)] tabular-nums">${costToDate.toFixed(2)}</p>
            <p className="text-[10.5px] text-[var(--fg-tertiary)]">of $49.00 included</p>
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
              <span className="text-[var(--fg-tertiary)] font-normal"> / {tokensLimit / 1_000_000}M</span>
            </span>
          </div>
          <div className="h-2.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${usagePct}%`,
                background: usagePct >= 90 ? '#E8533A' : usagePct >= 70 ? '#F59E0B' : '#00C48C',
              }}
            />
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-[11px] text-[var(--fg-tertiary)]">{usagePct.toFixed(0)}% used · resets Jul 1</p>
            <p className="text-[11px] text-[var(--fg-tertiary)]">
              {((tokensLimit - tokensUsed) / 1_000_000).toFixed(1)}M tokens remaining
            </p>
          </div>
        </div>

        {/* Included features */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: 'Team members', value: '10' },
            { label: 'Projects', value: 'Unlimited' },
            { label: 'Data retention', value: '90 days' },
          ].map(item => (
            <div key={item.label} className="text-center p-3 bg-[var(--bg-secondary)] rounded-xl">
              <p className="text-[15px] font-bold text-[var(--fg)]">{item.value}</p>
              <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-0.5">{item.label}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-primary text-[13px]">
            <ArrowUpRight size={13}/> Upgrade to Enterprise
          </button>
          <button
            onClick={() => setCancelModal(true)}
            className="btn-secondary text-[13px] text-[var(--fg-secondary)]"
          >
            Cancel subscription
          </button>
        </div>
      </Section>

      {/* ── Plan comparison ── */}
      <Section title="Plans" desc="Compare and switch plans">
        <div className="grid grid-cols-3 gap-3">
          {PLANS.map(plan => (
            <div
              key={plan.id}
              className={cn(
                'relative rounded-2xl border p-4 transition-all',
                plan.current
                  ? 'border-coral bg-[#FDECEA]/30 dark:bg-coral/5'
                  : 'border-[var(--border)] hover:border-[var(--border-strong)]',
              )}
            >
              {plan.current && (
                <div className="absolute -top-2.5 left-4">
                  <span className="px-2 py-0.5 bg-coral text-white text-[10px] font-bold rounded-full">Current</span>
                </div>
              )}
              <div className="mb-3">
                <p className="text-[13.5px] font-bold text-[var(--fg)]">{plan.name}</p>
                {plan.price ? (
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
              {!plan.current && (
                <button className={cn(
                  'w-full py-2 rounded-xl text-[12px] font-semibold transition-colors',
                  plan.id === 'enterprise'
                    ? 'border border-[var(--border)] text-[var(--fg-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--fg)]'
                    : 'bg-coral text-white hover:bg-[var(--accent-hover)]',
                )}>
                  {plan.id === 'enterprise' ? 'Contact sales' : plan.price! > 49 ? 'Upgrade' : 'Downgrade'}
                </button>
              )}
              {plan.current && (
                <div className="w-full py-2 rounded-xl text-[12px] font-semibold text-center text-coral bg-coral/10">
                  Active plan
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* ── Payment method ── */}
      <Section
        title="Payment method"
        action={
          <button className="btn-secondary text-[12px] py-1.5">
            <RefreshCw size={12}/> Update card
          </button>
        }
      >
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-4">
            <div className="w-12 h-8 rounded-lg bg-gradient-to-br from-[#1A1A2E] to-[#2A2A45] flex items-center justify-center">
              <CreditCard size={16} className="text-white" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-[var(--fg)]">Visa ending in 4242</p>
              <p className="text-[11.5px] text-[var(--fg-tertiary)]">Expires 12/2028</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Shield size={12} className="text-teal" />
            <span className="text-[11.5px] text-teal font-semibold">Secure</span>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--fg-tertiary)]">
          <Clock size={11}/>
          Next charge of <span className="font-semibold text-[var(--fg-secondary)]">$49.00</span> on July 1, 2026
        </div>
      </Section>

      {/* ── Invoice history ── */}
      <Section
        title="Invoice history"
        desc="Download past invoices for your records"
        action={
          <button className="btn-secondary text-[12px] py-1.5">
            <Download size={12}/> Download all
          </button>
        }
      >
        <div className="divide-y divide-[var(--border)] -mx-6 px-6">
          {displayInvoices.map(inv => (
            <div key={inv.id} className="flex items-center justify-between py-3.5 group">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--bg-secondary)] flex items-center justify-center flex-shrink-0">
                  <CreditCard size={13} className="text-[var(--fg-secondary)]" />
                </div>
                <div>
                  <p className="text-[12.5px] font-semibold text-[var(--fg)]">{inv.desc}</p>
                  <p className="text-[11px] text-[var(--fg-tertiary)]">{inv.date} · {inv.id}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={inv.status} />
                <span className="text-[13px] font-bold text-[var(--fg)] tabular-nums w-14 text-right">
                  ${inv.amount.toFixed(2)}
                </span>
                <button className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--fg)] transition-colors opacity-0 group-hover:opacity-100">
                  <Download size={12}/>
                </button>
              </div>
            </div>
          ))}
        </div>

        {INVOICES.length > 3 && (
          <button
            onClick={() => setShowAllInvoices(v => !v)}
            className="w-full flex items-center justify-center gap-1.5 mt-3 pt-3 border-t border-[var(--border)] text-[12px] font-semibold text-[var(--fg-secondary)] hover:text-coral transition-colors"
          >
            {showAllInvoices ? 'Show less' : `View all ${INVOICES.length} invoices`}
            <ChevronRight size={12} className={cn('transition-transform', showAllInvoices && 'rotate-90')}/>
          </button>
        )}
      </Section>

      {/* ── Cancel modal ── */}
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
                  <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">Access ends July 1, 2026</p>
                </div>
              </div>
            </div>
            <div className="px-6 py-5">
              <p className="text-[13px] text-[var(--fg-secondary)] mb-4">
                You'll lose access to Pro features including advanced analytics, unlimited projects, and priority support. Your data will be retained for 30 days.
              </p>
              <div className="bg-[var(--red-bg)] rounded-xl p-3 mb-4 border border-[var(--red)]/20">
                <p className="text-[11.5px] text-[var(--fg-secondary)] mb-2">Type <span className="font-mono font-bold text-[var(--fg)]">cancel</span> to confirm</p>
                <input
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  placeholder="cancel"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--red)]/30 text-[12.5px] bg-[var(--bg)] focus:outline-none focus:border-[var(--red)] transition-colors"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setCancelModal(false)} className="btn-secondary flex-1 justify-center">Keep plan</button>
                <button
                  disabled={confirmText !== 'cancel'}
                  className="flex-1 justify-center flex items-center gap-1.5 py-2 rounded-xl bg-[var(--red)] text-white text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                >
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
