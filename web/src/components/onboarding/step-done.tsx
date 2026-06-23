'use client'
import { ArrowRight, Zap, BarChart3, Key } from 'lucide-react'
import type { OnboardingData } from '@/app/(onboarding)/onboarding/_client'

const NEXT_STEPS = [
  { icon: Key,      title: 'Create an API key',       desc: 'Start tracking token usage in minutes' },
  { icon: BarChart3, title: 'Explore analytics',      desc: 'See real-time cost attribution' },
  { icon: Zap,      title: 'Set a budget limit',      desc: 'Get alerted before you overspend' },
]

export function StepDone({ data, onGo }: { data: OnboardingData; onGo: () => void }) {
  return (
    <div className="p-7 text-center">

      {/* Success animation */}
      <div className="relative mx-auto w-20 h-20 mb-7">
        <div className="absolute inset-0 rounded-full bg-teal/10 animate-ping-slow" />
        <div className="relative w-full h-full rounded-full bg-teal/15 border border-teal/30 flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-teal flex items-center justify-center">
            <svg viewBox="0 0 20 20" className="w-6 h-6 stroke-white fill-none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 10l4 4 8-8" />
            </svg>
          </div>
        </div>
      </div>

      <h2 className="text-[22px] font-bold text-[var(--fg)] tracking-tight mb-2">
        Your workspace is ready!
      </h2>
      <p className="text-[13.5px] text-[var(--fg-secondary)] mb-1">
        Project <span className="font-semibold text-[var(--fg)]">{data.projectName}</span> created.
      </p>
      {data.invites.length > 0 && (
        <p className="text-[12px] text-teal font-medium mb-1">
          {data.invites.length} invite{data.invites.length !== 1 ? 's' : ''} sent ✓
        </p>
      )}

      {/* What's next */}
      <div className="mt-7 mb-7 text-left space-y-3">
        <p className="text-[11px] font-semibold tracking-widest text-[var(--fg-tertiary)] uppercase px-1 mb-4">
          Suggested next steps
        </p>
        {NEXT_STEPS.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="flex items-start gap-3 px-3.5 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
            <div className="w-8 h-8 rounded-lg bg-coral/10 flex items-center justify-center flex-shrink-0">
              <Icon size={14} className="text-coral" strokeWidth={2} />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-[var(--fg)]">{title}</p>
              <p className="text-[11.5px] text-[var(--fg-secondary)]">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={onGo}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-coral text-white text-[13.5px] font-semibold hover:bg-[#D4432B] shadow-[0_2px_8px_rgba(232,83,58,0.3)] hover:shadow-[0_4px_14px_rgba(232,83,58,0.38)] active:scale-[0.985] transition-all duration-150"
      >
        Go to dashboard <ArrowRight size={14} strokeWidth={2.5} />
      </button>
    </div>
  )
}
