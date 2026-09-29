'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Shield, Copy, Check, AlertCircle } from 'lucide-react'

/**
 * Public one-time key reveal page. The recipient (a provisioned member) opens
 * their secure link and clicks to reveal their API key exactly once. Click —
 * not auto-reveal — so email link scanners/previewers don't burn the single use.
 */
export default function RevealPage() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [rawKey, setRawKey] = useState('')
  const [ingestKey, setIngestKey] = useState<string | null>(null)
  const [readKey, setReadKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  async function reveal() {
    setState('loading')
    try {
      const res = await fetch('/api/v1/keys/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Unable to reveal key'); setState('error'); return }
      setRawKey(data.raw_key)
      // Split keys (ingest + read) when the server provides them; a legacy
      // read+write key is used for both.
      const hasSplit = 'ingest_key' in data || 'read_key' in data
      setIngestKey(hasSplit ? (data.ingest_key ?? null) : data.raw_key)
      setReadKey(hasSplit ? (data.read_key ?? null) : data.raw_key)
      setState('done')
    } catch {
      setError('Network error'); setState('error')
    }
  }

  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(c => (c === id ? null : c)), 2000)
  }

  // The exact one-liner that connects this machine with these keys. The CLI
  // defaults to the hosted app, so self-hosted / preview origins add --app-url.
  const DEFAULT_ORIGIN = 'https://tokenfin.curiousdevs.com'
  const origin = typeof window !== 'undefined' ? window.location.origin : DEFAULT_ORIGIN
  const command = ingestKey
    ? ['npx tokenfin@latest setup --key', ingestKey,
        ...(readKey && readKey !== ingestKey ? ['--read-key', readKey] : []),
        ...(origin !== DEFAULT_ORIGIN ? ['--app-url', origin] : [])].join(' ')
    : null

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
            <h1 className="mb-1 text-[17px] font-bold text-[var(--fg)]">Connect this machine</h1>
            <p className="mb-4 text-[13px] text-[var(--fg-secondary)]">
              Copy it now — {command ? 'these keys' : 'this key'} will never be shown again.
            </p>
            {command ? (
              <>
                <p className="mb-1.5 text-left text-[11px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">Run in your terminal</p>
                <div className="mb-2 flex items-center gap-2 rounded-xl bg-[var(--bg-tertiary)] p-3 text-left">
                  <code className="flex-1 break-all font-mono text-[11.5px] leading-relaxed text-[var(--fg)]">{command}</code>
                  <CopyButton done={copied === 'cmd'} onClick={() => copy(command, 'cmd')} />
                </div>
                <p className="mb-4 text-left text-[11.5px] text-[var(--fg-tertiary)]">
                  Configures Claude Code, Codex, Gemini and OpenCode on this machine and waits for your first event.
                  Add <code className="font-mono">--no-prompts</code> to never send prompt text.
                </p>
              </>
            ) : (
              <p className="mb-3 text-left text-[12px] text-[var(--fg-secondary)]">
                Your role is read-only, so this is a <span className="font-medium">read</span> key: use it for the MCP server or API reads, not for sending usage.
              </p>
            )}
            <details className="text-left text-[12px] text-[var(--fg-secondary)]" open={!command}>
              <summary className="cursor-pointer text-[var(--fg-tertiary)]">Show the raw key{readKey && readKey !== ingestKey && ingestKey ? 's' : ''}</summary>
              {[
                ...(ingestKey ? [{ id: 'ingest', label: readKey && readKey !== ingestKey ? 'Ingest key' : 'Key', value: ingestKey }] : []),
                ...(readKey && readKey !== ingestKey ? [{ id: 'read', label: 'Read key', value: readKey }] : []),
                ...(!ingestKey && !readKey ? [{ id: 'raw', label: 'Key', value: rawKey }] : []),
              ].map(k => (
                <div key={k.id} className="mt-2">
                  <div className="mb-1 text-[11px] text-[var(--fg-tertiary)]">{k.label}</div>
                  <div className="flex items-center gap-2 rounded-xl bg-[var(--bg-tertiary)] p-3">
                    <code className="flex-1 break-all font-mono text-[11.5px] leading-relaxed text-[var(--fg)]">{k.value}</code>
                    <CopyButton done={copied === k.id} onClick={() => copy(k.value, k.id)} />
                  </div>
                </div>
              ))}
            </details>
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

function CopyButton({ done, onClick }: { done: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--fg)] hover:bg-[var(--bg-hover)]">
      {done ? <><Check size={12} className="text-teal" />Copied</> : <><Copy size={12} />Copy</>}
    </button>
  )
}
