'use client'

import { useState } from 'react'
import { Shield, Copy, Check, AlertCircle } from 'lucide-react'

/**
 * Public one-time key reveal page. The recipient (a provisioned member) opens
 * their secure link and clicks to reveal their API key exactly once. Click —
 * not auto-reveal — so email link scanners/previewers don't burn the single use.
 */
export default function RevealPage({ params }: { params: { token: string } }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [rawKey, setRawKey] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  async function reveal() {
    setState('loading')
    try {
      const res = await fetch('/api/v1/keys/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: params.token }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Unable to reveal key'); setState('error'); return }
      setRawKey(data.raw_key)
      setState('done')
    } catch {
      setError('Network error'); setState('error')
    }
  }

  function copy() {
    navigator.clipboard.writeText(rawKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-7 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--green-bg)]">
          <Shield size={24} className="text-teal" />
        </div>

        {state === 'idle' && (
          <>
            <h1 className="mb-1 text-[17px] font-bold text-[var(--fg)]">Your TokenFin API key</h1>
            <p className="mb-6 text-[13px] text-[var(--fg-secondary)]">
              Click below to reveal your key. For your security it can be viewed
              <span className="font-semibold text-[var(--fg)]"> only once</span> — copy and store it safely.
            </p>
            <button onClick={reveal} className="btn-primary w-full justify-center">Reveal my key</button>
          </>
        )}

        {state === 'loading' && <p className="text-[13px] text-[var(--fg-secondary)]">Revealing…</p>}

        {state === 'done' && (
          <>
            <h1 className="mb-1 text-[17px] font-bold text-[var(--fg)]">Here is your key</h1>
            <p className="mb-4 text-[13px] text-[var(--fg-secondary)]">
              Copy it now — it will never be shown again.
            </p>
            <div className="mb-3 flex items-center gap-2 rounded-xl bg-[var(--bg-tertiary)] p-3 text-left">
              <code className="flex-1 break-all font-mono text-[11.5px] leading-relaxed text-[var(--fg)]">{rawKey}</code>
              <button onClick={copy} className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--fg)] hover:bg-[var(--bg-hover)]">
                {copied ? <><Check size={12} className="text-teal" />Copied</> : <><Copy size={12} />Copy</>}
              </button>
            </div>
            <p className="text-[11.5px] text-[var(--fg-tertiary)]">
              Add it to your tool as <code className="font-mono">Authorization: Bearer …</code>
            </p>
          </>
        )}

        {state === 'error' && (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--red-bg)]">
              <AlertCircle size={24} className="text-red-500" />
            </div>
            <h1 className="mb-1 text-[17px] font-bold text-[var(--fg)]">Can’t reveal this key</h1>
            <p className="text-[13px] text-[var(--fg-secondary)]">{error}</p>
            <p className="mt-3 text-[11.5px] text-[var(--fg-tertiary)]">Ask your admin to re-issue a key for you.</p>
          </>
        )}
      </div>
    </div>
  )
}
