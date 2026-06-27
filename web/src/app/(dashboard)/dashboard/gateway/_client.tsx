'use client'

import { useState } from 'react'
import { Gauge, Copy, Check, ShieldCheck } from 'lucide-react'

export function GatewayClient({ gatewayUrl }: { gatewayUrl: string }) {
  const [copied, setCopied] = useState('')
  const copy = (t: string, tag: string) => { navigator.clipboard.writeText(t); setCopied(tag); setTimeout(() => setCopied(''), 2000) }

  const claudeEnv = `export ANTHROPIC_BASE_URL="${gatewayUrl}"
export TOKENFIN_KEY="tfk_prod_xxxx_…"   # from Dashboard → API Keys`
  const codexEnv = `export OPENAI_BASE_URL="${gatewayUrl}/v1"
export TOKENFIN_KEY="tfk_prod_xxxx_…"`
  const header = `x-tokenfin-key: tfk_prod_xxxx_…   # add this header for savings attribution`

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--green-bg)]"><Gauge size={20} className="text-teal" /></div>
        <div>
          <h1 className="text-[19px] font-bold text-[var(--fg)]">TokenFin Gateway</h1>
          <p className="text-[13px] text-[var(--fg-secondary)]">Point your client at the gateway. It optimizes requests, streams responses back unchanged, and records the savings.</p>
        </div>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3 text-[12px] text-[var(--fg-secondary)]">
        <ShieldCheck size={15} className="mt-0.5 flex-shrink-0 text-teal" />
        <span>Pass-through &amp; fail-open: your provider key is forwarded as-is (we never store it), and if anything goes wrong the original request is sent unchanged — your calls never break.</span>
      </div>

      <Block title="Claude Code" subtitle="add to your shell profile" text={claudeEnv} tag="claude" copied={copied} copy={copy} />
      <Block title="Codex" subtitle="add to your shell profile" text={codexEnv} tag="codex" copied={copied} copy={copy} />
      <Block title="Raw SDK header" subtitle="for attribution & per-org savings" text={header} tag="hdr" copied={copied} copy={copy} />

      <p className="mt-4 text-[11.5px] text-[var(--fg-tertiary)]">
        Once traffic flows, see results under <a className="text-teal underline" href="/dashboard/analytics/savings">Analytics → Savings</a>. A small random share of requests is sent un-optimized as a control so your savings are measured, not guessed.
      </p>
    </div>
  )
}

function Block({ title, subtitle, text, tag, copied, copy }: { title: string; subtitle: string; text: string; tag: string; copied: string; copy: (t: string, tag: string) => void }) {
  return (
    <div className="mb-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <div><div className="text-[13px] font-semibold text-[var(--fg)]">{title}</div><div className="text-[11px] text-[var(--fg-tertiary)]">{subtitle}</div></div>
        <button onClick={() => copy(text, tag)} className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--fg)] hover:bg-[var(--bg-hover)]">
          {copied === tag ? <><Check size={11} className="text-teal" />Copied</> : <><Copy size={11} />Copy</>}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre rounded-xl bg-[var(--bg-tertiary)] p-3 font-mono text-[11px] leading-relaxed text-[var(--fg)]">{text}</pre>
    </div>
  )
}
