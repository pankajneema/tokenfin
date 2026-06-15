'use client'

import { useState } from 'react'
import type { OnboardingData } from '@/app/(onboarding)/onboarding/page'

export function StepDone({
  data, onGo,
}: { data: OnboardingData; onGo: () => void }) {
  const [loading, setLoading] = useState(false)

  const handleGoToDashboard = async () => {
    setLoading(true)
    // Wait a moment for database to sync before redirecting
    await new Promise(resolve => setTimeout(resolve, 500))
    onGo()
  }

  return (
    <div className="text-center py-4">
      {/* Checkmark animation */}
      <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
           style={{ background: 'color-mix(in srgb, var(--success) 12%, var(--bg))', border: '2px solid var(--success)' }}>
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <path d="M7 16l6 6 12-12" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <h1 className="text-xl font-semibold mb-2" style={{ color: 'var(--fg)' }}>
        You're all set!
      </h1>
      <p className="text-sm mb-8 max-w-sm mx-auto" style={{ color: 'var(--fg-muted)' }}>
        <strong style={{ color: 'var(--fg)' }}>{data.orgName}</strong> is ready.
        Your first project <strong style={{ color: 'var(--fg)' }}>{data.projectName}</strong> is live.
        {data.invites.length > 0 && ` Invitations sent to ${data.invites.length} teammate${data.invites.length > 1 ? 's' : ''}.`}
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-8 text-left">
        {[
          { label: 'Organization', value: data.orgName,     icon: '🏢' },
          { label: 'Plan',         value: data.plan,        icon: '📋' },
          { label: 'Project',      value: data.projectName, icon: '📁' },
        ].map(item => (
          <div key={item.label} className="rounded-lg p-3"
               style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--border)' }}>
            <div className="text-lg mb-1">{item.icon}</div>
            <div className="text-xs capitalize font-semibold" style={{ color: 'var(--fg)' }}>{item.value}</div>
            <div className="text-xs" style={{ color: 'var(--fg-muted)' }}>{item.label}</div>
          </div>
        ))}
      </div>

      {/* Next steps */}
      <div className="text-left rounded-xl p-4 mb-8"
           style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--border)' }}>
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--fg-muted)' }}>
          Next steps
        </p>
        <div className="space-y-2">
          {[
            { n: 1, text: 'Create an API key from the Keys page' },
            { n: 2, text: 'Install the SDK: npm install @tokenfin/sdk' },
            { n: 3, text: 'Add track() calls to your LLM code' },
            { n: 4, text: 'Set up budget limits and alerts' },
          ].map(step => (
            <div key={step.n} className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-semibold"
                    style={{ background: 'var(--accent)', color: '#fff' }}>
                {step.n}
              </span>
              <span className="text-sm" style={{ color: 'var(--fg)' }}>{step.text}</span>
            </div>
          ))}
        </div>
      </div>

      <button className="btn-primary w-full" onClick={handleGoToDashboard} disabled={loading}>
        {loading ? 'Loading…' : 'Go to Dashboard →'}
      </button>
    </div>
  )
}
