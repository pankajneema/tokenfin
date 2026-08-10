'use client'

/**
 * Connections — connect your coding agents to TokenFin, grouped by form factor.
 *
 * Usage arrives via each agent's native OpenTelemetry export → our OTLP receiver
 * at /api/otel. Only CLI agents push real-time per-turn usage today; IDEs and
 * chat apps are shown honestly with WHETHER and HOW they can be tracked — never
 * a green checkmark on something we can't actually capture (spec §6). One command
 * configures every installed push agent; each shows a live beacon.
 */

import { useEffect, useRef, useState } from 'react'
import { Copy, Check, Terminal, ShieldCheck, ChevronDown, Puzzle, MonitorSmartphone, SquareTerminal } from 'lucide-react'
import { TIER_META, ACCURACY_META, type Tier, type Accuracy } from './_catalog'

// ── shared badges (also consumed by /dashboard/mcp Platforms) ────────────────
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

// ── status model ─────────────────────────────────────────────────────────────
// Binary: 'push' = working now (real OTLP capture), everything else = coming soon.
type Status = 'push' | 'pull' | 'byok' | 'subscription' | 'none'

interface Tool { name: string; status: Status; sourceId?: string; reason?: string }
interface Category { id: string; label: string; hint: string; Icon: typeof Terminal; tools: Tool[] }

const CATEGORIES: Category[] = [
  {
    id: 'cli', label: 'CLI / terminal', hint: 'Per-turn data over OpenTelemetry, in seconds', Icon: SquareTerminal,
    tools: [
      { name: 'Claude Code', status: 'push', sourceId: 'claude_code' },
      { name: 'Codex CLI',   status: 'push', sourceId: 'codex_cli' },
      { name: 'Gemini CLI',  status: 'push', sourceId: 'gemini_cli' },
      { name: 'Aider', status: 'byok' }, { name: 'OpenCode', status: 'byok' }, { name: 'Goose', status: 'byok' },
      { name: 'Crush', status: 'byok' }, { name: 'Qwen Code', status: 'byok' },
      { name: 'Amp', status: 'none' }, { name: 'Warp', status: 'none' },
      { name: 'Devin CLI', status: 'none' }, { name: 'Antigravity CLI', status: 'none' },
    ],
  },
  {
    id: 'ext', label: 'IDE extension / plugin', hint: 'Runs inside your editor', Icon: Puzzle,
    tools: [
      { name: 'Claude Code (VS Code · JetBrains)', status: 'push', sourceId: 'claude_code' },
      { name: 'Codex (VS Code)', status: 'push', sourceId: 'codex_cli' },
      { name: 'GitHub Copilot', status: 'pull' },
      { name: 'Gemini Code Assist', status: 'pull' },
      { name: 'Cline', status: 'byok' }, { name: 'Roo Code', status: 'byok' }, { name: 'Kilo Code', status: 'byok' }, { name: 'Continue', status: 'byok' },
      { name: 'Amazon Q Developer', status: 'none' }, { name: 'Tabnine', status: 'none' }, { name: 'Cody', status: 'none' },
      { name: 'Augment Code', status: 'none' }, { name: 'Qodo', status: 'none' }, { name: 'Supermaven', status: 'none' },
    ],
  },
  {
    id: 'ide', label: 'AI-native IDE', hint: 'Standalone editors / forks', Icon: MonitorSmartphone,
    tools: [
      { name: 'Cursor', status: 'pull', reason: 'Teams / Enterprise admin API (short retention on their side — our long history is the pitch). Connector coming soon.' },
      { name: 'Windsurf (Devin Desktop)', status: 'none', reason: 'No usage API published.' },
      { name: 'Google Antigravity', status: 'none' }, { name: 'Zed', status: 'none' }, { name: 'Kiro', status: 'none' },
      { name: 'Trae', status: 'none' }, { name: 'PearAI', status: 'none' }, { name: 'Void', status: 'none' },
    ],
  },
  {
    id: 'desktop', label: 'Desktop & chat', hint: 'Subscription apps — no per-token cost', Icon: MonitorSmartphone,
    tools: [
      { name: 'Claude Desktop', status: 'subscription' }, { name: 'ChatGPT', status: 'subscription' }, { name: 'Gemini (web)', status: 'subscription' },
    ],
  },
]

// config for the three push agents (keyed by sourceId)
function pushConfig(otelEndpoint: string, key: string): Record<string, { file: string; captures: string; note: string | null; config: string }> {
  return {
    claude_code: {
      file: '~/.claude/settings.json', captures: 'Per-turn model, input / output / cache tokens and cost (from api_request logs).', note: null,
      config: ['"env": {', '  "CLAUDE_CODE_ENABLE_TELEMETRY": "1",', '  "OTEL_METRICS_EXPORTER": "otlp",', '  "OTEL_LOGS_EXPORTER": "otlp",',
        '  "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",', `  "OTEL_EXPORTER_OTLP_ENDPOINT": "${otelEndpoint}",`,
        `  "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer ${key}",`, '  "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE": "cumulative"', '}'].join('\n'),
    },
    codex_cli: {
      file: '~/.codex/config.toml  (user-level only)', captures: 'Per-turn tokens from the codex.turn.token_usage metric.',
      note: 'metrics_exporter must be otlp-http — Codex defaults it to statsig, which sends metrics to OpenAI, not us.',
      config: ['[otel]', 'exporter = "none"', 'metrics_exporter = "otlp-http"', 'log_user_prompt = false', '',
        '[otel.metrics_exporter.otlp-http]', `endpoint = "${otelEndpoint}/v1/metrics"`, 'protocol = "json"', '',
        '[otel.metrics_exporter.otlp-http.headers]', `Authorization = "Bearer ${key}"`].join('\n'),
    },
    gemini_cli: {
      file: '~/.gemini/settings.json', captures: 'Per-turn tokens from the gen_ai.client.token.usage metric.',
      note: 'Gemini can’t set OTLP headers, so the key rides on the endpoint as ?key=.',
      config: JSON.stringify({ telemetry: { enabled: true, target: 'local', useCollector: true, otlpProtocol: 'http', otlpEndpoint: `${otelEndpoint}?key=${key}`, logPrompts: false } }, null, 2),
    },
  }
}

interface KeyInfo { id: string; raw: string; masked: string }
interface Props { endpoint: string; appUrl: string; orgId: string; isAdmin: boolean; keyError: boolean; initialKey: KeyInfo | null }
interface SourceStatus { source: string; last_event_at: string | null; tokens_today: number; cost_basis: string | null; model?: string | null }

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (text: string, id: string) => { navigator.clipboard?.writeText(text).then(() => { setCopied(id); setTimeout(() => setCopied(c => (c === id ? null : c)), 1400) }) }
  return { copied, copy }
}
function CopyBtn({ text, id, copied, copy }: { text: string; id: string; copied: string | null; copy: (t: string, i: string) => void }) {
  const done = copied === id
  return (
    <button onClick={() => copy(text, id)} aria-label="Copy" className="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[12px] text-[var(--fg-secondary)] hover:bg-[var(--bg-tertiary)]">
      {done ? <Check size={13} className="text-teal" /> : <Copy size={13} />}{done ? 'Copied' : 'Copy'}
    </button>
  )
}
const isLive = (s?: SourceStatus) => !!s?.last_event_at && Date.now() - new Date(s.last_event_at).getTime() < 60 * 60 * 1000
// "Connected" is a persistent fact (has ever sent an event) — distinct from
// "Live" (sent one in the last hour). Conflating the two made the header stat
// say "0 connected" for a perfectly-working setup the moment an hour passed
// since the last turn, which reads as broken when it isn't.
const isConnected = (s?: SourceStatus) => !!s?.last_event_at

export function SetupClient({ appUrl, orgId, isAdmin, keyError, initialKey }: Props) {
  const { copied, copy } = useCopy()
  const [revealed, setRevealed] = useState(false)
  const [open, setOpen] = useState<string | null>('cli:Claude Code')
  const [bySource, setBySource] = useState<Record<string, SourceStatus>>({})
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const otelEndpoint = `${appUrl.replace(/\/$/, '')}/api/otel`
  const key = initialKey?.raw ?? '<YOUR_KEY>'
  const command = 'npx tokenfin login && npx tokenfin setup'
  const CFG = pushConfig(otelEndpoint, key)

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const r = await fetch(`/api/v1/connections?org_id=${orgId}`, { cache: 'no-store' }); if (!r.ok || !alive) return
        const j = await r.json() as { sources?: SourceStatus[] }
        if (alive) setBySource(Object.fromEntries((j.sources ?? []).map(s => [s.source, s])))
      } catch { /* not up yet */ }
    }
    poll(); timer.current = setInterval(poll, 4000)
    return () => { alive = false; if (timer.current) clearInterval(timer.current) }
  }, [orgId])

  const pushTools = CATEGORIES.flatMap(c => c.tools).filter(t => t.status === 'push' && t.sourceId)
  const totalPushSources = new Set(pushTools.map(t => t.sourceId!)).size
  const connectedSourceIds = new Set(pushTools.map(t => t.sourceId!).filter(id => isConnected(bySource[id])))
  const liveSourceIds = new Set(pushTools.map(t => t.sourceId!).filter(id => isLive(bySource[id])))

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2">
      <header className="space-y-1">
        <h1 className="text-[22px] font-semibold text-[var(--fg)]">Connections</h1>
        <p className="text-[14px] text-[var(--fg-secondary)]">
          One command connects every installed CLI agent — real per-turn usage over OpenTelemetry, no
          proxy, no hooks. We never see your API keys or your prompts.
        </p>
        <p className="text-[12px] text-[var(--fg-tertiary)]">
          {connectedSourceIds.size === 0 ? (
            <>0 connected yet — Claude Code, Codex CLI &amp; Gemini CLI are supported, run the command below · the rest are coming soon.</>
          ) : (
            <>
              <span className="font-semibold text-teal">{connectedSourceIds.size}/{totalPushSources} connected</span>
              {liveSourceIds.size > 0 && <> · <span className="font-semibold text-teal">{liveSourceIds.size} live now</span></>}
              {' '}· the rest are coming soon.
            </>
          )}
        </p>
      </header>

      {/* one command */}
      <section className="space-y-2">
        <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--fg)]"><Terminal size={15} /> Run once — configures every installed CLI agent</div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
          <code className="overflow-x-auto font-mono text-[13px] text-[var(--fg)]">$ {command}</code>
          <CopyBtn text={command} id="cmd" copied={copied} copy={copy} />
        </div>
        <p className="text-[12px] text-[var(--fg-tertiary)]">Writes each agent’s config, then waits until the first real event lands before reporting success.</p>
      </section>

      {/* categories — only tools we actually support today. A long "coming
          soon" roadmap list was cluttering the page and burying the ones
          that work; that list can come back as a real roadmap page later. */}
      {CATEGORIES.map(cat => ({ ...cat, tools: cat.tools.filter(t => t.status === 'push') }))
        .filter(cat => cat.tools.length > 0)
        .map(cat => (
        <section key={cat.id} className="space-y-2">
          <div className="flex items-baseline gap-2">
            <cat.Icon size={15} className="translate-y-[2px] text-[var(--fg-secondary)]" />
            <h2 className="text-[14px] font-semibold text-[var(--fg)]">{cat.label}</h2>
            <span className="text-[12px] text-[var(--fg-tertiary)]">{cat.hint}</span>
          </div>
          <div className="divide-y divide-[var(--border)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]">
            {cat.tools.map(t => {
              const supported = t.status === 'push'
              const s = t.sourceId ? bySource[t.sourceId] : undefined
              const connected = supported && isConnected(s)
              const live = supported && isLive(s)
              const rowKey = `${cat.id}:${t.name}`
              const cfg = t.sourceId ? CFG[t.sourceId] : undefined
              const expandable = supported && !!cfg
              // Three honest states for a supported tool — "connected" is a
              // persistent fact (this org has ever sent an event for it),
              // "live" is a freshness signal (an event in the last hour) on
              // top of that. Neither is "we built support for this," which
              // is what the badge used to mean regardless of whether this
              // specific customer had connected anything.
              const badge = !supported
                ? { label: 'Coming soon', cls: 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]' }
                : connected
                  ? { label: live ? 'Live' : 'Connected', cls: 'bg-[var(--green-bg)] text-teal' }
                  : { label: 'Not connected', cls: 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]' }
              return (
                <div key={rowKey}>
                  <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      {supported ? (
                        <span className="relative flex h-2 w-2">
                          {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: 'var(--teal)' }} />}
                          <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: connected ? 'var(--teal)' : 'var(--fg-tertiary)' }} />
                        </span>
                      ) : <span className="h-2 w-2 rounded-full" style={{ background: 'var(--border-strong)' }} />}
                      <span className="truncate text-[13px] text-[var(--fg)]">{t.name}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {live && s && <span className="font-mono tabular-nums text-[11px] text-[var(--fg-tertiary)]">{Number(s.tokens_today || 0).toLocaleString()} tok today</span>}
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${badge.cls}`}>{badge.label}</span>
                      {expandable && (
                        <button onClick={() => setOpen(o => (o === rowKey ? null : rowKey))} className="text-[var(--fg-tertiary)] hover:text-[var(--fg)]">
                          <ChevronDown size={15} className={open === rowKey ? 'rotate-180 transition' : 'transition'} />
                        </button>
                      )}
                    </div>
                  </div>
                  {/* expandable config for push */}
                  {expandable && open === rowKey && cfg && (
                    <div className="border-t border-[var(--border)] bg-[var(--bg)]">
                      <p className="px-4 pt-2 text-[12px] text-[var(--fg-secondary)]">{cfg.captures}</p>
                      {cfg.note && <p className="px-4 pt-1 text-[11px] text-[var(--amber)]">⚠ {cfg.note}</p>}
                      <div className="flex items-center justify-between px-4 pt-2">
                        <span className="font-mono text-[11px] text-[var(--fg-tertiary)]">{cfg.file}</span>
                        <CopyBtn text={cfg.config} id={`cfg-${rowKey}`} copied={copied} copy={copy} />
                      </div>
                      <pre className="overflow-x-auto px-4 pb-3 pt-1 font-mono text-[12px] leading-relaxed text-[var(--fg)]">{cfg.config}</pre>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}

      {/* ingest key */}
      <section className="space-y-2">
        <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--fg)]"><ShieldCheck size={15} /> Your ingest key</div>
        {keyError && <p className="text-[13px] text-red">Could not provision a key. Refresh, or check your role.</p>}
        {!keyError && !isAdmin && <p className="text-[13px] text-[var(--fg-secondary)]">Ask an org admin to grab the ingest key from this page.</p>}
        {!keyError && isAdmin && initialKey && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
            <code className="overflow-x-auto font-mono text-[13px] text-[var(--fg)]">{revealed ? initialKey.raw : initialKey.masked}</code>
            <div className="flex items-center gap-2">
              <button onClick={() => setRevealed(v => !v)} className="rounded border border-[var(--border)] px-2 py-1 text-[12px] text-[var(--fg-secondary)] hover:bg-[var(--bg-tertiary)]">{revealed ? 'Hide' : 'Reveal'}</button>
              <CopyBtn text={initialKey.raw} id="key" copied={copied} copy={copy} />
            </div>
          </div>
        )}
        <p className="text-[12px] text-[var(--fg-tertiary)]">Read-write ingest key. It authenticates OTLP pushes — the receiver maps it to your org. It is never sent to your model provider.</p>
      </section>
    </div>
  )
}
