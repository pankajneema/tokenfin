'use client'

import { useState } from 'react'
import { Terminal, ShieldCheck, Check, AlertCircle, Loader2 } from 'lucide-react'

export function CliAuthorizeClient({
  valid, hasOrg, port, state, label, email,
}: {
  valid: boolean; hasOrg: boolean; port: number; state: string; label: string; email: string
}) {
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [err, setErr] = useState<string | null>(null)

  async function approve() {
    setStatus('working'); setErr(null)
    try {
      const res = await fetch('/api/v1/cli/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to authorize')
      setStatus('done')
      // Hand the single-use token to the local CLI over loopback.
      window.location.href =
        `http://127.0.0.1:${port}/callback?token=${encodeURIComponent(data.token)}&state=${encodeURIComponent(state)}`
    } catch (e: any) {
      setStatus('error'); setErr(e?.message ?? 'Something went wrong')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-7 shadow-soft">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--green-bg)]">
            <Terminal size={20} className="text-teal" />
          </div>
          <div>
            <h1 className="text-[18px] font-bold tracking-tight text-[var(--fg)]">Authorize TokenFin CLI</h1>
            <p className="text-[12.5px] text-[var(--fg-secondary)]">Signed in as {email || 'your account'}</p>
          </div>
        </div>

        {!valid ? (
          <Banner tone="error">
            This authorization link is invalid or has expired. Return to your terminal and run
            <code className="mx-1 rounded bg-[var(--bg-tertiary)] px-1 py-0.5 font-mono text-[11px]">tokenfin login</code>
            again.
          </Banner>
        ) : !hasOrg ? (
          <Banner tone="error">
            Your account isn’t part of an organization yet. Finish onboarding in the dashboard, then run
            <code className="mx-1 rounded bg-[var(--bg-tertiary)] px-1 py-0.5 font-mono text-[11px]">tokenfin login</code>
            again.
          </Banner>
        ) : (
          <>
            <p className="mb-4 text-[13px] leading-relaxed text-[var(--fg-secondary)]">
              A TokenFin CLI on this device (<span className="font-medium text-[var(--fg)]">{label}</span>) wants to
              create an API key for your workspace so it can record usage and read analytics.
            </p>

            <div className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5 text-[12px] text-[var(--fg-secondary)]">
              <div className="flex items-start gap-2.5">
                <ShieldCheck size={15} className="mt-0.5 flex-shrink-0 text-teal" />
                <span>
                  The key is delivered once over a local, single-use link (<code className="font-mono text-[11px]">127.0.0.1:{port}</code>).
                  You can revoke it any time under Dashboard → API Keys.
                </span>
              </div>
            </div>

            {status === 'error' && err && <Banner tone="error">{err}</Banner>}

            {status === 'done' ? (
              <Banner tone="ok">
                <span className="inline-flex items-center gap-1.5"><Check size={14} /> Authorized — return to your terminal. You can close this tab.</span>
              </Banner>
            ) : (
              <div className="flex gap-2.5">
                <button
                  onClick={approve}
                  disabled={status === 'working'}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-coral px-4 py-3 text-[13.5px] font-semibold text-white transition-all hover:bg-[#D4432B] disabled:opacity-60"
                >
                  {status === 'working'
                    ? <><Loader2 size={15} className="animate-spin" /> Authorizing…</>
                    : <>Authorize this device</>}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Banner({ tone, children }: { tone: 'ok' | 'error'; children: React.ReactNode }) {
  const ok = tone === 'ok'
  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[12px] ${
        ok
          ? 'border-[rgba(16,127,101,0.2)] bg-[var(--green-bg)] text-teal'
          : 'border-[rgba(153,60,29,0.18)] bg-[var(--red-bg)] text-[var(--red)]'
      }`}
    >
      {!ok && <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />}
      <span className="flex-1">{children}</span>
    </div>
  )
}
