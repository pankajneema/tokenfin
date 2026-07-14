/**
 * Setup catalog — the single source of truth for the connection wizard AND the
 * Connected Platforms page. Every tool walks the SAME 3 phases; only the Phase-2
 * recorder method differs (hook / proxy / rule / code).
 *
 * CORE MODEL: connecting the MCP server ≠ recording usage. The RECORDER is a
 * separate module. There is ONE universal recorder for routable tools —
 * `npx tokenfin proxy` — plus the Claude Code hook (bundled) and, for locked
 * chat apps, a saved "recording rule" the model follows (ESTIMATED, never Exact).
 */
import type { LucideIcon } from 'lucide-react'
import {
  Terminal, SquareTerminal, Sparkles, Code2, Wind, Boxes,
  MessageCircle, MonitorSmartphone, Braces,
} from 'lucide-react'

export type Category = 'terminal' | 'editor' | 'chat' | 'custom'
export type Tier     = 'hook' | 'proxy' | 'rule' | 'code'
export type Accuracy = 'exact' | 'estimated'

export const PROXY_PORT = 8788
export const PROXY_URL   = `http://127.0.0.1:${PROXY_PORT}`

// ── badge meta (semantic, SEPARATE from the coral accent) ────────────────────
export const TIER_META: Record<Tier, { label: string; cls: string }> = {
  hook:  { label: 'Hook',  cls: 'bg-[var(--bg-tertiary)] text-[var(--fg-secondary)]' },
  proxy: { label: 'Proxy', cls: 'bg-[var(--bg-tertiary)] text-[var(--fg-secondary)]' },
  rule:  { label: 'Rule',  cls: 'bg-[var(--bg-tertiary)] text-[var(--fg-secondary)]' },
  code:  { label: 'Code',  cls: 'bg-[var(--bg-tertiary)] text-[var(--fg-secondary)]' },
}

export const ACCURACY_META: Record<Accuracy, { label: string; cls: string; dot: string }> = {
  exact:     { label: 'Exact',     cls: 'bg-[var(--green-bg)] text-teal',            dot: 'var(--teal)'  },
  estimated: { label: 'Estimated', cls: 'bg-[var(--amber-bg)] text-[var(--amber)]',  dot: 'var(--amber)' },
}

export const CATEGORIES: { id: Category; label: string; hint: string }[] = [
  { id: 'terminal', label: 'Terminal agents', hint: 'Coding agents in your shell — exact recording.' },
  { id: 'editor',   label: 'Code editors',    hint: 'IDEs with an agent — proxy for exact, or a rule.' },
  { id: 'chat',     label: 'Chat apps',       hint: 'Locked to the vendor — recording is estimated.' },
  { id: 'custom',   label: 'Custom & API',    hint: 'Your own code — call record_usage or run the proxy.' },
]

// ── injected-key config builders ─────────────────────────────────────────────
const b64 = (s: string) => (typeof window === 'undefined'
  ? Buffer.from(s, 'utf8').toString('base64')
  : btoa(unescape(encodeURIComponent(s))))
export const bearer = (key: string) => `Bearer ${key}`

const cursorConfig   = (url: string, key: string) => b64(JSON.stringify({ url, headers: { Authorization: bearer(key) } }))
export const cursorDeeplink = (url: string, key: string) => `cursor://anysphere.cursor-deeplink/mcp/install?name=tokenfin&config=${cursorConfig(url, key)}`
export const cursorWeb      = (url: string, key: string) => `https://cursor.com/install-mcp?name=tokenfin&config=${cursorConfig(url, key)}`

const vscodeObj      = (url: string, key: string) => JSON.stringify({ name: 'tokenfin', type: 'http', url, headers: { Authorization: bearer(key) } })
export const vscodeLink     = (url: string, key: string) => `vscode:mcp/install?${encodeURIComponent(vscodeObj(url, key))}`
export const vscodeInsiders = (url: string, key: string) => `vscode-insiders:mcp/install?${encodeURIComponent(vscodeObj(url, key))}`

export const connectorUrl = (url: string, key: string) => `${url}?key=${key}`

// Remote HTTP MCP (Cursor/Windsurf/Cline native http support)
const mcpServersJson = (url: string, key: string) =>
  JSON.stringify({ mcpServers: { tokenfin: { url, headers: { Authorization: bearer(key) } } } }, null, 2)
// VS Code uses a top-level "servers" key
const vscodeServersJson = (url: string, key: string) =>
  JSON.stringify({ servers: { tokenfin: { type: 'http', url, headers: { Authorization: bearer(key) } } } }, null, 2)
// mcp-remote bridge (stdio → remote HTTP) for clients without native HTTP MCP
const bridgeJson = (url: string, key: string) =>
  JSON.stringify({ mcpServers: { tokenfin: { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', `Authorization: ${bearer(key)}`] } } }, null, 2)
// Codex uses TOML
const codexToml = (url: string, key: string) =>
`[mcp_servers.tokenfin]
command = "npx"
args = ["-y", "mcp-remote", "${url}", "--header", "Authorization: ${bearer(key)}"]`

export const RECORD_RULE =
`You have a TokenFin MCP connection available.
After every model response, call the tokenfin "record_usage" tool with this turn's
token counts: { model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens }.
Use the app's real usage numbers when available; otherwise give your best estimate.
Never print or save my TokenFin API key.`

// The universal recorder module for any routable tool.
const proxyEnv = (kind: 'anthropic' | 'openai' | 'both') => {
  const a = `export ANTHROPIC_BASE_URL="${PROXY_URL}"`
  const o = `export OPENAI_BASE_URL="${PROXY_URL}/v1"`
  return kind === 'anthropic' ? a : kind === 'openai' ? o : `${a}\n${o}`
}

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

// ── block model (rendered generically by the wizard) ─────────────────────────
export type Block =
  | { kind: 'deeplink'; label: string; href: string; alt?: { label: string; href: string } }
  | { kind: 'open';     label: string; href: string }
  | { kind: 'command';  code: string; note?: string }
  | { kind: 'config';   filename: string; lang: string; code: string }
  | { kind: 'chips';    chips: { label: string; value: string }[] }
  | { kind: 'code';     tabs: { label: string; code: string }[] }
  | { kind: 'note';     text: string }

export interface PhaseSpec {
  /** short heading shown under the phase title */
  lede: string
  blocks: Block[]
}

export interface Tool {
  id: string
  name: string
  category: Category
  brand: string
  Icon: LucideIcon
  tier: Tier
  accuracy: Accuracy
  blurb: string
  /** claude code only: `npx setup` does connect + hook in one command */
  bundled?: boolean
  connect:  (url: string, key: string) => PhaseSpec
  recorder: (url: string, key: string) => PhaseSpec
}

const CLAUDE = '#D97757'

export const TOOLS: Tool[] = [
  // ── Terminal agents ─────────────────────────────────────────────────────────
  {
    id: 'claude-code', name: 'Claude Code', category: 'terminal', brand: CLAUDE,
    Icon: Terminal, tier: 'hook', accuracy: 'exact', bundled: true,
    blurb: 'One command connects the server and installs the auto-record hook.',
    connect: (url, key) => ({
      lede: 'One command registers the MCP server and installs the recorder hook — Phase 2 is bundled in.',
      blocks: [
        { kind: 'command', code: `npx tokenfin@latest setup --key ${key} --url ${url}`,
          note: 'Signs you in, registers the tokenfin MCP server, and installs a Stop hook that records every turn — exactly, no agent cooperation needed.' },
        { kind: 'note', text: 'The one-command path is Claude Code only. Other tools connect and record in two explicit steps.' },
      ],
    }),
    recorder: () => ({
      lede: 'Already installed by the command above — the Stop hook records every turn exactly.',
      blocks: [
        { kind: 'command', code: 'npx tokenfin status', note: 'Restart Claude Code once, then confirm the hook + server are green.' },
      ],
    }),
  },
  {
    id: 'codex', name: 'Codex CLI', category: 'terminal', brand: '#10A37F',
    Icon: SquareTerminal, tier: 'proxy', accuracy: 'exact',
    blurb: 'Bridge in config.toml, then route its API calls through the proxy.',
    connect: (url, key) => ({
      lede: 'Add the tokenfin server to Codex via the mcp-remote bridge (TOML).',
      blocks: [
        { kind: 'config', filename: '~/.codex/config.toml', lang: 'toml', code: codexToml(url, key) },
        { kind: 'note', text: 'Codex speaks stdio MCP, so it reaches the remote server through the mcp-remote bridge (Node 18+).' },
      ],
    }),
    recorder: () => ({
      lede: 'Run the universal recorder and point Codex at it — exact, provider-reported usage.',
      blocks: [
        { kind: 'command', code: 'npx tokenfin@latest proxy', note: `Starts the recorder on ${PROXY_URL}. Leave it running.` },
        { kind: 'command', code: proxyEnv('openai'), note: 'Codex now routes model calls through the proxy, which records real token counts and forwards the response unchanged.' },
      ],
    }),
  },
  {
    id: 'gemini', name: 'Gemini CLI', category: 'terminal', brand: '#4285F4',
    Icon: Sparkles, tier: 'proxy', accuracy: 'exact',
    blurb: 'Bridge in settings.json, then route its API calls through the proxy.',
    connect: (url, key) => ({
      lede: 'Add the tokenfin server to Gemini CLI via the mcp-remote bridge.',
      blocks: [
        { kind: 'config', filename: '~/.gemini/settings.json', lang: 'json', code: bridgeJson(url, key) },
      ],
    }),
    recorder: () => ({
      lede: 'Run the universal recorder and point Gemini at it — exact usage.',
      blocks: [
        { kind: 'command', code: 'npx tokenfin@latest proxy', note: `Starts the recorder on ${PROXY_URL}. Leave it running.` },
        { kind: 'command', code: proxyEnv('both'), note: 'Gemini CLI routes model calls through the proxy, which records and forwards unchanged.' },
      ],
    }),
  },

  // ── Code editors ────────────────────────────────────────────────────────────
  {
    id: 'cursor', name: 'Cursor', category: 'editor', brand: '#0A0A0A',
    Icon: Code2, tier: 'rule', accuracy: 'estimated',
    blurb: 'One-click add. Records via a rule — upgrade to the proxy for exact.',
    connect: (url, key) => ({
      lede: 'One click bakes your key in — approve Install in Cursor.',
      blocks: [
        { kind: 'deeplink', label: 'Add to Cursor', href: cursorDeeplink(url, key),
          alt: { label: 'Open install page in browser', href: cursorWeb(url, key) } },
        { kind: 'config', filename: '~/.cursor/mcp.json (manual)', lang: 'json', code: mcpServersJson(url, key) },
      ],
    }),
    recorder: (url, key) => ({
      lede: 'Save a recording rule (estimated). For exact numbers, run the proxy with your own key.',
      blocks: [
        { kind: 'config', filename: '.cursor/rules/tokenfin.mdc', lang: 'text', code: RECORD_RULE },
        { kind: 'note', text: 'Exact upgrade: run `npx tokenfin@latest proxy` and set Cursor’s model base URL to the proxy (BYO key).' },
        { kind: 'command', code: proxyEnv('both') },
      ],
    }),
  },
  {
    id: 'vscode', name: 'VS Code (Copilot)', category: 'editor', brand: '#007ACC',
    Icon: Code2, tier: 'rule', accuracy: 'estimated',
    blurb: 'One-click add. Copilot records by following a saved rule.',
    connect: (url, key) => ({
      lede: 'One click pre-fills the server — approve it in VS Code.',
      blocks: [
        { kind: 'deeplink', label: 'Add to VS Code', href: vscodeLink(url, key),
          alt: { label: 'Add to VS Code Insiders', href: vscodeInsiders(url, key) } },
        { kind: 'config', filename: '.vscode/mcp.json (manual — top-level "servers")', lang: 'json', code: vscodeServersJson(url, key) },
      ],
    }),
    recorder: () => ({
      lede: 'Copilot calls are vendor-routed, so recording follows a saved rule — estimated.',
      blocks: [
        { kind: 'config', filename: '.github/copilot-instructions.md', lang: 'text', code: RECORD_RULE },
      ],
    }),
  },
  {
    id: 'windsurf', name: 'Windsurf', category: 'editor', brand: '#09B6A2',
    Icon: Wind, tier: 'rule', accuracy: 'estimated',
    blurb: 'Bridge config. Records via a rule — proxy (BYO key) for exact.',
    connect: (url, key) => ({
      lede: 'Add the tokenfin server to Windsurf via the mcp-remote bridge.',
      blocks: [
        { kind: 'config', filename: '~/.codeium/windsurf/mcp_config.json', lang: 'json', code: bridgeJson(url, key) },
      ],
    }),
    recorder: () => ({
      lede: 'Save a recording rule (estimated), or run the proxy with your own key for exact.',
      blocks: [
        { kind: 'config', filename: '.windsurfrules', lang: 'text', code: RECORD_RULE },
        { kind: 'command', code: `npx tokenfin@latest proxy\n${proxyEnv('both')}` },
      ],
    }),
  },
  {
    id: 'cline', name: 'Cline', category: 'editor', brand: '#5B5BD6',
    Icon: Boxes, tier: 'rule', accuracy: 'estimated',
    blurb: 'Bridge config. Records via a rule — proxy (BYO key) for exact.',
    connect: (url, key) => ({
      lede: 'Add the tokenfin server to Cline via the mcp-remote bridge.',
      blocks: [
        { kind: 'config', filename: 'cline_mcp_settings.json', lang: 'json', code: bridgeJson(url, key) },
      ],
    }),
    recorder: () => ({
      lede: 'Save a recording rule (estimated), or run the proxy with your own key for exact.',
      blocks: [
        { kind: 'config', filename: '.clinerules', lang: 'text', code: RECORD_RULE },
        { kind: 'command', code: `npx tokenfin@latest proxy\n${proxyEnv('both')}` },
      ],
    }),
  },

  // ── Chat apps (locked — estimated) ───────────────────────────────────────────
  {
    id: 'claude-ai', name: 'Claude.ai', category: 'chat', brand: CLAUDE,
    Icon: Sparkles, tier: 'rule', accuracy: 'estimated',
    blurb: 'Custom connector in settings. Recording follows a saved rule.',
    connect: (url, key) => ({
      lede: 'Settings → Connectors → Add custom connector. Paste a Name + URL (OAuth empty).',
      blocks: [
        { kind: 'open', label: 'Open Claude connectors', href: 'https://claude.ai/settings/connectors?modal=add-custom-connector' },
        { kind: 'chips', chips: [{ label: 'Name', value: 'tokenfin' }, { label: 'URL', value: connectorUrl(url, key) }] },
      ],
    }),
    recorder: () => ({
      lede: 'Claude.ai calls run on Anthropic’s servers — recording is a saved rule the model follows. Estimated.',
      blocks: [
        { kind: 'config', filename: 'Settings → Profile → personal preferences', lang: 'text', code: RECORD_RULE },
      ],
    }),
  },
  {
    id: 'claude-desktop', name: 'Claude Desktop', category: 'chat', brand: CLAUDE,
    Icon: MonitorSmartphone, tier: 'rule', accuracy: 'estimated',
    blurb: 'Same custom connector — syncs from claude.ai. Rule-based.',
    connect: (url, key) => ({
      lede: 'Connectors sync from your Claude account — add it once on claude.ai and it appears in Desktop.',
      blocks: [
        { kind: 'open', label: 'Open Claude connectors', href: 'https://claude.ai/settings/connectors?modal=add-custom-connector' },
        { kind: 'chips', chips: [{ label: 'Name', value: 'tokenfin' }, { label: 'URL', value: connectorUrl(url, key) }] },
      ],
    }),
    recorder: () => ({
      lede: 'Vendor-routed calls — recording follows a saved rule. Estimated.',
      blocks: [
        { kind: 'config', filename: 'Settings → Profile preferences (syncs with claude.ai)', lang: 'text', code: RECORD_RULE },
      ],
    }),
  },
  {
    id: 'chatgpt', name: 'ChatGPT', category: 'chat', brand: '#10A37F',
    Icon: MessageCircle, tier: 'rule', accuracy: 'estimated',
    blurb: 'Custom connector — requires Developer Mode. Rule-based.',
    connect: (url, key) => ({
      lede: 'Settings → Connectors → Advanced → enable Developer Mode, then add a custom connector.',
      blocks: [
        { kind: 'open', label: 'Open ChatGPT', href: 'https://chatgpt.com' },
        { kind: 'chips', chips: [{ label: 'Name', value: 'tokenfin' }, { label: 'URL', value: connectorUrl(url, key) }] },
        { kind: 'note', text: 'Standard connectors reject a tools server — Developer Mode (Plus/Pro/Team/Enterprise) is required.' },
      ],
    }),
    recorder: () => ({
      lede: 'ChatGPT calls run on OpenAI’s servers — recording is a saved rule. Estimated.',
      blocks: [
        { kind: 'config', filename: 'Settings → Personalization → Custom Instructions', lang: 'text', code: RECORD_RULE },
      ],
    }),
  },

  // ── Custom & API ─────────────────────────────────────────────────────────────
  {
    id: 'custom', name: 'Your own agent / SDK', category: 'custom', brand: '#00A98F',
    Icon: Braces, tier: 'code', accuracy: 'exact',
    blurb: 'Call record_usage in code, run the proxy, or route the gateway.',
    connect: (url, key) => ({
      lede: 'The MCP server is a plain JSON-RPC endpoint. Confirm the connection:',
      blocks: [
        { kind: 'command', code: `curl -s -X POST ${url} -H "Authorization: ${bearer(key)}" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` },
      ],
    }),
    recorder: (url, key) => ({
      lede: 'Call record_usage after each model response (exact), or run the universal proxy.',
      blocks: [
        { kind: 'code', tabs: [
          { label: 'JavaScript', code: jsSnippet(url, key) },
          { label: 'Python',     code: pySnippet(url, key) },
          { label: 'curl',       code: curlSnippet(url, key) },
        ] },
        { kind: 'note', text: 'Prefer zero code? Run `npx tokenfin@latest proxy` and set your SDK’s base URL to the proxy.' },
        { kind: 'command', code: `npx tokenfin@latest proxy\n${proxyEnv('both')}` },
      ],
    }),
  },
]

export const TOOL_BY_ID: Record<string, Tool> = Object.fromEntries(TOOLS.map(t => [t.id, t]))

/**
 * Best-effort inference of a connected key's recorder tier + accuracy for the
 * Connected Platforms page, from the key name and the models it recorded.
 * Honest fallback: unknown tier, and accuracy 'exact' only when we can tell.
 */
export function inferConnection(name: string, models: string[]): { tier: Tier | null; accuracy: Accuracy | null } {
  const n = (name || '').toLowerCase()
  for (const t of TOOLS) {
    if (n.includes(t.id) || n.includes(t.name.toLowerCase().split(' ')[0])) {
      return { tier: t.tier, accuracy: t.accuracy }
    }
  }
  // setup-hub / test keys record through the exact server path.
  if (n.includes('setup') || models.includes('setup-test')) return { tier: 'code', accuracy: 'exact' }
  return { tier: null, accuracy: null }
}
