'use client'

/**
 * Setup Hub — connect ANY AI tool to TokenFin and see the first event in < 5 min.
 *
 * The org's read+write "setup-hub" key is provisioned server-side and injected
 * into every install link, command, and snippet — the user never types a key.
 * Each tool opens a focused panel (≤ 3 steps, one button per step) with a manual
 * fallback. A persistent verify bar polls usage_events and turns green (with
 * confetti) the moment the first event lands; a "Send test event" button proves
 * the pipeline instantly. Per-tool progress persists in localStorage.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Sparkles, Terminal, Code2, Braces, Boxes, MousePointer2, MessageCircle, Zap,
  Copy, Check, Eye, EyeOff, KeyRound, ShieldCheck, X, ArrowUpRight, Radio,
  PartyPopper, Rocket, Send, ChevronRight, CheckCircle2,
} from 'lucide-react'

// ── injected-key link builders ───────────────────────────────────────────────
const b64 = (s: string) => (typeof window === 'undefined' ? '' : btoa(unescape(encodeURIComponent(s))))

const bearer = (key: string) => `Bearer ${key}`
const cursorConfig = (url: string, key: string) =>
  b64(JSON.stringify({ url, headers: { Authorization: bearer(key) } }))
const cursorDeeplink = (url: string, key: string) =>
  `cursor://anysphere.cursor-deeplink/mcp/install?name=tokenfin&config=${cursorConfig(url, key)}`
const cursorWeb = (url: string, key: string) =>
  `https://cursor.com/install-mcp?name=tokenfin&config=${cursorConfig(url, key)}`
const vscodeObj = (url: string, key: string) =>
  JSON.stringify({ name: 'tokenfin', type: 'http', url, headers: { Authorization: bearer(key) } })
const vscodeLink = (url: string, key: string) => `vscode:mcp/install?${encodeURIComponent(vscodeObj(url, key))}`
const vscodeInsiders = (url: string, key: string) => `vscode-insiders:mcp/install?${encodeURIComponent(vscodeObj(url, key))}`
const connectorUrl = (url: string, key: string) => `${url}?key=${key}`

const remoteJson = (url: string, key: string) =>
  JSON.stringify({ mcpServers: { tokenfin: { url, headers: { Authorization: bearer(key) } } } }, null, 2)
const bridgeJson = (url: string, key: string) =>
  JSON.stringify({ mcpServers: { tokenfin: { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', `Authorization: ${bearer(key)}`] } } }, null, 2)

const RECORD_RULE = (
`You have a TokenFin MCP connection available.
After every model response, call the tokenfin "record_usage" tool with this turn's
token counts: { model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens }.
Use the app's real usage numbers when available; otherwise give your best estimate.
Never print or save my TokenFin API key.`
)

const curlSnippet = (url: string, key: string) =>
`curl -s -X POST ${url} \\
  -H "Authorization: ${bearer(key)}" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"record_usage",
       "arguments":{"model":"gpt-4o","input_tokens":1200,"output_tokens":350,
       "event_id":"'"$(uuidgen)"'"}}}'`

const jsSnippet = (url: string, key: string) =>
`await fetch("${url}", {
  method: "POST",
  headers: { Authorization: "${bearer(key)}", "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "record_usage", arguments: {
      model: "gpt-4o", input_tokens: 1200, output_tokens: 350,
      event_id: crypto.randomUUID(),   // idempotency: safe to retry
    } },
  }),
})`

const pySnippet = (url: string, key: string) =>
`import requests, uuid

requests.post("${url}", headers={"Authorization": "${bearer(key)}"}, json={
    "jsonrpc": "2.0", "id": 1, "method": "tools/call",
    "params": {"name": "record_usage", "arguments": {
        "model": "gpt-4o", "input_tokens": 1200, "output_tokens": 350,
        "event_id": str(uuid.uuid4()),   # idempotency: safe to retry
    }},
})`

const gatewaySnippet =
`# Self-host the gateway (backend/cmd/gateway, port 8003), then point your SDK at it:
export ANTHROPIC_BASE_URL="https://your-gateway-host"
export OPENAI_BASE_URL="https://your-gateway-host/v1"
# Requests pass through unchanged; exact provider-reported usage is recorded server-side.`

// ── tool model ────────────────────────────────────────────────────────────────
type Group = 'oneclick' | 'command' | 'connector' | 'client' | 'code'
type Accuracy = 'exact' | 'estimate' | 'code'

type StepAction =
  | { kind: 'install'; label: string; href: string; alt?: { label: string; href: string } }
  | { kind: 'open'; label: string; href: string }
  | { kind: 'copy'; label: string; text: string }
  | { kind: 'chips'; chips: { label: string; value: string }[] }
  | { kind: 'test'; label: string }

interface Step { title: string; body?: string; action: StepAction }

interface Tool {
  id: string
  name: string
  group: Group
  accuracy: Accuracy
  tagline: string
  brand: string          // brand color for the logo tile
  Icon: React.ElementType
  sub?: string           // small sub-label under the name in the grid
  honesty?: string       // one honest sentence about how recording works
  steps: Step[]
  manual: { label: string; code: string }
  code?: boolean         // render the special multi-language code panel
}

const GROUPS: { id: Group; title: string; hint: string }[] = [
  { id: 'oneclick',  title: 'One click',           hint: 'Install button bakes your key in — approve in the app.' },
  { id: 'command',   title: 'One command',         hint: 'Copy, paste in your terminal. Records every turn, exactly.' },
  { id: 'connector', title: 'Connect in settings', hint: 'Chat apps: paste a Name + URL. Recording follows a saved rule.' },
  { id: 'client',    title: 'Any MCP client',      hint: 'Windsurf, Codex, Gemini CLI, Cline — via the mcp-remote bridge.' },
  { id: 'code',      title: 'From your code',       hint: 'Call record_usage yourself, or route through the gateway.' },
]

function buildTools(url: string, key: string): Tool[] {
  return [
    // ── One-click ──
    {
      id: 'cursor', name: 'Cursor', group: 'oneclick', accuracy: 'estimate',
      brand: '#0A0A0A', Icon: MousePointer2, tagline: 'One-click install into Cursor.',
      honesty: 'The install connects the MCP server. Cursor records usage by following a saved rule — numbers may be estimates.',
      steps: [
        { title: 'Add TokenFin to Cursor', body: 'Opens Cursor and pre-fills everything — just click Install in the dialog.',
          action: { kind: 'install', label: 'Add to Cursor', href: cursorDeeplink(url, key), alt: { label: 'Open install page in browser', href: cursorWeb(url, key) } } },
        { title: 'Turn on auto-recording', body: 'Save this rule to .cursor/rules/tokenfin.mdc so the agent records every turn.',
          action: { kind: 'copy', label: 'Copy recording rule', text: RECORD_RULE } },
        { title: 'Prove it works', body: 'Fire a test event now, or ask Cursor: “using tokenfin, what did I spend this week?”',
          action: { kind: 'test', label: 'Send test event' } },
      ],
      manual: { label: '~/.cursor/mcp.json (or .cursor/mcp.json per project)', code: remoteJson(url, key) },
    },
    {
      id: 'vscode', name: 'VS Code', group: 'oneclick', accuracy: 'estimate',
      brand: '#007ACC', Icon: Code2, tagline: 'One-click install into VS Code (Copilot agent).',
      honesty: 'The install connects the MCP server. Copilot records usage by following a saved rule — numbers may be estimates.',
      steps: [
        { title: 'Add TokenFin to VS Code', body: 'Opens VS Code with the server pre-filled. On Insiders, use the alternate link.',
          action: { kind: 'install', label: 'Add to VS Code', href: vscodeLink(url, key), alt: { label: 'Add to VS Code Insiders', href: vscodeInsiders(url, key) } } },
        { title: 'Turn on auto-recording', body: 'Save this rule to .github/copilot-instructions.md in your workspace.',
          action: { kind: 'copy', label: 'Copy recording rule', text: RECORD_RULE } },
        { title: 'Prove it works', body: 'Fire a test event, or start the server (▶ Start) and ask Copilot to use tokenfin.',
          action: { kind: 'test', label: 'Send test event' } },
      ],
      manual: { label: '.vscode/mcp.json — top-level key is "servers"', code: JSON.stringify({ servers: { tokenfin: { type: 'http', url, headers: { Authorization: bearer(key) } } } }, null, 2) },
    },
    // ── One command ──
    {
      id: 'claudecode', name: 'Claude Code', group: 'command', accuracy: 'exact',
      brand: '#D97757', Icon: Terminal, tagline: 'One command. Auto-records every turn.',
      honesty: 'Installs a Stop hook — recording is exact and needs no agent cooperation.',
      steps: [
        { title: 'Run the installer', body: 'Paste in any terminal. It verifies the key live, registers the MCP server, and installs the auto-record hook.',
          action: { kind: 'copy', label: 'Copy command', text: `npx tokenfin@latest setup --key ${key} --url ${url}` } },
        { title: 'Restart Claude Code', body: 'One restart activates the hook. Then check everything is green:',
          action: { kind: 'copy', label: 'Copy verify command', text: 'npx tokenfin status' } },
        { title: 'Prove it works', body: 'Every turn now records automatically. Fire a test event to see the bar go green right now.',
          action: { kind: 'test', label: 'Send test event' } },
      ],
      manual: { label: 'Read-only alternative (no auto-record)', code: `claude mcp add --transport http tokenfin ${url} --header "Authorization: ${bearer(key)}"` },
    },
    // ── Connector apps ──
    {
      id: 'claudeai', name: 'Claude.ai', group: 'connector', accuracy: 'estimate', sub: 'Web',
      brand: '#D97757', Icon: Sparkles, tagline: 'Custom connector — syncs to Desktop, mobile & Cowork.',
      honesty: 'Chat apps record by following a saved rule, so numbers may be estimates. For exact capture use Claude Code or the gateway.',
      steps: [
        { title: 'Open connector settings', body: 'Goes straight to the “Add custom connector” dialog.',
          action: { kind: 'open', label: 'Open Claude connectors', href: 'https://claude.ai/settings/connectors?modal=add-custom-connector' } },
        { title: 'Paste Name + URL', body: 'Tap each to copy. Leave OAuth fields empty. Then enable tokenfin per chat via the + button → Connectors.',
          action: { kind: 'chips', chips: [{ label: 'Name', value: 'tokenfin' }, { label: 'URL', value: connectorUrl(url, key) }] } },
        { title: 'Turn on auto-recording', body: 'Save this rule in Settings → Profile → personal preferences so every chat records.',
          action: { kind: 'copy', label: 'Copy recording rule', text: RECORD_RULE } },
      ],
      manual: { label: 'Connector details', code: `Name: tokenfin\nURL:  ${connectorUrl(url, key)}\nAuth: none (key is in the URL)` },
    },
    {
      id: 'claudedesktop', name: 'Claude Desktop', group: 'connector', accuracy: 'estimate', sub: 'App',
      brand: '#D97757', Icon: Sparkles, tagline: 'Add once — connectors sync across your Claude account.',
      honesty: 'Chat apps record by following a saved rule, so numbers may be estimates.',
      steps: [
        { title: 'Open connector settings', body: 'Add it on claude.ai and it syncs to Desktop automatically (same account).',
          action: { kind: 'open', label: 'Open Claude connectors', href: 'https://claude.ai/settings/connectors?modal=add-custom-connector' } },
        { title: 'Paste Name + URL', body: 'Or add it directly: Claude Desktop → Settings → Connectors → Add custom connector. Leave OAuth empty.',
          action: { kind: 'chips', chips: [{ label: 'Name', value: 'tokenfin' }, { label: 'URL', value: connectorUrl(url, key) }] } },
        { title: 'Turn on auto-recording', body: 'Save this rule in Settings → Profile preferences (syncs with claude.ai).',
          action: { kind: 'copy', label: 'Copy recording rule', text: RECORD_RULE } },
      ],
      manual: { label: 'Connector details', code: `Name: tokenfin\nURL:  ${connectorUrl(url, key)}\nAuth: none (key is in the URL)` },
    },
    {
      id: 'cowork', name: 'Cowork', group: 'connector', accuracy: 'estimate', sub: 'Agent',
      brand: '#D97757', Icon: Boxes, tagline: 'Uses your Claude account’s connectors.',
      honesty: 'Cowork sessions run many turns — the saved rule matters most here. Numbers may be estimates.',
      steps: [
        { title: 'Add the connector', body: 'Cowork inherits your Claude connectors — add tokenfin once via claude.ai settings.',
          action: { kind: 'open', label: 'Open Claude connectors', href: 'https://claude.ai/settings/connectors?modal=add-custom-connector' } },
        { title: 'Paste Name + URL', body: 'Leave OAuth empty. Then in Cowork ask: “list tokenfin tools” to confirm.',
          action: { kind: 'chips', chips: [{ label: 'Name', value: 'tokenfin' }, { label: 'URL', value: connectorUrl(url, key) }] } },
        { title: 'Turn on auto-recording', body: 'Save this rule to a CLAUDE.md in your Cowork project folder.',
          action: { kind: 'copy', label: 'Copy recording rule', text: RECORD_RULE } },
      ],
      manual: { label: 'Connector details', code: `Name: tokenfin\nURL:  ${connectorUrl(url, key)}\nAuth: none (key is in the URL)` },
    },
    {
      id: 'chatgpt', name: 'ChatGPT', group: 'connector', accuracy: 'estimate', sub: 'Dev mode',
      brand: '#10A37F', Icon: MessageCircle, tagline: 'Custom connector via Developer Mode.',
      honesty: 'Requires Developer Mode (Plus/Pro/Team/Enterprise). ChatGPT records by following a saved rule — numbers may be estimates.',
      steps: [
        { title: 'Enable Developer Mode', body: 'Settings → Connectors → Advanced → Developer mode. (Standard connectors won’t accept a tools server.)',
          action: { kind: 'open', label: 'Open ChatGPT', href: 'https://chatgpt.com' } },
        { title: 'Add Name + URL', body: 'Create connector → paste these. Then enable it per chat via + → More → Developer mode.',
          action: { kind: 'chips', chips: [{ label: 'Name', value: 'tokenfin' }, { label: 'URL', value: connectorUrl(url, key) }] } },
        { title: 'Turn on auto-recording', body: 'Save this rule in Settings → Personalization → Custom Instructions.',
          action: { kind: 'copy', label: 'Copy recording rule', text: RECORD_RULE } },
      ],
      manual: { label: 'Connector details', code: `Name: tokenfin\nURL:  ${connectorUrl(url, key)}\nAuth: none (key is in the URL)` },
    },
    // ── Any MCP client ──
    {
      id: 'bridge', name: 'Any MCP client', group: 'client', accuracy: 'estimate',
      brand: '#5FA04E', Icon: Boxes, tagline: 'Windsurf · Codex CLI · Gemini CLI · Cline.',
      honesty: 'Connects via the mcp-remote bridge (Node 18+). Recording follows a saved rule in the tool’s instructions file.',
      steps: [
        { title: 'Add the bridge config', body: 'Paste into the tool’s MCP config (e.g. ~/.codeium/windsurf/mcp_config.json, ~/.codex/config.toml, ~/.gemini/settings.json).',
          action: { kind: 'copy', label: 'Copy config', text: bridgeJson(url, key) } },
        { title: 'Turn on auto-recording', body: 'Save this rule to the tool’s rules file (AGENTS.md, GEMINI.md, .windsurfrules, …).',
          action: { kind: 'copy', label: 'Copy recording rule', text: RECORD_RULE } },
        { title: 'Prove it works', body: 'Restart the tool, then fire a test event to confirm the pipeline.',
          action: { kind: 'test', label: 'Send test event' } },
      ],
      manual: { label: 'mcp-remote bridge config', code: bridgeJson(url, key) },
    },
    // ── From your code ──
    {
      id: 'code', name: 'Code / API', group: 'code', accuracy: 'code', code: true,
      brand: '#00A98F', Icon: Braces, tagline: 'Call record_usage after each model call.',
      honesty: 'You control recording — pass real token counts and it’s exact. event_id makes retries safe.',
      steps: [],
      manual: { label: 'JSON-RPC endpoint (test connection)', code: `curl -s -X POST ${url} -H "Authorization: ${bearer(key)}" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` },
    },
    {
      id: 'gateway', name: 'Gateway proxy', group: 'code', accuracy: 'exact',
      brand: '#6366F1', Icon: Zap, tagline: 'Change one env var. Capture is guaranteed.',
      honesty: 'Records server-side from the real provider response — exact, no agent cooperation, plus measured output-shaping savings.',
      steps: [
        { title: 'Point your SDK at the gateway', body: 'Deploy the gateway once (infra/docker), then set your base URL. Nothing else in your code changes.',
          action: { kind: 'copy', label: 'Copy env', text: gatewaySnippet } },
        { title: 'Prove it works', body: 'Send any request through it, or fire a test event now.',
          action: { kind: 'test', label: 'Send test event' } },
      ],
      manual: { label: 'Gateway env', code: gatewaySnippet },
    },
  ]
}

// ── localStorage per-tool status ──────────────────────────────────────────────
type Status = 'connected' | 'recording'
const LS_KEY = 'tf_setup_status'
function readStatus(): Record<string, Status> {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') } catch { return {} }
}

// ── confetti (self-contained, no deps) ────────────────────────────────────────
function fireConfetti() {
  if (typeof window === 'undefined') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999'
  canvas.width = window.innerWidth; canvas.height = window.innerHeight
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d'); if (!ctx) { canvas.remove(); return }
  const colors = ['#00C48C', '#D97757', '#F5C842', '#60A5FA', '#E8533A']
  const N = 140
  const parts = Array.from({ length: N }, () => ({
    x: canvas.width / 2, y: canvas.height * 0.72,
    vx: (Math.random() - 0.5) * 16, vy: Math.random() * -16 - 6,
    r: Math.random() * 6 + 3, c: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4, life: 0,
  }))
  const start = performance.now()
  function frame(t: number) {
    const el = t - start
    ctx!.clearRect(0, 0, canvas.width, canvas.height)
    for (const p of parts) {
      p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life = el
      ctx!.save(); ctx!.translate(p.x, p.y); ctx!.rotate(p.rot)
      ctx!.globalAlpha = Math.max(0, 1 - el / 2400)
      ctx!.fillStyle = p.c; ctx!.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.6)
      ctx!.restore()
    }
    if (el < 2400) requestAnimationFrame(frame); else canvas.remove()
  }
  requestAnimationFrame(frame)
}

// ── small UI atoms ────────────────────────────────────────────────────────────
function BrandTile({ brand, Icon, size = 40 }: { brand: string; Icon: React.ElementType; size?: number }) {
  return (
    <div className="flex items-center justify-center rounded-2xl flex-shrink-0"
      style={{ width: size, height: size, background: brand }}>
      <Icon size={size * 0.5} className="text-white" strokeWidth={2} />
    </div>
  )
}

function AccuracyBadge({ a }: { a: Accuracy }) {
  const map = {
    exact:    { c: 'bg-[var(--green-bg)] text-teal', t: 'Exact recording' },
    estimate: { c: 'bg-[var(--amber-bg)] text-[var(--amber)]', t: 'Records via a rule' },
    code:     { c: 'bg-[var(--blue-bg)] text-[var(--blue)]', t: 'You control it' },
  }[a]
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${map.c}`}>{map.t}</span>
}

// ═══════════════════════════════════════════════════════════════════════════════
export function SetupClient({
  endpoint, orgId, isAdmin, keyError, initialKey,
}: {
  endpoint: string
  orgId: string
  isAdmin: boolean
  keyError: boolean
  initialKey: { id: string; raw: string; masked: string } | null
}) {
  const [showKey, setShowKey] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [openTool, setOpenTool] = useState<Tool | null>(null)
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [activeToolId, setActiveToolId] = useState<string | null>(null)

  useEffect(() => { setStatus(readStatus()) }, [])

  const key = initialKey?.raw ?? ''
  const tools = key ? buildTools(endpoint, key) : []

  const mark = useCallback((id: string, s: Status) => {
    setStatus(prev => {
      const rank = { connected: 1, recording: 2 }
      if (prev[id] && rank[prev[id]] >= rank[s]) return prev
      const next = { ...prev, [id]: s }
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  const copy = useCallback((id: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {})
    setCopiedId(id); setTimeout(() => setCopiedId(null), 1800)
  }, [])

  // Mark a tool as recording when the first event lands while its panel is active.
  const onFirstEvent = useCallback(() => {
    if (activeToolId) mark(activeToolId, 'recording')
  }, [activeToolId, mark])

  // ── gated states ──
  if (!isAdmin) {
    return (
      <Shell>
        <EmptyCard
          icon={ShieldCheck}
          title="Ask an admin to open Setup"
          body="Setup generates a shared connection key for your whole org, so only an admin (or owner) can create it. Once they’ve connected a tool, your usage shows up here automatically."
        />
      </Shell>
    )
  }
  if (keyError || !initialKey) {
    return (
      <Shell>
        <EmptyCard
          icon={KeyRound}
          title="Couldn’t provision your setup key"
          body="We couldn’t create the connection key just now. Refresh to try again — if it keeps failing, check that your database migrations are applied and KEY_ENCRYPTION_SECRET is set."
        />
      </Shell>
    )
  }

  const host = endpoint.replace(/^https?:\/\//, '').replace(/\/api\/mcp$/, '')

  return (
    <Shell>
      {/* ── Hero ── */}
      <div className="relative mb-6 overflow-hidden rounded-3xl border border-[var(--border)] bg-gradient-to-br from-[var(--green-bg)] via-[var(--bg-secondary)] to-[var(--blue-bg)] p-6">
        <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-teal/20 blur-3xl" />
        <div className="relative">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg)]/70 px-3 py-1 text-[11px] font-semibold text-[var(--fg-secondary)] backdrop-blur">
            <Rocket size={12} className="text-teal" /> First event in under 5 minutes
          </div>
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-[var(--fg)]">
            Connect any AI tool.<br />See your spend light up. ✨
          </h1>
          <p className="mt-1.5 max-w-lg text-[13px] leading-snug text-[var(--fg-secondary)]">
            Your key is already baked into every button and snippet below — no copy-paste, no{' '}
            <code className="rounded bg-[var(--bg-tertiary)] px-1 text-[11px]">&lt;YOUR_KEY&gt;</code> to fill in.
            Pick a tool, tap one button, watch the bar at the bottom turn green.
          </p>
        </div>
      </div>

      {/* ── Injected key card ── */}
      <div className="mb-7 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
        <div className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-[var(--fg)]">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--green-bg)]"><KeyRound size={12} className="text-teal" /></span>
          Your connection key
          <span className="badge-green ml-auto"><ShieldCheck size={11} /> read + write · auto-provisioned</span>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-[12.5px] text-[var(--fg)]">
            {showKey ? key : initialKey.masked}
          </code>
          <button onClick={() => setShowKey(v => !v)} aria-label={showKey ? 'Hide key' : 'Reveal key'}
            className="btn-secondary !px-2.5 !py-2">
            {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          <button onClick={() => copy('mainkey', key)} className="btn-secondary !px-2.5 !py-2" aria-label="Copy key">
            {copiedId === 'mainkey' ? <Check size={15} className="text-teal" /> : <Copy size={15} />}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-[var(--fg-tertiary)]">
          You rarely need this directly — every card below already includes it. Endpoint{' '}
          <code className="font-mono text-[var(--fg-secondary)]">{endpoint}</code>.
        </p>
      </div>

      {/* ── Tool grid ── */}
      <div className="space-y-7 pb-4">
        {GROUPS.map(g => {
          const groupTools = tools.filter(t => t.group === g.id)
          if (!groupTools.length) return null
          return (
            <section key={g.id}>
              <div className="mb-2.5">
                <h2 className="text-[13.5px] font-bold tracking-tight text-[var(--fg)]">{g.title}</h2>
                <p className="text-[11.5px] text-[var(--fg-tertiary)]">{g.hint}</p>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {groupTools.map(t => (
                  <ToolCard key={t.id} tool={t} status={status[t.id]} onOpen={() => { setOpenTool(t); setActiveToolId(t.id) }} />
                ))}
              </div>
            </section>
          )
        })}
      </div>

      {/* ── Focused panel ── */}
      {openTool && (
        <ToolPanel
          tool={openTool}
          endpoint={endpoint}
          apiKey={key}
          copiedId={copiedId}
          onCopy={copy}
          onClose={() => setOpenTool(null)}
          onConnect={() => mark(openTool.id, 'connected')}
          orgId={orgId}
          onTestSent={() => { mark(openTool.id, 'connected') }}
        />
      )}

      {/* ── Persistent verify bar ── */}
      <VerifyBar orgId={orgId} apiKey={key} onFirstEvent={onFirstEvent} onSending={() => activeToolId && mark(activeToolId, 'connected')} />

      <div className="h-24" /> {/* spacer so content clears the fixed bar */}

      <p className="pb-2 text-center text-[11px] text-[var(--fg-tertiary)]">
        {host} · Streamable HTTP · Bearer / x-api-key / ?key= · 12 tools
      </p>
    </Shell>
  )
}

// ── layout shell ──────────────────────────────────────────────────────────────
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-3xl px-1">{children}</div>
}

function EmptyCard({ icon: Icon, title, body }: { icon: React.ElementType; title: string; body: string }) {
  return (
    <div className="mt-10 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-8 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--green-bg)]">
        <Icon size={22} className="text-teal" />
      </div>
      <h2 className="text-[16px] font-bold text-[var(--fg)]">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-[var(--fg-secondary)]">{body}</p>
    </div>
  )
}

// ── tool card ─────────────────────────────────────────────────────────────────
function ToolCard({ tool, status, onOpen }: { tool: Tool; status?: Status; onOpen: () => void }) {
  return (
    <button onClick={onOpen}
      className="group flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3 text-left transition-all hover:border-[var(--border-strong)] hover:shadow-soft">
      <BrandTile brand={tool.brand} Icon={tool.Icon} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13.5px] font-semibold text-[var(--fg)]">{tool.name}</span>
          {tool.sub && <span className="rounded bg-[var(--bg-tertiary)] px-1.5 py-px text-[9.5px] font-medium text-[var(--fg-tertiary)]">{tool.sub}</span>}
        </div>
        <p className="truncate text-[11.5px] text-[var(--fg-secondary)]">{tool.tagline}</p>
        <div className="mt-1 flex items-center gap-1.5">
          <AccuracyBadge a={tool.accuracy} />
          {status === 'recording'
            ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-teal"><CheckCircle2 size={11} /> Recording</span>
            : status === 'connected'
            ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--blue)]"><Check size={11} /> Connected</span>
            : null}
        </div>
      </div>
      <ChevronRight size={16} className="flex-shrink-0 text-[var(--fg-tertiary)] transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}

// ── focused panel (modal) ─────────────────────────────────────────────────────
function ToolPanel({
  tool, endpoint, apiKey, copiedId, onCopy, onClose, onConnect, orgId, onTestSent,
}: {
  tool: Tool
  endpoint: string
  apiKey: string
  copiedId: string | null
  onCopy: (id: string, text: string) => void
  onClose: () => void
  onConnect: () => void
  orgId: string
  onTestSent: () => void
}) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-[var(--border)] bg-[var(--bg)] p-5 shadow-lg sm:rounded-3xl"
        onClick={e => e.stopPropagation()}>
        {/* header */}
        <div className="mb-4 flex items-start gap-3">
          <BrandTile brand={tool.brand} Icon={tool.Icon} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-[16px] font-bold text-[var(--fg)]">{tool.name}</h3>
              <AccuracyBadge a={tool.accuracy} />
            </div>
            <p className="text-[12px] text-[var(--fg-secondary)]">{tool.tagline}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="btn-secondary !px-2 !py-1.5"><X size={16} /></button>
        </div>

        {tool.honesty && (
          <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-[11.5px] leading-snug text-[var(--fg-secondary)]">
            {tool.honesty}
          </div>
        )}

        {tool.code
          ? <CodePanel endpoint={endpoint} apiKey={apiKey} copiedId={copiedId} onCopy={onCopy} />
          : (
            <ol className="space-y-3">
              {tool.steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[var(--green-bg)] text-[11px] font-bold text-teal">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-[var(--fg)]">{s.title}</p>
                    {s.body && <p className="mb-2 mt-0.5 text-[11.5px] leading-snug text-[var(--fg-secondary)]">{s.body}</p>}
                    <StepButton
                      action={s.action} idBase={`${tool.id}-${i}`}
                      copiedId={copiedId} onCopy={onCopy} onConnect={onConnect}
                      orgId={orgId} onTestSent={onTestSent}
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}

        {/* manual fallback */}
        <details className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2">
          <summary className="cursor-pointer list-none text-[11.5px] font-medium text-[var(--fg-secondary)] hover:text-[var(--fg)]">
            Manual setup — {tool.manual.label}
          </summary>
          <div className="mt-2">
            <CodeBlock id={`${tool.id}-manual`} code={tool.manual.code} copiedId={copiedId} onCopy={onCopy} />
          </div>
        </details>
      </div>
    </div>
  )
}

function StepButton({
  action, idBase, copiedId, onCopy, onConnect, orgId, onTestSent,
}: {
  action: StepAction
  idBase: string
  copiedId: string | null
  onCopy: (id: string, text: string) => void
  onConnect: () => void
  orgId: string
  onTestSent: () => void
}) {
  if (action.kind === 'install') {
    return (
      <div className="flex flex-col gap-1.5">
        <a href={action.href} onClick={onConnect}
          className="btn-primary inline-flex w-fit items-center gap-1.5 !py-2 text-[12.5px]">
          <Rocket size={14} /> {action.label}
        </a>
        {action.alt && (
          <a href={action.alt.href} target="_blank" rel="noreferrer" onClick={onConnect}
            className="inline-flex w-fit items-center gap-1 text-[11px] font-medium text-[var(--fg-tertiary)] hover:text-teal">
            {action.alt.label} <ArrowUpRight size={11} />
          </a>
        )}
      </div>
    )
  }
  if (action.kind === 'open') {
    return (
      <a href={action.href} target="_blank" rel="noreferrer" onClick={onConnect}
        className="btn-primary inline-flex w-fit items-center gap-1.5 !py-2 text-[12.5px]">
        {action.label} <ArrowUpRight size={13} />
      </a>
    )
  }
  if (action.kind === 'copy') {
    const copied = copiedId === idBase
    return (
      <button onClick={() => { onCopy(idBase, action.text); onConnect() }}
        className="btn-primary inline-flex w-fit items-center gap-1.5 !py-2 text-[12.5px]">
        {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> {action.label}</>}
      </button>
    )
  }
  if (action.kind === 'chips') {
    return (
      <div className="flex flex-wrap gap-1.5">
        {action.chips.map(ch => {
          const id = `${idBase}-${ch.label}`
          const copied = copiedId === id
          return (
            <button key={ch.label} onClick={() => { onCopy(id, ch.value); onConnect() }}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-[11.5px] transition-colors hover:border-teal">
              <span className="font-semibold text-[var(--fg-tertiary)]">{ch.label}</span>
              <span className="truncate font-mono text-[var(--fg)]">{ch.value}</span>
              {copied ? <Check size={12} className="flex-shrink-0 text-teal" /> : <Copy size={12} className="flex-shrink-0 text-[var(--fg-tertiary)]" />}
            </button>
          )
        })}
      </div>
    )
  }
  // test
  return <TestButton orgId={orgId} label={action.label} onSent={onTestSent} />
}

// ── inline test-event button (server-side record_usage) ───────────────────────
function TestButton({ orgId, label, onSent }: { orgId: string; label: string; onSent: () => void }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const send = async () => {
    setState('sending')
    try {
      const res = await fetch('/api/v1/test-event', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId }),
      })
      if (!res.ok) throw new Error()
      setState('sent'); onSent()
    } catch { setState('error') }
  }
  return (
    <button onClick={send} disabled={state === 'sending' || state === 'sent'}
      className="btn-primary inline-flex w-fit items-center gap-1.5 !py-2 text-[12.5px] disabled:opacity-60">
      {state === 'sent' ? <><Check size={14} /> Test event sent</>
        : state === 'sending' ? <><Radio size={14} className="animate-pulse" /> Sending…</>
        : state === 'error' ? <><X size={14} /> Retry</>
        : <><Send size={14} /> {label}</>}
    </button>
  )
}

// ── code panel (curl / JS / Python + gateway) ─────────────────────────────────
function CodePanel({ endpoint, apiKey, copiedId, onCopy }: {
  endpoint: string; apiKey: string; copiedId: string | null; onCopy: (id: string, t: string) => void
}) {
  const [lang, setLang] = useState<'curl' | 'js' | 'python'>('js')
  const code = lang === 'curl' ? curlSnippet(endpoint, apiKey) : lang === 'js' ? jsSnippet(endpoint, apiKey) : pySnippet(endpoint, apiKey)
  return (
    <div>
      <div className="mb-2 inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-0.5">
        {(['curl', 'js', 'python'] as const).map(l => (
          <button key={l} onClick={() => setLang(l)}
            className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium capitalize transition-colors ${lang === l ? 'bg-[var(--bg)] text-[var(--fg)] shadow-soft' : 'text-[var(--fg-tertiary)] hover:text-[var(--fg)]'}`}>
            {l === 'js' ? 'JavaScript' : l === 'python' ? 'Python' : 'curl'}
          </button>
        ))}
      </div>
      <CodeBlock id={`code-${lang}`} code={code} copiedId={copiedId} onCopy={onCopy} />
      <p className="mt-2 text-[11px] text-[var(--fg-tertiary)]">
        Call this after each model response with real token counts. <code className="font-mono">event_id</code> makes retries safe (no double-counting).
      </p>
    </div>
  )
}

function CodeBlock({ id, code, copiedId, onCopy }: {
  id: string; code: string; copiedId: string | null; onCopy: (id: string, t: string) => void
}) {
  const copied = copiedId === id
  return (
    <div className="relative">
      <pre className="max-h-72 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3 pr-12 font-mono text-[11px] leading-relaxed text-[var(--fg)]">{code}</pre>
      <button onClick={() => onCopy(id, code)} aria-label="Copy"
        className="absolute right-2 top-2 flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[10.5px] font-medium text-[var(--fg)] hover:border-teal">
        {copied ? <><Check size={11} className="text-teal" /> Copied</> : <><Copy size={11} /> Copy</>}
      </button>
    </div>
  )
}

// ── persistent verify bar ─────────────────────────────────────────────────────
function VerifyBar({ orgId, apiKey, onFirstEvent, onSending }: {
  orgId: string; apiKey: string; onFirstEvent: () => void; onSending: () => void
}) {
  const [found, setFound] = useState<{ model: string; cost: number } | null>(null)
  const [testing, setTesting] = useState(false)
  const sinceRef = useRef<string>(new Date().toISOString())
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!orgId) return
    const supabase = createClient()
    const poll = async () => {
      const { data } = await supabase
        .from('usage_events')
        .select('model, cost_usd, created_at')
        .eq('org_id', orgId)
        .gt('created_at', sinceRef.current)
        .order('created_at', { ascending: false })
        .limit(1)
      if (data && data.length > 0) {
        setFound({ model: String(data[0].model), cost: Number(data[0].cost_usd ?? 0) })
        onFirstEvent(); fireConfetti()
        if (timer.current) clearInterval(timer.current)
      }
    }
    timer.current = setInterval(poll, 4000)
    poll()
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [orgId, onFirstEvent])

  const sendTest = async () => {
    setTesting(true); onSending()
    try {
      await fetch('/api/v1/test-event', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId }),
      })
    } catch { /* the poller will simply keep waiting */ }
    setTesting(false)
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-3">
      <div className={`pointer-events-auto flex w-full max-w-2xl items-center gap-3 rounded-2xl border px-4 py-3 shadow-lg backdrop-blur transition-colors ${
        found ? 'border-teal/40 bg-[var(--green-bg)]' : 'border-[var(--border)] bg-[var(--bg)]/95'}`}>
        {found ? (
          <>
            <PartyPopper size={18} className="flex-shrink-0 text-teal" />
            <div className="min-w-0 flex-1 text-[12.5px]">
              <span className="font-bold text-teal">First event received!</span>{' '}
              <span className="text-[var(--fg-secondary)]">
                model <span className="font-mono text-[var(--fg)]">{found.model}</span> · ${found.cost.toFixed(6)} — your pipeline works end to end.
              </span>
            </div>
            <a href="/dashboard" className="btn-primary flex-shrink-0 !py-1.5 text-[12px]">
              View dashboard <ArrowUpRight size={13} />
            </a>
          </>
        ) : (
          <>
            <span className="relative flex h-3 w-3 flex-shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-teal" />
            </span>
            <div className="min-w-0 flex-1 text-[12.5px] text-[var(--fg-secondary)]">
              <span className="font-semibold text-[var(--fg)]">Waiting for your first event…</span>{' '}
              trigger your tool, or send a test to prove the pipeline now.
            </div>
            <button onClick={sendTest} disabled={testing || !apiKey}
              className="btn-primary flex-shrink-0 !py-1.5 text-[12px] disabled:opacity-60">
              {testing ? <><Radio size={13} className="animate-pulse" /> Sending…</> : <><Send size={13} /> Send test event</>}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
