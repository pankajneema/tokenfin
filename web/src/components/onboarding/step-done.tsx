'use client'
import { useState } from 'react'
import { ArrowRight, Terminal, Copy, Check } from 'lucide-react'
import type { OnboardingData } from '@/app/(onboarding)/onboarding/_client'

const COMMAND = 'npx tokenfin@latest setup'

/**
 * Last onboarding step. No "create an API key" detour — `setup` signs the
 * developer in and mints this device's keys itself. The primary CTA goes to
 * /dashboard/setup, which shows the same command and a live "waiting for
 * first event" beacon.
 */
export function StepDone({ data, onGo }: { data: OnboardingData; onGo: (href: string) => void }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard?.writeText(COMMAND).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400) })
  }

  return (
    <div className="p-7 text-center">
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

      <div className="mt-7 mb-7 text-left">
        <p className="text-[11px] font-semibold tracking-widest text-[var(--fg-tertiary)] uppercase px-1 mb-3">
          Last step — connect your coding agent
        </p>
        <div className="rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] px-3.5 py-3">
          <div className="flex items-center gap-2 text-[12px] text-[var(--fg-secondary)] mb-2">
            <Terminal size={13} className="text-coral" /> Run this in your terminal:
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] px-3 py-2">
            <code className="font-mono text-[13px] text-[var(--fg)] overflow-x-auto">$ {COMMAND}</code>
            <button onClick={copy} className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[11.5px] text-[var(--fg-secondary)] hover:bg-[var(--bg-tertiary)]">
              {copied ? <><Check size={12} className="text-teal" />Copied</> : <><Copy size={12} />Copy</>}
            </button>
          </div>
          <p className="mt-2 text-[11.5px] text-[var(--fg-tertiary)]">
            Signs you in, creates this device’s keys and configures Claude Code, Codex, Gemini and OpenCode —
            then the next page lights up the moment your first event arrives.
          </p>
        </div>
      </div>

      <button
        onClick={() => onGo('/dashboard/setup')}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-coral text-white text-[13.5px] font-semibold hover:bg-[#D4432B] shadow-[0_2px_8px_rgba(232,83,58,0.3)] hover:shadow-[0_4px_14px_rgba(232,83,58,0.38)] active:scale-[0.985] transition-all duration-150"
      >
        I ran it — wait for my first event <ArrowRight size={14} strokeWidth={2.5} />
      </button>
      <button
        onClick={() => onGo('/dashboard')}
        className="w-full mt-2 py-2.5 text-[12.5px] text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)] transition-colors font-medium"
      >
        Skip to the dashboard
      </button>
    </div>
  )
}
