'use client'

/**
 * Connect surface — interim, Claude Code only.
 *
 * The old multi-tool wizard (hooks / proxy / record snippets) is gone with the
 * capture rewrite. Usage now arrives via each CLI agent's native OpenTelemetry
 * export → our OTLP receiver at /api/otel. This page shows the one command that
 * writes that config, and a live beacon that proves events are actually landing
 * — "config written" is not a connection. The full grouped /connections surface
 * (Codex, Gemini, pull connectors, five states) lands in a later milestone.
 */

import { useEffect, useRef, useState } from 'react'
import { Copy, Check, Terminal, ShieldCheck, Radio } from 'lucide-react'
import { TIER_META, ACCURACY_META, type Tier, type Accuracy } from './_catalog'

// ── shared badges (also consumed by /dashboard/mcp Connected Platforms) ──────
export function TierBadge({ tier }: { tier: Tier }) {
  const m = TIER_META[tier]
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${m.cls}`}>{m.label}</span>
}
export function AccuracyBadge({ accuracy }: { accuracy: Accuracy }) {
  const m = ACCURACY_META[accuracy]
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${m.cls}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.dot }} />{m.label}
    </span>
  )
}

interface KeyInfo { id: string; raw: string; masked: string }
interface Props {
  endpoint:   string          // /api/mcp — read-only MCP (query the dashboard from chat)
  appUrl:     string          // origin, used to build the OTLP endpoint
  orgId:      string
  isAdmin:    boolean
  keyError:   boolean
  initialKey: KeyInfo | null
}

interface ConnStatus {
  last_event_at: string | null
  tokens_today:  number
  cost_basis:    string | null
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (text: string, id: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(id); setTimeout(() => setCopied(c => (c === id ? null : c)), 1400)
    })
  }
  return { copied, copy }
}

function CopyBtn({ text, id, copied, copy }: { text: string; id: string; copied: string | null; copy: (t: string, i: string) => void }) {
  const done = copied === id
  return (
    <button
      onClick={() => copy(text, id)}
      className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[12px] text-[var(--fg-secondary)] hover:bg-[var(--bg-tertiary)]"
      aria-label="Copy"
    >
      {done ? <Check size={13} className="text-teal" /> : <Copy size={13} />}
      {done ? 'Copied' : 'Copy'}
    </button>
  )
}

export function SetupClient({ appUrl, isAdmin, keyError, initialKey }: Props) {
  const { copied, copy } = useCopy()
  const [revealed, setRevealed] = useState(false)
  const [status, setStatus] = useState<ConnStatus | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const otelEndpoint = `${appUrl.replace(/\/$/, '')}/api/otel`
  const key = initialKey?.raw ?? '<YOUR_KEY>'
  const command = 'npx tokenfin login && npx tokenfin setup'

  // The env block `npx tokenfin setup` writes into ~/.claude/settings.json.
  const envBlock = [
    '"env": {',
    '  "CLAUDE_CODE_ENABLE_TELEMETRY": "1",',
    '  "OTEL_METRICS_EXPORTER": "otlp",',
    '  "OTEL_LOGS_EXPORTER": "otlp",',
    '  "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",',
    `  "OTEL_EXPORTER_OTLP_ENDPOINT": "${otelEndpoint}",`,
    `  "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer ${key}",`,
    '  "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE": "cumulative"',
    '}',
  ].join('\n')

  // Live beacon — the pipe is not silently broken only if events keep landing.
  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const r = await fetch('/api/v1/connections?source=claude_code', { cache: 'no-store' })
        if (!r.ok || !alive) return
        const j = (await r.json()) as ConnStatus
        if (alive) setStatus(j)
      } catch { /* endpoint not up yet — keep waiting */ }
    }
    poll()
    timer.current = setInterval(poll, 4000)
    return () => { alive = false; if (timer.current) clearInterval(timer.current) }
  }, [])

  const lastMs = status?.last_event_at ? Date.now() - new Date(status.last_event_at).getTime() : Infinity
  const live = lastMs < 60 * 60 * 1000 // an event within the last hour

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2">
      <header className="space-y-1">
        <h1 className="text-[22px] font-semibold text-[var(--fg)]">Connect Claude Code</h1>
        <p className="text-[14px] text-[var(--fg-secondary)]">
          One command. Real per-turn usage over OpenTelemetry — no proxy, no hooks. We never see
          your API keys or your prompts.
        </p>
      </header>

      {/* Live ingest heartbeat */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: 'var(--teal)' }} />}
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: live ? 'var(--teal)' : 'var(--fg-tertiary)' }} />
            </span>
            <span className="text-[13px] font-medium text-[var(--fg)]">
              {live ? 'Live' : 'Waiting for first event…'}
            </span>
            <Radio size={14} className="text-[var(--fg-tertiary)]" />
          </div>
          {live && status && (
            <div className="text-right">
              <div className="font-mono tabular-nums text-[14px] text-[var(--fg)]">{status.tokens_today.toLocaleString()} tokens today</div>
              <div className="text-[11px] uppercase tracking-wide text-[var(--fg-tertiary)]">{status.cost_basis ?? 'notional'}</div>
            </div>
          )}
        </div>
        {!live && (
          <p className="mt-2 text-[12px] text-[var(--fg-tertiary)]">
            Run the command below, then start a Claude Code session. The first turn shows up here in
            seconds. Nothing is counted until real events arrive.
          </p>
        )}
      </section>

      {/* Automatic */}
      <section className="space-y-2">
        <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--fg)]">
          <Terminal size={15} /> Automatic — run one command
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
          <code className="overflow-x-auto font-mono text-[13px] text-[var(--fg)]">$ {command}</code>
          <CopyBtn text={command} id="cmd" copied={copied} copy={copy} />
        </div>
        <p className="text-[12px] text-[var(--fg-tertiary)]">
          Writes an <code>env</code> block to <code>~/.claude/settings.json</code> and waits until the
          first real event lands before reporting success.
        </p>
      </section>

      {/* Manual */}
      <section className="space-y-2">
        <div className="text-[13px] font-medium text-[var(--fg)]">Manual — paste the config yourself</div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
            <span className="text-[12px] text-[var(--fg-tertiary)]">~/.claude/settings.json</span>
            <CopyBtn text={envBlock} id="env" copied={copied} copy={copy} />
          </div>
          <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-[var(--fg)]">{envBlock}</pre>
        </div>
      </section>

      {/* Key */}
      <section className="space-y-2">
        <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--fg)]">
          <ShieldCheck size={15} /> Your ingest key
        </div>
        {keyError && (
          <p className="text-[13px] text-red">Could not provision a key. Refresh, or check your role.</p>
        )}
        {!keyError && !isAdmin && (
          <p className="text-[13px] text-[var(--fg-secondary)]">Ask an org admin to grab the ingest key from this page.</p>
        )}
        {!keyError && isAdmin && initialKey && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
            <code className="overflow-x-auto font-mono text-[13px] text-[var(--fg)]">
              {revealed ? initialKey.raw : initialKey.masked}
            </code>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setRevealed(v => !v)}
                className="rounded border border-[var(--border)] px-2 py-1 text-[12px] text-[var(--fg-secondary)] hover:bg-[var(--bg-tertiary)]"
              >
                {revealed ? 'Hide' : 'Reveal'}
              </button>
              <CopyBtn text={initialKey.raw} id="key" copied={copied} copy={copy} />
            </div>
          </div>
        )}
        <p className="text-[12px] text-[var(--fg-tertiary)]">Read-write ingest key. It authenticates OTLP pushes — the receiver maps it to your org. It is never sent to your model provider.</p>
      </section>
    </div>
  )
}
