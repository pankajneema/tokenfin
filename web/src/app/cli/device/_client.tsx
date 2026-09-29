'use client'

import { useState } from 'react'
import { Terminal, ShieldCheck, Check, AlertCircle, Loader2 } from 'lucide-react'

export function CliDeviceClient({
  initialCode, device, deviceId, email, hasOrg,
}: {
  initialCode: string; device: string; deviceId: string; email: string; hasOrg: boolean
}) {
  const [code, setCode] = useState(initialCode)
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [err, setErr] = useState<string | null>(null)

  async function approve(e: React.FormEvent) {
    e.preventDefault()
    setStatus('working'); setErr(null)
    try {
      const res = await fetch('/api/v1/cli/device/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_code: code, device: device || undefined, device_id: deviceId || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not approve this code')
      setStatus('done')
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
            <h1 className="text-[18px] font-bold tracking-tight text-[var(--fg)]">Approve a device</h1>
            <p className="text-[12.5px] text-[var(--fg-secondary)]">Signed in as {email || 'your account'}</p>
          </div>
        </div>

        {!hasOrg ? (
          <Banner tone="error">Your account isn’t part of an organization yet. Finish onboarding, then run the login again.</Banner>
        ) : status === 'done' ? (
          <Banner tone="ok">
            <span className="inline-flex items-center gap-1.5"><Check size={14} /> Approved — your terminal will finish signing in within a few seconds. You can close this tab.</span>
          </Banner>
        ) : (
          <form onSubmit={approve}>
            <p className="mb-4 text-[13px] leading-relaxed text-[var(--fg-secondary)]">
              Enter the code shown by <code className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5 font-mono text-[11px]">npx tokenfin@latest login --device</code>
              {device ? <> on <span className="font-medium text-[var(--fg)]">{device}</span></> : null}.
              Only approve a code you started yourself — the device gets keys for your workspace.
            </p>
            <label htmlFor="user-code" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">Code</label>
            <input
              id="user-code"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="ABCDE-FGH23"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="mb-4 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3.5 py-3 text-center font-mono text-[20px] tracking-[0.2em] text-[var(--fg)] outline-none focus:border-coral"
            />
            <div className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5 text-[12px] text-[var(--fg-secondary)]">
              <div className="flex items-start gap-2.5">
                <ShieldCheck size={15} className="mt-0.5 flex-shrink-0 text-teal" />
                <span>Creates this device’s own ingest + read keys (a new login on the same device rotates them). Revoke any time under Dashboard → API Keys.</span>
              </div>
            </div>
            {status === 'error' && err && <div className="mb-3"><Banner tone="error">{err}</Banner></div>}
            <button
              type="submit"
              disabled={status === 'working' || code.replace(/[^A-Za-z0-9]/g, '').length !== 10}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-coral px-4 py-3 text-[13.5px] font-semibold text-white transition-all hover:bg-[#D4432B] disabled:opacity-60"
            >
              {status === 'working' ? <><Loader2 size={15} className="animate-spin" /> Approving…</> : <>Approve device</>}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

function Banner({ tone, children }: { tone: 'ok' | 'error'; children: React.ReactNode }) {
  const ok = tone === 'ok'
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[12px] ${ok
      ? 'border-[rgba(16,127,101,0.2)] bg-[var(--green-bg)] text-teal'
      : 'border-[rgba(153,60,29,0.18)] bg-[var(--red-bg)] text-[var(--red)]'}`}>
      {!ok && <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />}
      <span className="flex-1">{children}</span>
    </div>
  )
}
