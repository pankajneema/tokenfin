'use client'
import { useState } from 'react'
import {
  Sparkles, Zap, Check, Download, AlertTriangle, ArrowUpRight,
  CheckCircle2, X, Building2, Mail, Phone, MessageSquare,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ── Invoice type ── */
interface InvoiceRow {
  id:         string
  invoiceId:  string
  planName:   string
  amount:     number
  billing:    string
  period:     string
  date:       string
  status:     'paid'
}

/* ── Plan definitions ── */
const PLANS = [
  {
    id: 'free', name: 'Free', price: 0,
    tokens: '1M', seats: 5, projects: 1,
    features: ['1M tokens/month', 'Up to 5 team members', '1 project', 'Basic analytics', '7-day data retention'],
  },
  {
    id: 'team', name: 'Starter', price: 29,
    tokens: '10M', seats: 20, projects: 5,
    features: ['10M tokens/month', 'Up to 20 team members', '5 projects', 'Advanced analytics', '30-day data retention', 'Custom budget alerts'],
  },
  {
    id: 'pro', name: 'Pro', price: 99,
    tokens: 'Unlimited', seats: 999, projects: 999,
    features: ['Unlimited tokens', 'Unlimited team members', 'Unlimited projects', 'Real-time anomaly detection', '90-day data retention', 'All integrations', 'Priority support'],
  },
  {
    id: 'enterprise', name: 'Enterprise', price: null,
    tokens: 'Unlimited', seats: 999, projects: 999,
    features: ['Everything in Pro', 'SSO / SAML', 'Custom data retention', 'SLA guarantee 99.9%', 'Dedicated Slack channel', 'Audit logs', 'Dedicated CSM'],
  },
]

const PLAN_PRICE: Record<string, number> = { free: 0, team: 29, pro: 99, enterprise: 0 }
const PLAN_TOKEN_LIMIT: Record<string, number> = { free: 1_000_000, team: 10_000_000, pro: Infinity, enterprise: Infinity }

/* ── Helpers ── */
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

/* ── Contact Sales Modal ── */
function ContactSalesModal({ onClose }: { onClose: () => void }) {
  const [form,    setForm]    = useState({ name: '', company: '', email: '', phone: '', message: '' })
  const [loading, setLoading] = useState(false)
  const [done,    setDone]    = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await fetch('/api/v1/billing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactSales: true, ...form }),
      })
      setDone(true)
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-[480px]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0C447C]/10 flex items-center justify-center">
              <Building2 size={18} className="text-[#0C447C]" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-[var(--fg)]">Talk to sales</h2>
              <p className="text-[12px] text-[var(--fg-secondary)]">We&apos;ll reach out within 24 hours</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors">
            <X size={16} className="text-[var(--fg-tertiary)]" />
          </button>
        </div>

        {done ? (
          <div className="px-6 py-10 flex flex-col items-center gap-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[var(--green-bg)] flex items-center justify-center">
              <CheckCircle2 size={28} className="text-teal" />
            </div>
            <div>
              <p className="text-[16px] font-bold text-[var(--fg)]">Message sent!</p>
              <p className="text-[13px] text-[var(--fg-secondary)] mt-1">Our team will contact <span className="font-semibold text-[var(--fg)]">{form.email}</span> within 24 hours.</p>
            </div>
            <button onClick={onClose} className="btn-primary mt-2">Close</button>
          </div>
        ) : (
          <form onSubmit={submit} className="px-6 py-5 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11.5px] font-semibold text-[var(--fg-secondary)] mb-1">Full name *</label>
                <input required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Alex Johnson"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[13px] text-[var(--fg)] focus:outline-none focus:border-[var(--border-strong)] transition-colors" />
              </div>
              <div>
                <label className="block text-[11.5px] font-semibold text-[var(--fg-secondary)] mb-1">Company *</label>
                <input required value={form.company} onChange={e => setForm(p => ({ ...p, company: e.target.value }))}
                  placeholder="Acme Corp"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[13px] text-[var(--fg)] focus:outline-none focus:border-[var(--border-strong)] transition-colors" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11.5px] font-semibold text-[var(--fg-secondary)] mb-1 flex items-center gap-1"><Mail size={10} /> Work email *</label>
                <input required type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="you@company.com"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[13px] text-[var(--fg)] focus:outline-none focus:border-[var(--border-strong)] transition-colors" />
              </div>
              <div>
                <label className="block text-[11.5px] font-semibold text-[var(--fg-secondary)] mb-1 flex items-center gap-1"><Phone size={10} /> Phone (optional)</label>
                <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                  placeholder="+1 555 000 0000"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[13px] text-[var(--fg)] focus:outline-none focus:border-[var(--border-strong)] transition-colors" />
              </div>
            </div>
            <div>
              <label className="block text-[11.5px] font-semibold text-[var(--fg-secondary)] mb-1 flex items-center gap-1"><MessageSquare size={10} /> Use case</label>
              <textarea rows={3} value={form.message} onChange={e => setForm(p => ({ ...p, message: e.target.value }))}
                placeholder="Team size, LLM providers used, main goals..."
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[13px] text-[var(--fg)] focus:outline-none focus:border-[var(--border-strong)] transition-colors resize-none" />
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
              <button type="submit" disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-[#0C447C] text-white text-[13px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
                {loading ? <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : <><Mail size={13} /> Send inquiry</>}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

/* ── Purchase / Upgrade Receipt Modal ── */
type PayStep = 'processing' | 'done'
interface InvoiceMeta { invoiceId: string; period: string; date: string; amount: number; planName: string; billing: string }

function PurchaseModal({ planName, amount, billing, step, invoice, onClose }: {
  planName: string; amount: number; billing: string
  step: PayStep; invoice: InvoiceMeta | null; onClose: () => void
}) {
  const totalLabel = billing === 'annual' ? `$${(amount * 12).toFixed(2)} / year` : `$${amount.toFixed(2)} / month`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[3px]" />
      <div className="relative bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-[420px] overflow-hidden">
        {step === 'processing' ? (
          <div className="px-8 py-12 flex flex-col items-center gap-5 text-center">
            <div className="w-16 h-16 rounded-2xl bg-coral/10 flex items-center justify-center">
              <span className="w-8 h-8 rounded-full border-[3px] border-coral/30 border-t-coral animate-spin block" />
            </div>
            <div>
              <p className="text-[16px] font-bold text-[var(--fg)]">Processing…</p>
              <p className="text-[13px] text-[var(--fg-secondary)] mt-1">Activating your {planName} plan</p>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-[var(--green-bg)] px-6 py-5 flex items-center gap-4 border-b border-[var(--border)]">
              <div className="w-12 h-12 rounded-2xl bg-teal/20 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 size={24} className="text-teal" />
              </div>
              <div>
                <p className="text-[15px] font-bold text-[var(--fg)]">Plan updated!</p>
                <p className="text-[12px] text-[var(--fg-secondary)]">{planName} plan is now active</p>
              </div>
            </div>
            <div className="px-6 py-5">
              <div className="bg-[var(--bg-secondary)] rounded-xl p-4 mb-4 border border-[var(--border)]">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[11px] font-bold text-[var(--fg-tertiary)] uppercase tracking-wider">Invoice</p>
                  <span className="px-2 py-0.5 rounded-full bg-[var(--green-bg)] text-teal text-[10px] font-bold">PAID</span>
                </div>
                {[
                  { label: 'Invoice #', value: invoice?.invoiceId ?? '—' },
                  { label: 'Plan',      value: `${planName} (${billing === 'annual' ? 'Annual' : 'Monthly'})` },
                  { label: 'Period',    value: invoice?.period ?? '' },
                  { label: 'Date',      value: invoice?.date ?? '' },
                ].map(r => (
                  <div key={r.label} className="flex justify-between py-1.5 border-b border-[var(--border)] last:border-0">
                    <span className="text-[12px] text-[var(--fg-secondary)]">{r.label}</span>
                    <span className="text-[12px] font-medium text-[var(--fg)]">{r.value}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-2.5 mt-1">
                  <span className="text-[13px] font-bold text-[var(--fg)]">Total</span>
                  <span className="text-[15px] font-bold text-[var(--fg)] tabular-nums">{totalLabel}</span>
                </div>
              </div>
              <p className="text-[11.5px] text-[var(--fg-tertiary)] text-center mb-4">
                Receipt saved to your invoice history below.
              </p>
              <div className="flex gap-2">
                <button onClick={() => {
                  const txt = [`Invoice: ${invoice?.invoiceId}`, `Plan: ${planName}`, `Amount: ${totalLabel}`, `Period: ${invoice?.period}`, `Date: ${invoice?.date}`, `Status: PAID`].join('\n')
                  const a = document.createElement('a')
                  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }))
                  a.download = `${invoice?.invoiceId ?? 'invoice'}.txt`; a.click()
                }} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--border)] text-[12.5px] font-medium text-[var(--fg-secondary)] hover:bg-[var(--bg-secondary)] transition-colors">
                  <Download size={13} /> Receipt
                </button>
                <button onClick={onClose}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-coral text-white text-[13px] font-semibold hover:opacity-90 transition-opacity">
                  Done
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ── Cancel Confirm Modal ── */
function CancelModal({ planName, onConfirm, onClose, loading }: {
  planName: string; loading: boolean; onConfirm: () => void; onClose: () => void
}) {
  const [txt, setTxt] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
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
            You&apos;ll lose access to {planName} features. Your data will be retained for 30 days.
          </p>
          <div className="bg-[var(--red-bg)] rounded-xl p-3 mb-4 border border-[var(--red)]/20">
            <p className="text-[11.5px] text-[var(--fg-secondary)] mb-2">
              Type <span className="font-mono font-bold text-[var(--fg)]">cancel</span> to confirm
            </p>
            <input value={txt} onChange={e => setTxt(e.target.value)} placeholder="cancel"
              className="w-full px-3 py-2 rounded-lg border border-[var(--red)]/30 text-[12.5px] bg-[var(--bg)] focus:outline-none focus:border-[var(--red)] transition-colors" />
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary flex-1 justify-center">Keep plan</button>
            <button disabled={txt !== 'cancel' || loading} onClick={onConfirm}
              className="flex-1 justify-center flex items-center gap-1.5 py-2 rounded-xl bg-[var(--red)] text-white text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity">
              {loading ? <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : 'Cancel subscription'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════
   MAIN CLIENT
════════════════════════════════════════════════════════ */
interface Props {
  currentPlan:  string
  orgName:      string
  orgId:        string
  tokensUsed:   number
  renewalDate:  string
  resetLabel:   string
  invoices:     InvoiceRow[]
}

export function BillingClient({ currentPlan: initPlan, orgName, orgId, tokensUsed, renewalDate, resetLabel, invoices: initInvoices }: Props) {
  const [currentPlan, setCurrentPlan] = useState(initPlan)
  const [invoices,    setInvoices]    = useState<InvoiceRow[]>(initInvoices)

  const [showSales,    setShowSales]    = useState(false)
  const [cancelModal,  setCancelModal]  = useState(false)
  const [cancelLoading,setCancelLoading]= useState(false)

  // Purchase / upgrade modal state
  const [payStep,     setPayStep]     = useState<PayStep | null>(null)
  const [payPlan,     setPayPlan]     = useState<{ name: string; amount: number; billing: string } | null>(null)
  const [payInvoice,  setPayInvoice]  = useState<InvoiceMeta | null>(null)
  const [planLoading, setPlanLoading] = useState<string | null>(null)

  const planMeta   = PLANS.find(p => p.id === currentPlan) ?? PLANS[0]
  const planPrice  = PLAN_PRICE[currentPlan] ?? 0
  const tokenLimit = PLAN_TOKEN_LIMIT[currentPlan] ?? 1_000_000
  const usagePct   = tokenLimit === Infinity ? 0 : (tokensUsed / tokenLimit) * 100

  async function handlePlanChange(planId: string, billing = 'monthly') {
    if (planId === currentPlan) return
    if (planId === 'enterprise') { setShowSales(true); return }

    const target = PLANS.find(p => p.id === planId)
    if (!target) return

    setPlanLoading(planId)
    const amount = billing === 'annual' ? (planId === 'team' ? 23 : 79) : (PLAN_PRICE[planId] ?? 0)
    setPayPlan({ name: target.name, amount, billing })
    setPayStep('processing')

    try {
      const res  = await fetch('/api/v1/billing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId, billing }),
      })
      const data = await res.json()
      await new Promise(r => setTimeout(r, 1200))
      setPayInvoice(data.invoice ?? null)
      setPayStep('done')
      setCurrentPlan(planId)
      if (data.invoice) {
        const inv = data.invoice
        setInvoices(prev => [{
          id: crypto.randomUUID(), invoiceId: inv.invoiceId, planName: inv.planName,
          amount: inv.amount, billing: inv.billing, period: inv.period,
          date: inv.date, status: 'paid',
        }, ...prev])
      }
    } catch {
      setPayStep(null)
    } finally {
      setPlanLoading(null)
    }
  }

  async function handleCancel() {
    setCancelLoading(true)
    try {
      await fetch('/api/v1/billing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'free', billing: 'monthly' }),
      })
      setCurrentPlan('free')
      setCancelModal(false)
    } finally {
      setCancelLoading(false)
    }
  }

  return (
    <>
      {/* ── Current plan + usage ── */}
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
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-[28px] font-bold text-[var(--fg)] tracking-tight">
                {planPrice === 0 ? 'Free' : `$${planPrice}`}
              </span>
              {planPrice > 0 && <span className="text-[13px] text-[var(--fg-secondary)]">/ month</span>}
            </div>
            {planPrice > 0 && (
              <p className="text-[12px] text-[var(--fg-secondary)] mt-1">
                Renews <span className="font-semibold text-[var(--fg)]">{renewalDate}</span> · billed monthly
              </p>
            )}
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
              {tokensUsed === 0 ? 'No usage yet' : `${usagePct.toFixed(0)}% used`} · resets {resetLabel}
            </p>
            {tokenLimit !== Infinity && (
              <p className="text-[11px] text-[var(--fg-tertiary)]">
                {((tokenLimit - tokensUsed) / 1_000_000).toFixed(1)}M remaining
              </p>
            )}
          </div>
        </div>

        {/* Plan features */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: 'Team members',   value: planMeta.seats    === 999 ? 'Unlimited' : String(planMeta.seats)    },
            { label: 'Projects',       value: planMeta.projects === 999 ? 'Unlimited' : String(planMeta.projects) },
            { label: 'Data retention', value: currentPlan === 'enterprise' ? '365 days' : currentPlan === 'pro' ? '90 days' : '30 days' },
          ].map(item => (
            <div key={item.label} className="text-center p-3 bg-[var(--bg-secondary)] rounded-xl">
              <p className="text-[15px] font-bold text-[var(--fg)]">{item.value}</p>
              <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-0.5">{item.label}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {currentPlan !== 'enterprise' && (
            <button onClick={() => setShowSales(true)} className="btn-primary text-[13px]">
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

      {/* ── Plan comparison ── */}
      <Section title="Plans" desc="Upgrade or downgrade at any time">
        <div className="grid grid-cols-3 gap-3">
          {PLANS.filter(p => p.id !== 'free').map(plan => {
            const isCurrent = plan.id === currentPlan
            const planAmt   = PLAN_PRICE[plan.id] ?? 0
            const isUp      = planAmt > planPrice
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
                {isCurrent ? (
                  <div className="w-full py-2 rounded-xl text-[12px] font-semibold text-center text-coral bg-coral/10">
                    Active plan
                  </div>
                ) : plan.id === 'enterprise' ? (
                  <button onClick={() => setShowSales(true)}
                    className="w-full py-2 rounded-xl text-[12px] font-semibold border border-[var(--border)] text-[var(--fg-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--fg)] transition-colors">
                    Contact sales
                  </button>
                ) : (
                  <button
                    disabled={planLoading === plan.id}
                    onClick={() => handlePlanChange(plan.id, 'monthly')}
                    className={cn('w-full py-2 rounded-xl text-[12px] font-semibold transition-colors flex items-center justify-center gap-1.5',
                      isUp ? 'bg-coral text-white hover:opacity-90' : 'border border-[var(--border)] text-[var(--fg-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--fg)]')}>
                    {planLoading === plan.id
                      ? <span className="w-4 h-4 rounded-full border-2 border-current/30 border-t-current animate-spin" />
                      : isUp ? 'Upgrade' : 'Downgrade'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </Section>

      {/* ── Invoice history ── */}
      <Section title="Invoice history" desc="Your billing receipts">
        {invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
            <div className="w-10 h-10 rounded-xl bg-[var(--bg-secondary)] flex items-center justify-center">
              <Download size={18} className="text-[var(--fg-tertiary)]" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-[var(--fg)]">No invoices yet</p>
              <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">
                Invoices appear here after plan purchases or upgrades.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-0">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_100px_90px_80px_80px] gap-3 px-3 pb-2.5 border-b border-[var(--border)]">
              {['Invoice', 'Plan', 'Amount', 'Date', ''].map((h, i) => (
                <p key={i} className={cn('text-[10.5px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider', i > 0 && 'text-right')}>
                  {h}
                </p>
              ))}
            </div>
            {invoices.map(inv => {
              const total = inv.billing === 'annual' ? inv.amount * 12 : inv.amount
              return (
                <div key={inv.id}
                  className="grid grid-cols-[1fr_100px_90px_80px_80px] gap-3 items-center px-3 py-3 rounded-xl hover:bg-[var(--bg-secondary)] transition-colors border-b border-[var(--border)] last:border-0">
                  <div>
                    <p className="text-[12.5px] font-semibold text-[var(--fg)]">{inv.invoiceId}</p>
                    <p className="text-[11px] text-[var(--fg-tertiary)]">{inv.period}</p>
                  </div>
                  <p className="text-[12px] text-[var(--fg-secondary)] text-right">{inv.planName}</p>
                  <p className="text-[12.5px] font-semibold text-[var(--fg)] tabular-nums text-right">
                    ${total.toFixed(2)}
                  </p>
                  <p className="text-[11.5px] text-[var(--fg-tertiary)] tabular-nums text-right">{inv.date}</p>
                  <div className="flex items-center justify-end gap-2">
                    <span className="px-1.5 py-0.5 rounded-full bg-[var(--green-bg)] text-teal text-[9.5px] font-bold uppercase">paid</span>
                    <button onClick={() => {
                      const txt = [`Invoice: ${inv.invoiceId}`, `Plan: ${inv.planName}`, `Amount: $${total.toFixed(2)}`, `Period: ${inv.period}`, `Date: ${inv.date}`, `Status: PAID`].join('\n')
                      const a = document.createElement('a')
                      a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }))
                      a.download = `${inv.invoiceId}.txt`; a.click()
                    }} className="p-1 rounded hover:bg-[var(--bg-tertiary)] transition-colors">
                      <Download size={12} className="text-[var(--fg-tertiary)]" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {/* ── Modals ── */}
      {showSales && <ContactSalesModal onClose={() => setShowSales(false)} />}

      {payStep && payPlan && (
        <PurchaseModal
          planName={payPlan.name}
          amount={payPlan.amount}
          billing={payPlan.billing}
          step={payStep}
          invoice={payInvoice}
          onClose={() => { setPayStep(null); setPayPlan(null); setPayInvoice(null) }}
        />
      )}

      {cancelModal && (
        <CancelModal
          planName={planMeta.name}
          loading={cancelLoading}
          onConfirm={handleCancel}
          onClose={() => setCancelModal(false)}
        />
      )}
    </>
  )
}
