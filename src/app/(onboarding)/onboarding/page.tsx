'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Zap } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { StepProject } from '@/components/onboarding/step-project'
import { StepInvite }  from '@/components/onboarding/step-invite'
import { StepDone }    from '@/components/onboarding/step-done'
import { cn } from '@/lib/utils'

export type OnboardingData = {
  projectName: string
  projectSlug: string
  projectDesc: string
  projectId:   string
  orgId:       string
  invites:     string[]
}

const STEPS = [
  { id: 0, label: 'Create project',  desc: 'Set up your first project' },
  { id: 1, label: 'Invite your team', desc: 'Bring your teammates in' },
  { id: 2, label: 'All done!',        desc: "Your workspace is ready" },
] as const

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center">
      {[0, 1].map((i) => {
        const done   = i < current
        const active = i === current
        return (
          <div key={i} className="flex items-center">
            <div className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold transition-all duration-300',
              done   ? 'bg-teal text-white'
                : active ? 'bg-coral text-white ring-4 ring-coral/20'
                : 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)] border border-[var(--border)]'
            )}>
              {done ? (
                <svg viewBox="0 0 12 12" className="w-3.5 h-3.5 stroke-white fill-none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 6l3 3 5-5" />
                </svg>
              ) : i + 1}
            </div>
            {i < 1 && (
              <div className={cn(
                'w-16 h-px mx-1.5 transition-all duration-500',
                done ? 'bg-teal' : 'bg-[var(--border)]'
              )} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function OnboardingPage() {
  const router   = useRouter()
  const supabase = createClient()

  const [step,   setStep]   = useState<0 | 1 | 2>(0)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [data,   setData]   = useState<OnboardingData>({
    projectName: '', projectSlug: '', projectDesc: '',
    projectId: '', orgId: '', invites: [],
  })

  function patch(partial: Partial<OnboardingData>) {
    setData(d => ({ ...d, ...partial }))
  }

  async function handleProjectNext(projectName: string, projectSlug: string, projectDesc: string) {
    setSaving(true); setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data: member } = await supabase
        .from('members')
        .select('org_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle()

      if (!member) throw new Error('No workspace found. Please select a plan first.')

      const res = await fetch('/api/v1/projects', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ org_id: member.org_id, name: projectName, slug: projectSlug, description: projectDesc }),
      })
      if (!res.ok) throw new Error(await res.text())
      const project = await res.json()

      patch({ projectName, projectSlug, projectDesc, projectId: project.id, orgId: member.org_id })
      setStep(1)
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
        await fetch('/api/v1/invites', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ org_id: data.orgId, emails: invites }),
        })
      }
      patch({ invites })
      setStep(2)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const currentStep = STEPS[step]

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-secondary)]">

      <header className="flex items-center justify-between px-8 py-4 bg-[var(--bg)] border-b border-[var(--border)]">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-coral rounded-xl flex items-center justify-center">
            <Zap size={15} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="text-[15px] font-bold text-[var(--fg)]">TokenFin</span>
        </Link>
        <span className="text-[12px] text-[var(--fg-tertiary)] font-medium">Workspace setup</span>
      </header>

      <div className="h-[3px] bg-[var(--border)]">
        <div className="h-full bg-coral transition-all duration-500 ease-out" style={{ width: `${(step / 2) * 100}%` }} />
      </div>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-[520px]">

          {step < 2 && (
            <div className="flex flex-col items-center mb-10">
              <StepIndicator current={step} />
              <div className="mt-6 text-center">
                <p className="text-[11px] font-semibold tracking-widest text-[var(--fg-tertiary)] uppercase mb-1.5">Step {step + 1} of 2</p>
                <h1 className="text-[24px] font-bold text-[var(--fg)] tracking-tight">{currentStep.label}</h1>
                <p className="text-[13.5px] text-[var(--fg-secondary)] mt-1">{currentStep.desc}</p>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-5 px-4 py-3 rounded-xl bg-[var(--red-bg)] border border-[rgba(153,60,29,0.2)] text-[12.5px] text-[var(--red)] text-center">
              {error}
            </div>
          )}

          <div className="bg-[var(--bg)] rounded-2xl border border-[var(--border)] shadow-soft overflow-hidden">
            {step === 0 && <StepProject saving={saving} onNext={handleProjectNext} />}
            {step === 1 && <StepInvite  saving={saving} onNext={handleInviteNext} onSkip={() => setStep(2)} />}
            {step === 2 && <StepDone    data={data} onGo={() => router.push('/dashboard')} />}
          </div>
        </div>
      </main>
    </div>
  )
}
