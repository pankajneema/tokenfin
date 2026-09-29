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
import { Copy, Check, Terminal, ShieldCheck, ChevronDown, Puzzle, MonitorSmartphone, SquareTerminal, Download, Users, Loader2, Eye } from 'lucide-react'
import Link from 'next/link'
import { TIER_META, ACCURACY_META, type Tier, type Accuracy } from './_catalog'
import { claudeEnv, codexToml, geminiTelemetry, managedSettings, MANAGED_PATHS } from './_snippets'
import type { RolloutRow } from './_rollout'

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
      { name: 'OpenCode',    status: 'push', sourceId: 'opencode' },
      { name: 'Aider', status: 'byok' }, { name: 'Goose', status: 'byok' },
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

// config for the push agents (keyed by sourceId) — built from _snippets.ts,
// which a parity test keeps byte-identical to what the CLI writes.
function pushConfig(otelEndpoint: string, key: string, prompts: boolean): Record<string, { file: string; captures: string; note: string | null; config: string }> {
  const env = claudeEnv(otelEndpoint, key, { prompts })
  return {
    claude_code: {
      file: '~/.claude/settings.json', note: null,
      captures: 'Per-turn model, input / output / cache tokens and cost (from api_request logs)' + (prompts ? ', plus each prompt\'s text (opt out: setup --no-prompts).' : '. Prompt text capture is off for this workspace.'),
      config: '"env": ' + JSON.stringify(env, null, 2),
    },
    codex_cli: {
      file: '~/.codex/config.toml  (user-level only)', captures: 'Per-turn tokens from the codex.turn.token_usage metric.',
      note: 'The [otel.metrics_exporter.otlp-http] table is what routes metrics to TokenFin (Codex defaults to statsig, i.e. OpenAI). Do not also add a metrics_exporter = "…" line — next to the table it is invalid TOML and Codex won’t start.',
      config: codexToml(otelEndpoint, key, { prompts }),
    },
    gemini_cli: {
      file: '~/.gemini/settings.json', captures: 'Per-turn tokens from the gen_ai.client.token.usage metric.',
      note: 'Gemini can’t set OTLP headers, so the key rides on the endpoint as ?key=.',
      config: JSON.stringify({ telemetry: geminiTelemetry(otelEndpoint, key, { prompts }) }, null, 2),
    },
    opencode: {
      file: '~/.config/opencode/opencode.json', captures: 'Per-turn tokens + cost from the opencode-otel-plugin (traces + metrics).',
      note: 'Requires the opencode-otel-plugin npm package in the "plugin" array, and the OTel env vars exported into the shell that launches opencode (endpoint, headers, protocol, exporters).',
      config: JSON.stringify({ plugin: ['opencode-otel-plugin'] }, null, 2),
    },
  }
}

interface KeyInfo { id: string; raw: string; masked: string }
interface Props { endpoint: string; appUrl: string; orgId: string; isAdmin: boolean; keyError: boolean; initialKey: KeyInfo | null; rollout?: RolloutRow[]; capturePrompts?: boolean }
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

export function SetupClient({ appUrl, orgId, isAdmin, keyError, initialKey, rollout = [], capturePrompts = true }: Props) {
  const { copied, copy } = useCopy()
  const [revealed, setRevealed] = useState(false)
  const [open, setOpen] = useState<string | null>('cli:Claude Code')
  const [bySource, setBySource] = useState<Record<string, SourceStatus>>({})
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const otelEndpoint = `${appUrl.replace(/\/$/, '')}/api/otel`
  const key = initialKey?.raw ?? '<YOUR_KEY>'
  const command = 'npx tokenfin@latest setup'
  const deviceCommand = 'npx tokenfin@latest login --device && npx tokenfin@latest setup'
  const CFG = pushConfig(otelEndpoint, key, capturePrompts)

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
        <h2 className="text-[22px] font-semibold text-[var(--fg)]">Connections</h2>
        <p className="text-[14px] text-[var(--fg-secondary)]">
          One command connects every installed CLI agent — real per-turn usage over OpenTelemetry, no
          proxy, no hooks. We never see your model-provider API keys.
        </p>
        <p className="text-[12.5px] text-[var(--fg-secondary)]">
          <Eye size={12} className="mr-1 inline -translate-y-px" />
          {capturePrompts ? (
            <>By default the <span className="font-medium text-[var(--fg)]">text of each prompt</span> is sent too, so you can see which prompts cost what. It expires after 90 days (<Link href="/dashboard/settings/data" className="underline">Settings → Data</Link>). Opt out per machine with <code className="font-mono text-[11.5px]">--no-prompts</code>, or an admin can turn it off for the whole workspace.</>
          ) : (
            <>Prompt text capture is <span className="font-medium text-[var(--fg)]">off for this workspace</span> — only token counts, model and cost are stored.</>
          )}
        </p>
        <p className="text-[12px] text-[var(--fg-tertiary)]">
          {connectedSourceIds.size === 0 ? (
            <>0 connected yet — Claude Code, Codex CLI, Gemini CLI &amp; OpenCode are supported, run the command below · the rest are coming soon.</>
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
        <p className="text-[12px] text-[var(--fg-tertiary)]">Signs you in (creates this device’s own keys), writes each installed agent’s config, then waits until the first real event lands. Add <code className="font-mono">--no-prompts</code> to never send prompt text, <code className="font-mono">--statusline</code> for a budget line in Claude Code.</p>
        <details className="text-[12px] text-[var(--fg-secondary)]">
          <summary className="cursor-pointer text-[var(--fg-tertiary)] hover:text-[var(--fg)]">No browser on that machine (SSH, devcontainer)?</summary>
          <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
            <code className="overflow-x-auto font-mono text-[12.5px] text-[var(--fg)]">$ {deviceCommand}</code>
            <CopyBtn text={deviceCommand} id="cmd-device" copied={copied} copy={copy} />
          </div>
          <p className="mt-1 text-[var(--fg-tertiary)]">Prints a short code — approve it at <span className="font-mono">/cli/device</span> from any signed-in browser.</p>
        </details>
        <FirstEventBeacon connected={connectedSourceIds.size > 0} live={liveSourceIds.size > 0} />
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
        <p className="text-[12px] text-[var(--fg-tertiary)]">Org-level, ingest-only key used in the snippets above and in managed settings. It can push usage but not read analytics. Developers who run the command get their own per-device keys instead. It is never sent to your model provider.</p>
      </section>

      {isAdmin && !keyError && initialKey && (
        <RolloutSection orgId={orgId} otelEndpoint={otelEndpoint} ingestKey={initialKey.raw} prompts={capturePrompts} rows={rollout} copied={copied} copy={copy} />
      )}
    </div>
  )
}

function FirstEventBeacon({ connected, live }: { connected: boolean; live: boolean }) {
  if (connected) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-[rgba(16,127,101,0.25)] bg-[var(--green-bg)] px-3 py-2.5 text-[12.5px] text-teal">
        <span className="inline-flex items-center gap-2"><Check size={14} /> {live ? 'Events are arriving — you’re connected.' : 'Connected — events have arrived from this workspace.'}</span>
        <Link href="/dashboard" className="font-medium underline">Open dashboard →</Link>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2.5 text-[12.5px] text-[var(--fg-secondary)]" aria-live="polite">
      <Loader2 size={14} className="animate-spin text-[var(--fg-tertiary)]" />
      Waiting for the first event… run the command, then send one message in your agent. This updates by itself.
    </div>
  )
}

// ── Roll out to your team (admins) ───────────────────────────────────────────
const STATUS_META: Record<RolloutRow['status'], { label: string; cls: string }> = {
  active:    { label: 'Active',          cls: 'bg-[var(--green-bg)] text-teal' },
  stale:     { label: 'Quiet 7d+',       cls: 'bg-[var(--amber-bg)] text-[var(--amber)]' },
  waiting:   { label: 'Keys, no events', cls: 'bg-[var(--amber-bg)] text-[var(--amber)]' },
  no_device: { label: 'Not set up',      cls: 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]' },
  invited:   { label: 'Invited',         cls: 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)]' },
}
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—')
const ago = (iso: string | null) => {
  if (!iso) return '—'
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

function RolloutSection({ orgId, otelEndpoint, ingestKey, prompts, rows, copied, copy }: {
  orgId: string; otelEndpoint: string; ingestKey: string; prompts: boolean; rows: RolloutRow[]
  copied: string | null; copy: (t: string, i: string) => void
}) {
  const [team, setTeam] = useState('')
  const [tab, setTab] = useState<'jamf' | 'intune' | 'ansible'>('jamf')
  const json = JSON.stringify(managedSettings(otelEndpoint, ingestKey, { prompts, team }), null, 2)
  const href = `/api/v1/setup/managed-settings?org_id=${encodeURIComponent(orgId)}&download=1${team ? `&team=${encodeURIComponent(team)}` : ''}`
  const snippets = {
    jamf: [
      '#!/bin/bash',
      '# Jamf Pro → Settings → Scripts (runs as root); scope a policy to developer Macs.',
      `DIR="${MANAGED_PATHS.macos.replace('/managed-settings.json', '')}"`,
      'mkdir -p "$DIR"',
      "cat > \"$DIR/managed-settings.json\" <<'JSON'",
      json,
      'JSON',
      'chmod 644 "$DIR/managed-settings.json"',
    ].join('\n'),
    intune: [
      '# Intune → Devices → Scripts and remediations → Platform scripts (PowerShell, run as system)',
      `$dir = '${MANAGED_PATHS.windows.replace('\\managed-settings.json', '')}'`,
      'New-Item -ItemType Directory -Force -Path $dir | Out-Null',
      "$json = @'",
      json,
      "'@",
      '# WriteAllText = UTF-8 without BOM (Claude Code rejects a BOM)',
      '[System.IO.File]::WriteAllText("$dir\\managed-settings.json", $json)',
    ].join('\n'),
    ansible: [
      '# Put the downloaded managed-settings.json next to this playbook.',
      '- hosts: developer_machines',
      '  become: true',
      '  vars:',
      "    cc_dir: \"{{ '/Library/Application Support/ClaudeCode' if ansible_facts['os_family'] == 'Darwin' else '/etc/claude-code' }}\"",
      '  tasks:',
      '    - ansible.builtin.file: { path: "{{ cc_dir }}", state: directory, mode: "0755" }',
      '    - ansible.builtin.copy: { src: managed-settings.json, dest: "{{ cc_dir }}/managed-settings.json", mode: "0644" }',
    ].join('\n'),
  }
  const configured = rows.filter(r => r.status === 'active' || r.status === 'stale').length
  const people = rows.filter(r => r.status !== 'invited').length

  return (
    <section className="space-y-3 border-t border-[var(--border)] pt-6">
      <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--fg)]"><Users size={15} /> Roll out to your team</div>
      <p className="text-[12.5px] text-[var(--fg-secondary)]">
        Push one managed settings file with your MDM instead of asking every developer to run the command. Claude Code
        reads it with the highest precedence (developers can’t override it). It carries this org’s ingest-only key;
        each developer is still attributed by the email Claude Code attaches to every event.
        Prompt text: <span className="font-medium text-[var(--fg)]">{prompts ? 'captured' : 'off'}</span> (workspace policy).
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
          Team tag (optional)
          <input value={team} onChange={e => setTeam(e.target.value)} placeholder="e.g. platform"
            className="w-48 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[13px] normal-case tracking-normal text-[var(--fg)] outline-none focus:border-coral" />
        </label>
        <a href={href} className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--fg)] hover:bg-[var(--bg-tertiary)]">
          <Download size={13} /> Download managed-settings.json
        </a>
      </div>
      <ul className="space-y-0.5 text-[12px] text-[var(--fg-secondary)]">
        <li>macOS: <code className="font-mono">{MANAGED_PATHS.macos}</code></li>
        <li>Linux / WSL: <code className="font-mono">{MANAGED_PATHS.linux}</code></li>
        <li>Windows: <code className="font-mono">{MANAGED_PATHS.windows}</code></li>
        <li className="text-[var(--fg-tertiary)]">Already ship a managed-settings.json? Merge the <code className="font-mono">env</code> block into it, or place this file in a <code className="font-mono">managed-settings.d/</code> folder next to it. Without a team tag, <code className="font-mono">team.name</code> is a placeholder — replace it per group or remove the line.</li>
      </ul>

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-2">
          <div className="flex">
            {(['jamf', 'intune', 'ansible'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-[12px] font-medium ${tab === t ? 'border-b-2 border-coral text-[var(--fg)]' : 'text-[var(--fg-tertiary)] hover:text-[var(--fg)]'}`}>
                {t === 'jamf' ? 'Jamf (macOS)' : t === 'intune' ? 'Intune (Windows)' : 'Ansible (Linux/macOS)'}
              </button>
            ))}
          </div>
          <CopyBtn text={snippets[tab]} id={`rollout-${tab}`} copied={copied} copy={copy} />
        </div>
        <pre className="max-h-72 overflow-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed text-[var(--fg)]">{snippets[tab]}</pre>
      </div>

      <div className="space-y-1.5 pt-2">
        <div className="flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold text-[var(--fg)]">Rollout tracker</h3>
          <span className="text-[12px] text-[var(--fg-tertiary)]">{configured}/{people} sending usage</span>
        </div>
        {rows.length === 0 ? (
          <p className="text-[12.5px] text-[var(--fg-tertiary)]">No members yet — invite your team from <Link href="/dashboard/teams" className="underline">Teams</Link>.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-left text-[12.5px]">
              <thead className="bg-[var(--bg-secondary)] text-[11px] uppercase tracking-wide text-[var(--fg-tertiary)]">
                <tr><th className="px-3 py-2 font-medium">Member</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Devices</th><th className="px-3 py-2 font-medium">First event</th><th className="px-3 py-2 font-medium">Last seen</th><th className="px-3 py-2 font-medium">Source</th></tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map(r => (
                  <tr key={r.userId ?? r.email}>
                    <td className="px-3 py-2"><div className="text-[var(--fg)]">{r.name || r.email}</div><div className="text-[11px] text-[var(--fg-tertiary)]">{r.email}</div></td>
                    <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_META[r.status].cls}`}>{STATUS_META[r.status].label}</span></td>
                    <td className="px-3 py-2 tabular-nums text-[var(--fg-secondary)]">{r.devices || '—'}</td>
                    <td className="px-3 py-2 text-[var(--fg-secondary)]">{fmtDate(r.firstEventAt)}</td>
                    <td className="px-3 py-2 text-[var(--fg-secondary)]">{ago(r.lastSeenAt)}</td>
                    <td className="px-3 py-2 font-mono text-[11.5px] text-[var(--fg-secondary)]">{r.source ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11.5px] text-[var(--fg-tertiary)]">Devices = active per-device CLI keys. Members on managed settings show events without devices. Offboarding: remove the member in Teams — their device keys stop working.</p>
      </div>
    </section>
  )
}
