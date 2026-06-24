'use client'
import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Circle, ChevronDown, ChevronUp, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Step {
  id:       string
  label:    string
  desc:     string
  href:     string
  done:     boolean
  current:  boolean
}

interface Props {
  hasProject: boolean
  hasApiKey:  boolean
  hasEvent:   boolean
}

export function OnboardingChecklist({ hasProject, hasApiKey, hasEvent }: Props) {
  const [dismissed, setDismissed] = useState(false)
  const [expanded,  setExpanded]  = useState(true)

  if (dismissed) return null

  const steps: Step[] = [
    {
      id:      'org',
      label:   'Create your organisation',
      desc:    'Your workspace is live.',
      href:    '/dashboard/settings/billing',
      done:    true,
      current: false,
    },
    {
      id:      'project',
      label:   'Create a project',
      desc:    'Group your API usage by product or team.',
      href:    '/dashboard/projects',
      done:    hasProject,
      current: !hasProject,
    },
    {
      id:      'key',
      label:   'Create an API key',
      desc:    'Use it in your proxy or SDK to authenticate.',
      href:    '/dashboard/keys',
      done:    hasApiKey,
      current: hasProject && !hasApiKey,
    },
    {
      id:      'event',
      label:   'Send your first event',
      desc:    'POST usage to /api/v1/ingest — then this dashboard lights up.',
      href:    'https://docs.tokenfin.io/quickstart',
      done:    hasEvent,
      current: hasProject && hasApiKey && !hasEvent,
    },
  ]

  const doneCount  = steps.filter(s => s.done).length
  const totalCount = steps.length
  const pct        = Math.round((doneCount / totalCount) * 100)
  const allDone    = doneCount === totalCount

  if (allDone) return null   // once fully complete, hide it

  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-5 py-4 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        {/* Progress ring (SVG) */}
        <svg width="36" height="36" viewBox="0 0 36 36" className="flex-shrink-0 -rotate-90">
          <circle cx="18" cy="18" r="15" fill="none" stroke="var(--border)" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15" fill="none"
            stroke="var(--green)" strokeWidth="3"
            strokeDasharray={`${2 * Math.PI * 15}`}
            strokeDashoffset={`${2 * Math.PI * 15 * (1 - pct / 100)}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
          <text
            x="18" y="18"
            textAnchor="middle" dominantBaseline="central"
            fontSize="9" fontWeight="700"
            fill="var(--fg)"
            style={{ transform: 'rotate(90deg)', transformOrigin: '18px 18px' }}
          >
            {doneCount}/{totalCount}
          </text>
        </svg>

        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-semibold text-[var(--fg)]">Get started with TokenFin</p>
          <p className="text-[12px] text-[var(--fg-secondary)]">
            {doneCount} of {totalCount} steps complete — {totalCount - doneCount} remaining
          </p>
        </div>

        <div className="flex items-center gap-2">
          {expanded
            ? <ChevronUp   size={15} className="text-[var(--fg-tertiary)]" />
            : <ChevronDown size={15} className="text-[var(--fg-tertiary)]" />}
          <button
            onClick={e => { e.stopPropagation(); setDismissed(true) }}
            className="p-1 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]">
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Steps */}
      {expanded && (
        <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]">
          {steps.map((step, i) => (
            <Link
              key={step.id}
              href={step.href}
              target={step.href.startsWith('http') ? '_blank' : undefined}
              rel={step.href.startsWith('http') ? 'noopener noreferrer' : undefined}
              className={cn(
                'flex items-start gap-3 px-5 py-3.5 transition-colors group',
                step.done
                  ? 'opacity-60 pointer-events-none'
                  : step.current
                    ? 'bg-[var(--green-bg)] hover:bg-[var(--green-bg)]'
                    : 'hover:bg-[var(--bg-secondary)]'
              )}>
              {/* Icon */}
              <div className="mt-0.5 flex-shrink-0">
                {step.done
                  ? <CheckCircle2 size={17} className="text-[var(--green)]" />
                  : <Circle       size={17} className={cn(
                      step.current ? 'text-[var(--green)]' : 'text-[var(--fg-tertiary)]'
                    )} />
                }
              </div>

              {/* Text */}
              <div className="flex-1 min-w-0">
                <p className={cn(
                  'text-[13px] font-medium',
                  step.done    ? 'line-through text-[var(--fg-tertiary)]'   :
                  step.current ? 'text-[var(--fg)]'                          :
                                 'text-[var(--fg-secondary)]'
                )}>
                  {step.label}
                </p>
                {!step.done && (
                  <p className="text-[11.5px] text-[var(--fg-tertiary)] mt-0.5">{step.desc}</p>
                )}
              </div>

              {/* Step number / "Start" pill */}
              {!step.done && (
                <span className={cn(
                  'flex-shrink-0 text-[10.5px] font-bold px-2 py-0.5 rounded-full self-center',
                  step.current
                    ? 'bg-[var(--green)] text-white'
                    : 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]'
                )}>
                  {step.current ? 'Start →' : `Step ${i + 1}`}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
