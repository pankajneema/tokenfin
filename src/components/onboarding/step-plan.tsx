'use client'

import { useState } from 'react'
import type { OnboardingData } from '@/app/(onboarding)/onboarding/page'

type Plan = OnboardingData['plan']

const PLANS: { id: Plan; name: string; price: string; features: string[] }[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0 / mo',
    features: ['1 project', '5 team members', '1M tokens / mo', 'Basic analytics', '7-day data retention'],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: '$29 / mo',
    features: ['5 projects', '20 team members', '10M tokens / mo', 'Advanced analytics', '30-day data retention'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$99 / mo',
    features: ['Unlimited projects', 'Unlimited members', 'Unlimited tokens', 'Custom alerts', '90-day data retention'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    features: ['Everything in Pro', 'SSO / SAML', 'SLA guarantee', 'Dedicated support', 'Custom data retention'],
  },
]

export function StepPlan({
  data, onNext, saving,
}: { data: OnboardingData; onNext: (plan: Plan) => void; saving: boolean }) {
  const [selected, setSelected] = useState<Plan>(data.plan)

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--fg)' }}>
        Choose a plan
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--fg-muted)' }}>
        You can upgrade or downgrade at any time. All plans include a 14-day free trial.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PLANS.map(plan => {
          const active = selected === plan.id
          return (
            <button
              key={plan.id}
              onClick={() => setSelected(plan.id)}
              className="text-left p-4 rounded-xl border transition-all"
              style={{
                borderColor:  active ? 'var(--accent)' : 'var(--border)',
                background:   active ? 'color-mix(in srgb, var(--accent) 8%, var(--bg))' : 'var(--bg)',
                boxShadow:    active ? '0 0 0 1px var(--accent)' : 'none',
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm" style={{ color: 'var(--fg)' }}>{plan.name}</span>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                      style={{ background: active ? 'var(--accent)' : 'var(--border)', color: active ? '#fff' : 'var(--fg-muted)' }}>
                  {plan.price}
                </span>
              </div>
              <ul className="space-y-1">
                {plan.features.map(f => (
                  <li key={f} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--fg-muted)' }}>
                    <span style={{ color: 'var(--success)' }}>✓</span> {f}
                  </li>
                ))}
              </ul>
            </button>
          )
        })}
      </div>

      <div className="flex justify-between mt-8">
        <p className="text-xs self-center" style={{ color: 'var(--fg-muted)' }}>
          14-day free trial · No credit card required
        </p>
        <button className="btn-primary" onClick={() => onNext(selected)} disabled={saving}>
          {saving ? 'Saving…' : 'Continue →'}
        </button>
      </div>
    </div>
  )
}
