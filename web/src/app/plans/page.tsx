'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Check, Zap, ArrowRight, Sparkles, ShieldCheck, Headphones,
  CheckCircle2, X, Download, Mail, Building2, MessageSquare, Phone,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

/* ── Plan data ──────────────────────────────────────────── */
const PLANS = [
  {
    id: 'free' as const,
    name: 'Free',
    tagline: 'Explore TokenFin risk-free',
    monthly: 0,
    annual: 0,
    cta: 'Get started',
    color: 'var(--border)',
    features: ['1 project', 'Up to 5 team members', '1M tokens / month', 'Basic usage analytics', '7-day data retention', 'Community support'],
    missing: ['Custom alerts', 'CSV exports', 'Slack integration', 'SSO'],
  },
  {
    id: 'team' as const,
    name: 'Starter',
    tagline: 'For small teams shipping AI fast',
    monthly: 29,
    annual: 23,
    cta: 'Start free trial',
    color: '#8B5CF6',
    features: ['5 projects', 'Up to 20 team members', '10M tokens / month', 'Advanced analytics & charts', '30-day data retention', 'Custom budget alerts', 'Email support', 'CSV exports'],
    missing: ['Slack integration', 'SSO'],
  },
  {
    id: 'pro' as const,
    name: 'Pro',
    tagline: 'For AI-native teams at scale',
    monthly: 99,
    annual: 79,
    cta: 'Start free trial',
    color: '#E8533A',
    badge: 'Most popular',
    features: ['Unlimited projects', 'Unlimited team members', 'Unlimited tokens', 'Real-time anomaly detection', '90-day data retention', 'Slack & webhook alerts', 'Model cost comparisons', 'Team spend limits', 'All integrations', 'Priority support'],
  },
  {
    id: 'enterprise' as const,
    name: 'Enterprise',
    tagline: 'Compliance, control & custom SLAs',
    monthly: null,
    annual: null,
    cta: 'Contact sales',
    color: '#0C447C',
    features: ['Everything in Pro', 'SSO / SAML', 'Custom data retention', 'SLA guarantee 99.9%', 'Dedicated Slack channel', 'Custom integrations', 'Invoice billing', 'Audit logs', 'Dedicated CSM'],
  },
]

type PlanId = typeof PLANS[number]['id']

interface Invoice {
  invoiceId:   string
  planName:    string
  amount:      number
  billing:     string
  period:      string
  date:        string
  annualTotal: number | null
}

/* ── Billing toggle ─────────────────────────────────────── */
function BillingToggle({ annual, onChange }: { annual: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border)]">
      {[{ label: 'Monthly', val: false }, { label: 'Annual', val: true, badge: '−20%' }].map(opt => (
        <button key={opt.label} onClick={() => onChange(opt.val)}
          className={cn('flex items-center gap-2 px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-all duration-200',
            annual === opt.val
              ? 'bg-[var(--bg)] text-[var(--fg)] shadow-sm border border-[var(--border)]'
              : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]')}>
          {opt.label}
          {opt.badge && (
            <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full transition-all duration-200',
              annual ? 'bg-teal/15 text-teal' : 'bg-[var(--border)] text-[var(--fg-tertiary)]')}>
              {opt.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/* ── Contact Sales Modal ───────────────────────────────── */
function ContactSalesModal({ onClose, userEmail }: { onClose: () => void; userEmail: string }) {
  const [form,    setForm]    = useState({ name: '', company: '', email: userEmail, phone: '', message: '' })
  const [loading, setLoading] = useState(false)
  const [done,    setDone]    = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await fetch('/api/v1/billing', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ contactSales: true, ...form }),
      })
      setDone(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-[480px]">

        {/* Header */}
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
              <p className="text-[13px] text-[var(--fg-secondary)] mt-1 leading-relaxed">
                Our team has received your inquiry and will contact{' '}
                <span className="font-semibold text-[var(--fg)]">{form.email}</span>{' '}
                within 24 hours.
              </p>
            </div>
            <button onClick={onClose} className="btn-primary mt-2">Back to plans</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-6 py-5 flex flex-col gap-4">
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
              <label className="block text-[11.5px] font-semibold text-[var(--fg-secondary)] mb-1 flex items-center gap-1"><MessageSquare size={10} /> Tell us about your use case</label>
              <textarea rows={3} value={form.message} onChange={e => setForm(p => ({ ...p, message: e.target.value }))}
                placeholder="Team size, LLM providers used, main goals..."
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[13px] text-[var(--fg)] focus:outline-none focus:border-[var(--border-strong)] transition-colors resize-none" />
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
              <button type="submit" disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-[#0C447C] text-white text-[13px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
                {loading
                  ? <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  : <><Mail size={13} /> Send inquiry</>}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

/* ── Payment / Success Modal ────────────────────────────── */
type PaymentStep = 'processing' | 'done'
function PaymentModal({ plan, billing, invoice, step, onContinue }: {
  plan:     typeof PLANS[number]
  billing:  boolean
  invoice:  Invoice | null
  step:     PaymentStep
  onContinue: () => void
}) {
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
              <p className="text-[16px] font-bold text-[var(--fg)]">Activating…</p>
              <p className="text-[13px] text-[var(--fg-secondary)] mt-1">Switching you to {plan.name}</p>
            </div>
          </div>
        ) : (
          <>
            {/* Activation confirmation — honest, free during early access */}
            <div className="bg-[var(--green-bg)] px-6 py-5 flex items-center gap-4 border-b border-[var(--border)]">
              <div className="w-12 h-12 rounded-2xl bg-teal/20 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 size={24} className="text-teal" />
              </div>
              <div>
                <p className="text-[15px] font-bold text-[var(--fg)]">You’re on {plan.name}</p>
                <p className="text-[12px] text-[var(--fg-secondary)]">Activated — free during early access</p>
              </div>
            </div>

            <div className="px-6 py-5">
              <div className="bg-[var(--bg-secondary)] rounded-xl p-4 mb-4 border border-[var(--border)]">
                {[
                  { label: 'Plan',      value: plan.name },
                  { label: 'Activated', value: invoice?.date ?? new Date().toISOString().slice(0, 10) },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between py-1.5 border-b border-[var(--border)] last:border-0">
                    <span className="text-[12px] text-[var(--fg-secondary)]">{row.label}</span>
                    <span className="text-[12px] font-medium text-[var(--fg)]">{row.value}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2.5 mt-1">
                  <span className="text-[13px] font-bold text-[var(--fg)]">Price today</span>
                  <span className="text-[15px] font-bold text-teal tabular-nums">$0 · Free</span>
                </div>
              </div>

              <p className="text-[11.5px] text-[var(--fg-tertiary)] text-center mb-4">
                All plans are free while TokenFin is in early access. We’ll email you well before any plan ever starts billing.
              </p>

              <button onClick={onContinue}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-coral text-white text-[13px] font-semibold hover:opacity-90 transition-opacity">
                Get started <ArrowRight size={13} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ── Plan card ──────────────────────────────────────────── */
function PlanCard({ plan, annual, loading, onSelect }: {
  plan:     typeof PLANS[number]
  annual:   boolean
  loading:  boolean
  onSelect: () => void
}) {
  const isPro        = plan.id === 'pro'
  const isFree       = plan.id === 'free'
  const isEnterprise = plan.id === 'enterprise'
  const price        = annual ? plan.annual : plan.monthly

  return (
    <div role="button" tabIndex={0}
      onClick={loading ? undefined : onSelect}
      onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !loading) { e.preventDefault(); onSelect() } }}
      className={cn('relative flex flex-col rounded-2xl border transition-all duration-200 overflow-hidden bg-[var(--bg)]',
        loading ? 'cursor-wait opacity-75' : 'cursor-pointer',
        isPro ? 'border-coral shadow-[0_0_0_1px_#E8533A,0_8px_32px_rgba(232,83,58,0.12)]'
              : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:shadow-soft')}>

      {plan.badge && (
        <div className="absolute top-0 left-0 right-0 flex justify-center">
          <div className="flex items-center gap-1 px-3 py-1 bg-coral rounded-b-xl text-white text-[10.5px] font-semibold tracking-wide">
            <Sparkles size={9} />{plan.badge}
          </div>
        </div>
      )}

      <div className={cn('flex flex-col flex-1 p-6', plan.badge && 'pt-9')}>
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: plan.color + '18' }}>
              <Zap size={13} style={{ color: plan.color }} strokeWidth={2.5} />
            </div>
            <span className="text-[15px] font-bold text-[var(--fg)]">{plan.name}</span>
          </div>
          <p className="text-[12.5px] text-[var(--fg-secondary)] leading-snug">{plan.tagline}</p>
        </div>

        <div className="mb-6">
          {isEnterprise ? (
            <div>
              <span className="text-[32px] font-bold text-[var(--fg)] leading-none">Custom</span>
              <p className="text-[12px] text-[var(--fg-tertiary)] mt-1">Contact us for pricing</p>
            </div>
          ) : isFree ? (
            <div>
              <span className="text-[32px] font-bold text-[var(--fg)] leading-none">$0</span>
              <span className="text-[13px] text-[var(--fg-tertiary)] ml-1">/ month</span>
              <p className="text-[12px] text-[var(--fg-tertiary)] mt-1">Free forever</p>
            </div>
          ) : (
            <div>
              <div className="flex items-end gap-1">
                <span className="text-[32px] font-bold text-[var(--fg)] leading-none tabular-nums">${price}</span>
                <span className="text-[13px] text-[var(--fg-tertiary)] mb-1 shrink-0">/ mo</span>
              </div>
              {annual
                ? <p className="text-[11.5px] text-teal font-medium mt-1">${price! * 12} billed annually</p>
                : <p className="text-[11.5px] text-[var(--fg-tertiary)] mt-1">${plan.annual}/mo if billed annually</p>}
            </div>
          )}
        </div>

        <div className="border-t border-[var(--border)] mb-5" />

        <ul className="flex flex-col gap-2.5 flex-1 mb-6">
          {plan.features.map(f => (
            <li key={f} className="flex items-start gap-2.5">
              <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: plan.color + '20' }}>
                <Check size={9} style={{ color: plan.color }} strokeWidth={3} />
              </div>
              <span className="text-[12.5px] text-[var(--fg-secondary)] leading-snug">{f}</span>
            </li>
          ))}
          {('missing' in plan) && (plan.missing as string[]).map(f => (
            <li key={f} className="flex items-start gap-2.5 opacity-35">
              <div className="w-4 h-4 rounded-full border border-[var(--border)] flex items-center justify-center flex-shrink-0 mt-0.5">
                <div className="w-1 h-px bg-[var(--fg-tertiary)]" />
              </div>
              <span className="text-[12.5px] text-[var(--fg-tertiary)] leading-snug line-through">{f}</span>
            </li>
          ))}
        </ul>

        <button onClick={e => { e.stopPropagation(); if (!loading) onSelect() }} disabled={loading}
          className={cn('w-full flex items-center justify-center gap-2 py-[11px] rounded-xl text-[13px] font-semibold transition-all duration-150',
            isPro ? 'bg-coral text-white hover:bg-[#D4432B] shadow-[0_2px_8px_rgba(232,83,58,0.35)] active:scale-[0.98]'
                  : isEnterprise ? 'border border-[var(--border-strong)] text-[var(--fg)] hover:bg-[var(--bg-secondary)]'
                  : 'bg-[var(--bg-secondary)] text-[var(--fg)] border border-[var(--border)] hover:bg-[var(--bg-tertiary)]')}>
          {loading
            ? <span className="w-4 h-4 rounded-full border-2 border-current/30 border-t-current animate-spin" />
            : <>{plan.cta}{!isEnterprise && <ArrowRight size={13} strokeWidth={2.5} />}</>}
        </button>

        {!isFree && !isEnterprise && (
          <p className="text-center text-[11px] text-[var(--fg-tertiary)] mt-2.5">
            14-day free trial · No credit card required
          </p>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════ */
export default function PlansPage() {
  const router   = useRouter()
  const supabase = createClient()

  const [annual,      setAnnual]      = useState(true)
  const [loading,     setLoading]     = useState<PlanId | null>(null)
  const [error,       setError]       = useState<string | null>(null)
  const [payStep,     setPayStep]     = useState<PaymentStep | null>(null)
  const [activePlan,  setActivePlan]  = useState<typeof PLANS[number] | null>(null)
  const [invoice,     setInvoice]     = useState<Invoice | null>(null)
  const [showSales,   setShowSales]   = useState(false)
  const [userEmail,   setUserEmail]   = useState('')

  async function handleSelect(planId: PlanId) {
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    setUserEmail(user.email ?? '')

    if (planId === 'enterprise') {
      setShowSales(true)
      return
    }

    const plan = PLANS.find(p => p.id === planId)!
    setActivePlan(plan)
    setLoading(planId)

    try {
      /* 1. Ensure org exists */
      const slug = user.email!.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-')
      const orgRes = await fetch('/api/v1/orgs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:     user.user_metadata?.full_name ?? slug,
          slug:     slug + '-' + Math.random().toString(36).slice(2, 6),
          plan:     planId,
          owner_id: user.id,
        }),
      })
      if (!orgRes.ok) throw new Error((await orgRes.json().catch(() => ({}))).error ?? 'Failed to create org')

      /* 2. Show processing step */
      setPayStep('processing')

      /* 3. Call billing API to update plan + create invoice */
      const billingRes = await fetch('/api/v1/billing', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ plan: planId, billing: annual ? 'annual' : 'monthly' }),
      })
      const billingData = await billingRes.json()

      await new Promise(r => setTimeout(r, 1200)) // brief processing animation

      setInvoice(billingData.invoice ?? null)
      setPayStep('done')
    } catch (e: unknown) {
      setError((e as Error).message)
      setPayStep(null)
    } finally {
      setLoading(null)
    }
  }

  function handleContinue() {
    setPayStep(null)
    router.push('/onboarding')
  }

  return (
    <div className="min-h-screen bg-[var(--bg-secondary)] text-[var(--fg)]">

      {/* Top bar */}
      <header className="sticky top-0 z-10 bg-[var(--bg)] border-b border-[var(--border)]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-coral rounded-xl flex items-center justify-center shadow-sm">
              <Zap size={15} className="text-white" strokeWidth={2.5} />
            </div>
            <span className="text-[16px] font-bold text-[var(--fg)] tracking-tight">TokenFin</span>
          </Link>
          <Link href="/login" className="text-[12.5px] text-[var(--fg-secondary)] hover:text-coral transition-colors font-medium">
            Sign in →
          </Link>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-16">

        {/* Hero */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-coral/10 border border-coral/20 text-[11.5px] font-semibold text-coral tracking-wide mb-5">
            <Sparkles size={11} /> Simple, transparent pricing
          </div>
          <h1 className="text-[40px] font-bold text-[var(--fg)] tracking-tight leading-[1.15] mb-4">
            The right plan for<br />every AI team
          </h1>
          <p className="text-[15px] text-[var(--fg-secondary)] max-w-md mx-auto leading-relaxed mb-5">
            Pick any plan and start now. Prices below are our future list price —
            <span className="font-semibold text-[var(--fg)]"> every plan is free while TokenFin is in early access.</span>
          </p>
          <div className="mx-auto mb-8 inline-flex items-center gap-1.5 rounded-full bg-[var(--green-bg)] px-3 py-1 text-[12px] font-semibold text-teal">
            <CheckCircle2 size={13} /> Free during early access · no credit card
          </div>
          <div><BillingToggle annual={annual} onChange={setAnnual} /></div>
        </div>

        {error && (
          <div className="max-w-md mx-auto mb-8 px-4 py-3 rounded-xl bg-[var(--red-bg)] border border-[rgba(153,60,29,0.2)] text-[12.5px] text-[var(--red)] text-center">
            {error}
          </div>
        )}

        {/* Plan grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map(plan => (
            <PlanCard
              key={plan.id}
              plan={plan}
              annual={annual}
              loading={loading === plan.id}
              onSelect={() => handleSelect(plan.id)}
            />
          ))}
        </div>

        {/* Trust row */}
        <div className="flex flex-wrap items-center justify-center gap-8 mt-14 pt-10 border-t border-[var(--border)]">
          {[
            { icon: ShieldCheck, label: '256-bit SSL encryption' },
            { icon: Zap,         label: '99.9% uptime SLA' },
            { icon: Headphones,  label: 'Human support, always' },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-2 text-[12.5px] text-[var(--fg-secondary)]">
              <Icon size={14} className="text-teal" strokeWidth={2} />{label}
            </div>
          ))}
        </div>

        <p className="text-center mt-8 text-[12.5px] text-[var(--fg-tertiary)]">
          Questions?{' '}
          <button onClick={() => setShowSales(true)} className="text-coral hover:underline font-medium">Chat with us</button>
          {' '}or{' '}
          <Link href="/dashboard/setup" className="text-coral hover:underline font-medium">read the docs</Link>
        </p>
      </div>

      {/* Modals */}
      {payStep && activePlan && (
        <PaymentModal
          plan={activePlan}
          billing={annual}
          invoice={invoice}
          step={payStep}
          onContinue={handleContinue}
        />
      )}

      {showSales && (
        <ContactSalesModal onClose={() => setShowSales(false)} userEmail={userEmail} />
      )}
    </div>
  )
}
