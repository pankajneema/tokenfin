'use client'

import { useState } from 'react'
import type { OnboardingData } from '@/app/(onboarding)/onboarding/page'

function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
}

export function StepInvite({
  data, onNext, saving,
}: { data: OnboardingData; onNext: (invites: string[]) => void; saving: boolean }) {
  const [input, setInput]   = useState('')
  const [invites, setInvites] = useState<string[]>(data.invites)
  const [inputErr, setInputErr] = useState('')

  function addEmail() {
    const email = input.trim().toLowerCase()
    if (!email) return
    if (!isValidEmail(email)) { setInputErr('Invalid email address'); return }
    if (invites.includes(email)) { setInputErr('Already added'); return }
    setInvites(prev => [...prev, email])
    setInput('')
    setInputErr('')
  }

  function removeEmail(email: string) {
    setInvites(prev => prev.filter(e => e !== email))
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addEmail()
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--fg)' }}>
        Invite your team
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--fg-muted)' }}>
        Add teammates to <strong style={{ color: 'var(--fg)' }}>{data.orgName}</strong>. They'll get an email invite to join.
      </p>

      {/* Email input */}
      <div>
        <label className="label">Email addresses</label>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="colleague@company.com"
            type="email"
            value={input}
            onChange={e => { setInput(e.target.value); setInputErr('') }}
            onKeyDown={handleKey}
          />
          <button className="btn-secondary px-4" onClick={addEmail} disabled={!input.trim()}>
            Add
          </button>
        </div>
        {inputErr && <p className="text-xs mt-1" style={{ color: 'var(--accent)' }}>{inputErr}</p>}
        <p className="text-xs mt-1" style={{ color: 'var(--fg-muted)' }}>
          Press Enter or comma to add multiple
        </p>
      </div>

      {/* Invite list */}
      {invites.length > 0 && (
        <div className="mt-4 space-y-2">
          {invites.map(email => (
            <div key={email} className="flex items-center justify-between px-3 py-2 rounded-lg"
                 style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                     style={{ background: 'var(--accent)' }}>
                  {email[0].toUpperCase()}
                </div>
                <span className="text-sm" style={{ color: 'var(--fg)' }}>{email}</span>
              </div>
              <button onClick={() => removeEmail(email)}
                      className="text-xs px-2 py-0.5 rounded"
                      style={{ color: 'var(--fg-muted)', background: 'var(--border)' }}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mt-8">
        <button className="btn-ghost text-sm" onClick={() => onNext([])}>
          Skip for now
        </button>
        <button
          className="btn-primary"
          onClick={() => onNext(invites)}
          disabled={saving}
        >
          {saving ? 'Sending invites…' : invites.length > 0 ? `Invite ${invites.length} teammate${invites.length > 1 ? 's' : ''} →` : 'Continue →'}
        </button>
      </div>
    </div>
  )
}
