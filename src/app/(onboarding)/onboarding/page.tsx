'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { StepOrg }    from '@/components/onboarding/step-org'
import { StepPlan }   from '@/components/onboarding/step-plan'
import { StepProject } from '@/components/onboarding/step-project'
import { StepInvite }  from '@/components/onboarding/step-invite'
import { StepDone }    from '@/components/onboarding/step-done'

export type OnboardingData = {
  orgName:     string
  orgSlug:     string
  plan:        'free' | 'starter' | 'pro' | 'enterprise'
  projectName: string
  projectDesc: string
  orgId:       string
  projectId:   string
  invites:     string[]
}

const STEPS = ['Organization', 'Plan', 'Project', 'Invite', 'Done'] as const
type Step = 0 | 1 | 2 | 3 | 4

export default function OnboardingPage() {
  const router = useRouter()
  const supabase = createClient()

  const [step, setStep] = useState<Step>(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<OnboardingData>({
    orgName: '', orgSlug: '', plan: 'free',
    projectName: '', projectDesc: '',
    orgId: '', projectId: '', invites: [],
  })

  const pct = Math.round((step / (STEPS.length - 1)) * 100)

  function patch(partial: Partial<OnboardingData>) {
    setData(d => ({ ...d, ...partial }))
  }

  async function handleOrgNext(orgName: string, orgSlug: string) {
    setSaving(true); setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const res = await fetch('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: orgName, slug: orgSlug, owner_id: user.id }),
      })
      if (!res.ok) throw new Error(await res.text())
      const org = await res.json()
      patch({ orgName, orgSlug, orgId: org.id })
      setStep(1)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handlePlanNext(plan: OnboardingData['plan']) {
    setSaving(true); setError('')
    try {
      await fetch('/api/orgs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: data.orgId, plan }),
      })
      patch({ plan })
      setStep(2)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleProjectNext(projectName: string, projectSlug: string, projectDesc: string) {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: data.orgId, name: projectName, slug: projectSlug, description: projectDesc }),
      })
      if (!res.ok) throw new Error(await res.text())
      const project = await res.json()
      patch({ projectName, projectDesc, projectId: project.id })
      setStep(3)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleInviteNext(invites: string[]) {
    setSaving(true); setError('')
    try {
      if (invites.length > 0) {
        await fetch('/api/invites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ org_id: data.orgId, emails: invites }),
        })
      }
      patch({ invites })
      setStep(4)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      {/* Top bar */}
      <header className="flex items-center justify-between px-8 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-sm font-bold"
               style={{ background: 'var(--accent)' }}>T</div>
          <span className="font-semibold text-sm" style={{ color: 'var(--fg)' }}>TokenFin</span>
        </div>
        <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
          Step {step + 1} of {STEPS.length}
        </span>
      </header>

      {/* Progress bar */}
      <div className="h-1 w-full" style={{ background: 'var(--border)' }}>
        <div
          className="h-1 transition-all duration-500 ease-out"
          style={{ width: `${pct}%`, background: 'var(--accent)' }}
        />
      </div>

      {/* Step tabs */}
      <div className="flex items-center justify-center gap-0 pt-8 pb-2 px-4">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all"
                style={{
                  background: i < step ? 'var(--accent)' : i === step ? 'var(--accent)' : 'var(--border)',
                  color:      i <= step ? '#fff' : 'var(--fg-muted)',
                }}
              >
                {i < step ? '✓' : i + 1}
              </div>
              <span className="text-xs hidden sm:block" style={{ color: i === step ? 'var(--accent)' : 'var(--fg-muted)' }}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className="w-12 sm:w-20 h-px mx-1 mt-[-10px]"
                   style={{ background: i < step ? 'var(--accent)' : 'var(--border)' }} />
            )}
          </div>
        ))}
      </div>

      {/* Card */}
      <main className="flex-1 flex items-start justify-center px-4 pt-6 pb-16">
        <div className="card w-full max-w-lg">
          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg text-sm"
                 style={{ background: '#fff0ed', color: 'var(--accent)', border: '1px solid #f9c5bb' }}>
              {error}
            </div>
          )}

          {step === 0 && <StepOrg    data={data} onNext={handleOrgNext}     saving={saving} />}
          {step === 1 && <StepPlan   data={data} onNext={handlePlanNext}    saving={saving} />}
          {step === 2 && <StepProject data={data} onNext={handleProjectNext} saving={saving} />}
          {step === 3 && <StepInvite  data={data} onNext={handleInviteNext}  saving={saving} />}
          {step === 4 && <StepDone    data={data} onGo={() => router.push('/dashboard')} />}
        </div>
      </main>
    </div>
  )
}
