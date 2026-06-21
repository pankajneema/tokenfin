'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, Zap, ArrowRight, Sparkles, ShieldCheck, Headphones } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

/* ── Plan data ─────────────────────────────────────────────────── */
const PLANS = [
  {
    id: 'free' as const,
    name: 'Free',
    tagline: 'Explore TokenFin risk-free',
    monthly: 0,
    annual: 0,
    cta: 'Get started',
    color: 'var(--border)',
    features: [
      '1 project',
      'Up to 5 team members',
      '1M tokens / month',
      'Basic usage analytics',
      '7-day data retention',
      'Community support',
    ],
    missing: ['Custom alerts', 'CSV exports', 'Slack integration', 'SSO'],
  },
  {
    id: 'starter' as const,
    name: 'Starter',
    tagline: 'For small teams shipping AI fast',
    monthly: 29,
    annual: 23,
    cta: 'Start free trial',
    color: '#8B5CF6',
    features: [
      '5 projects',
      'Up to 20 team members',
      '10M tokens / month',
      'Advanced analytics & charts',
      '30-day data retention',
      'Custom budget alerts',
      'Email support',
      'CSV exports',
    ],
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
    features: [
      'Unlimited projects',
      'Unlimited team members',
      'Unlimited tokens',
      'Real-time anomaly detection',
      '90-day data retention',
      'Slack & webhook alerts',
      'Model cost comparisons',
      'Team spend limits',
      'All integrations',
      'Priority support',
    ],
  },
  {
    id: 'enterprise' as const,
    name: 'Enterprise',
    tagline: 'Compliance, control & custom SLAs',
    monthly: null,
    annual: null,
    cta: 'Talk to sales',
    color: '#0C447C',
    features: [
      'Everything in Pro',
      'SSO / SAML',
      'Custom data retention',
      'SLA guarantee 99.9%',
      'Dedicated Slack channel',
      'Custom integrations',
      'Invoice billing',
      'Audit logs',
      'Dedicated CSM',
    ],
  },
]

type PlanId = typeof PLANS[number]['id']

/* ── Billing toggle ────────────────────────────────────────────── */
function BillingToggle({ annual, onChange }: { annual: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => onChange(false)}
        className={cn('text-[13px] font-medium transition-colors', !annual ? 'text-[var(--fg)]' : 'text-[var(--fg-tertiary)]')}
      >Monthly</button>
      <button
        role="switch"
        aria-checked={annual}
        onClick={() => onChange(!annual)}
        className={cn(
          'relative w-11 h-6 rounded-full transition-colors duration-200',
          annual ? 'bg-coral' : 'bg-[var(--border-strong)]'
        )}
      >
        <span className={cn(
          'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200',
          annual ? 'translate-x-5' : 'translate-x-0.5'
        )} />
      </button>
      <button
        onClick={() => onChange(true)}
        className={cn('flex items-center gap-1.5 text-[13px] font-medium transition-colors', annual ? 'text-[var(--fg)]' : 'text-[var(--fg-tertiary)]')}
      >
        Annual
        <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full bg-teal/15 text-teal">
          Save 20%
        </span>
      </button>
    </div>
  )
}

/* ── Plan card ─────────────────────────────────────────────────── */
function PlanCard({
  plan, annual, selected, loading, onSelect,
}: {
  plan: typeof PLANS[number]
  annual: boolean
  selected: boolean
  loading: boolean
  onSelect: () => void
}) {
  const isPro        = plan.id === 'pro'
  const isFree       = plan.id === 'free'
  const isEnterprise = plan.id === 'enterprise'
  const price        = annual ? plan.annual : plan.monthly

  return (
    <div className={cn(
      'relative flex flex-col rounded-2xl border transition-all duration-200 overflow-hidden',
      isPro
        ? 'border-coral shadow-[0_0_0_1px_#E8533A,0_8px_32px_rgba(232,83,58,0.12)]'
        : selected
        ? 'border-[var(--border-strong)] shadow-card'
        : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:shadow-soft',
      isPro ? 'bg-[var(--bg)]' : 'bg-[var(--bg)]',
    )}>

      {/* Popular badge */}
      {plan.badge && (
        <div className="absolute top-0 left-0 right-0 flex justify-center">
          <div className="flex items-center gap-1 px-3 py-1 bg-coral rounded-b-xl text-white text-[10.5px] font-semibold tracking-wide">
            <Sparkles size={9} />
            {plan.badge}
          </div>
        </div>
      )}

      <div className={cn('flex flex-col flex-1 p-6', plan.badge && 'pt-9')}>

        {/* Header */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: plan.color + '18' }}>
              <Zap size={13} style={{ color: plan.color }} strokeWidth={2.5} />
            </div>
            <span className="text-[15px] font-bold text-[var(--fg)]">{plan.name}</span>
          </div>
          <p className="text-[12.5px] text-[var(--fg-secondary)] leading-snug">{plan.tagline}</p>
        </div>

        {/* Price */}
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
                <span className="text-[32px] font-bold text-[var(--fg)] leading-none">${price}</span>
                <span className="text-[13px] text-[var(--fg-tertiary)] mb-1">/ mo</span>
              </div>
              {annual && (
                <p className="text-[11.5px] text-teal font-medium mt-1">
                  ${(price! * 12).toLocaleString()} / year · billed annually
                </p>
              )}
              {!annual && (
                <p className="text-[11.5px] text-[var(--fg-tertiary)] mt-1">
                  or ${annual ? plan.monthly : plan.annual}/mo billed annually
                </p>
              )}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-[var(--border)] mb-5" />

        {/* Features */}
        <ul className="flex flex-col gap-2.5 flex-1 mb-6">
          {plan.features.map(f => (
            <li key={f} className="flex items-start gap-2.5">
              <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: plan.color + '20' }}>
                <Check size={9} style={{ color: plan.color }} strokeWidth={3} />
              </div>
              <span className="text-[12.5px] text-[var(--fg-secondary)] leading-snug">{f}</span>
            </li>
          ))}
          {plan.missing?.map(f => (
            <li key={f} className="flex items-start gap-2.5 opacity-35">
              <div className="w-4 h-4 rounded-full border border-[var(--border)] flex items-center justify-center flex-shrink-0 mt-0.5">
                <div className="w-1 h-px bg-[var(--fg-tertiary)]" />
              </div>
              <span className="text-[12.5px] text-[var(--fg-tertiary)] leading-snug line-through">{f}</span>
            </li>
          ))}
        </ul>

        {/* CTA */}
        <button
          onClick={onSelect}
          disabled={loading}
          className={cn(
            'w-full flex items-center justify-center gap-2 py-[11px] rounded-xl text-[13px] font-semibold transition-all duration-150',
            isPro
              ? 'bg-coral text-white hover:bg-[#D4432B] shadow-[0_2px_8px_rgba(232,83,58,0.35)] hover:shadow-[0_4px_14px_rgba(232,83,58,0.4)] active:scale-[0.98]'
              : isEnterprise
              ? 'border border-[var(--border-strong)] text-[var(--fg)] hover:bg-[var(--bg-secondary)] hover:border-[var(--border-strong)]'
              : 'bg-[var(--bg-secondary)] text-[var(--fg)] border border-[var(--border)] hover:bg-[var(--bg-tertiary)] hover:border-[var(--border-strong)]'
          )}
        >
          {loading ? (
            <span className="w-4 h-4 rounded-full border-2 border-current/30 border-t-current animate-spin" />
          ) : (
            <>
              {plan.cta}
              {!isEnterprise && <ArrowRight size={13} strokeWidth={2.5} />}
            </>
          )}
        </button>

        {/* Trial note */}
        {!isFree && !isEnterprise && (
          <p className="text-center text-[11px] text-[var(--fg-tertiary)] mt-2.5">
            14-day free trial · No credit card required
          </p>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════ */
export default function PlansPage() {
  const router   = useRouter()
  const supabase = createClient()

  const [annual,   setAnnual]   = useState(true)
  const [selected, setSelected] = useState<PlanId | null>(null)
  const [loading,  setLoading]  = useState<PlanId | null>(null)
  const [error,    setError]    = useState<string | null>(null)

  async function handleSelect(planId: PlanId) {
    if (planId === 'enterprise') {
      window.location.href = 'mailto:sales@tokenfin.io?subject=Enterprise%20Inquiry'
      return
    }

    setLoading(planId)
    setSelected(planId)
    setError(null)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Create org with chosen plan
      const slug = user.email!.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-')
      const res  = await fetch('/api/v1/orgs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:     user.user_metadata?.full_name ?? slug,
          slug:     slug + '-' + Math.random().toString(36).slice(2, 6),
          plan:     planId,
          owner_id: user.id,
        }),
      })

      if (!res.ok) {
        const msg = await res.text()
        throw new Error(msg || 'Failed to create workspace')
      }

      router.push('/onboarding')
    } catch (e: any) {
      setError(e.message)
      setLoading(null)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-secondary)] text-[var(--fg)]">

      {/* Top bar */}
      <header className="sticky top-0 z-10 bg-[var(--bg)] border-b border-[var(--border)]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
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
            <Sparkles size={11} />
            Simple, transparent pricing
          </div>
          <h1 className="text-[40px] font-bold text-[var(--fg)] tracking-tight leading-[1.15] mb-4">
            The right plan for<br />every AI team
          </h1>
          <p className="text-[15px] text-[var(--fg-secondary)] max-w-md mx-auto leading-relaxed mb-8">
            Start free, upgrade when you&apos;re ready. All plans include a 14-day trial — no credit card required.
          </p>
          <BillingToggle annual={annual} onChange={setAnnual} />
        </div>

        {/* Error */}
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
              selected={selected === plan.id}
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
              <Icon size={14} className="text-teal" strokeWidth={2} />
              {label}
            </div>
          ))}
        </div>

        {/* FAQ teaser */}
        <p className="text-center mt-8 text-[12.5px] text-[var(--fg-tertiary)]">
          Questions?{' '}
          <a href="mailto:hello@tokenfin.io" className="text-coral hover:underline font-medium">
            Chat with us
          </a>
          {' '}or{' '}
          <Link href="/docs" className="text-coral hover:underline font-medium">
            read the docs
          </Link>
        </p>
      </div>
    </div>
  )
}
