'use client'

/**
 * MCP Connect — category-first onboarding that goes ALL the way:
 *
 *   Step 1  Paste key        (injected into every snippet, never leaves the browser)
 *   Step 2  Pick HOW you use AI  → chat app / code editor / terminal / custom
 *   Step 3  Pick the exact tool
 *   Phase A CONNECT          → correct config for that tool's real capabilities
 *   Phase B AUTO-RECORD      → how usage actually reaches TokenFin for THIS category
 *                              (hook / persistent rule / code) — connecting MCP alone
 *                              does NOT fill the dashboard, and we say so honestly
 *   Phase C TEST             → live first-event detector + scripted test
 *
 * Category truths this page is built around:
 *   · Chat & desktop apps (Claude.ai, Claude Desktop, Cowork, ChatGPT) cannot edit
 *     files or run commands — everything happens in their Settings UI, and recording
 *     comes from a rule saved in their instructions/memory.
 *   · IDE/CLI agents get a persistent rules file so recording survives every session.
 *   · Claude Code is the only true auto-recorder (Stop hook).
 *   · Custom agents record from code (or the gateway for guaranteed capture).
 */

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Puzzle, Copy, Check, KeyRound, Terminal, MessageSquareText, FileJson, Globe,
  Eye, EyeOff, Zap, Bot, ShieldCheck, Code2, MonitorSmartphone, Radio, PartyPopper,
} from 'lucide-react'

const PLACEHOLDER = '<YOUR_TOKENFIN_KEY>'

// ── shared snippet builders ───────────────────────────────────────────────────
const remoteJson = (url: string, key: string) =>
  JSON.stringify({ mcpServers: { tokenfin: { url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)
const vscodeJson = (url: string, key: string) =>
  JSON.stringify({ servers: { tokenfin: { type: 'http', url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)
const geminiJson = (url: string, key: string) =>
  JSON.stringify({ mcpServers: { tokenfin: { httpUrl: url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)
const bridgeJson = (url: string, key: string) =>
  JSON.stringify({ mcpServers: { tokenfin: { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', `Authorization: Bearer ${key}`] } } }, null, 2)
const connectorUrl = (url: string, key: string) => `${url}?key=${key}`

// The recording rule — written for agents that ALREADY have tokenfin connected.
// No file editing, no commands: works pasted into a chat or saved as a rule.
const RECORD_RULE = `# TokenFin — track my AI usage automatically
The "tokenfin" MCP server is connected in this environment. Follow these rules at all times:
1. After EVERY model response, call tokenfin record_usage with
   { model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens }.
   Use the turn's real usage numbers if you can see them, otherwise your best estimate.
2. Before adding any bulky tool output, JSON, or logs to context, call tokenfin compress on it first.
3. Never print, echo, or save my TokenFin API key anywhere.`

const TEST_ASK = 'Using tokenfin, what did I spend on AI in the last 7 days?'
const TEST_RECORD = 'Call the tokenfin tool record_usage with model "setup-test", input_tokens 100, output_tokens 50.'

// ── types ─────────────────────────────────────────────────────────────────────
type CatId = 'chat' | 'ide' | 'cli' | 'custom'
interface Snippet { label: string; code: string }
interface Phase { snippets: Snippet[]; steps: string[]; note?: string }
interface Client {
  id: string; name: string; cat: CatId; icon: React.ElementType
  recordKind: 'hook' | 'rule' | 'code'
  connect: (url: string, key: string) => Phase
  record: (url: string, key: string) => Phase
}

const CATS: { id: CatId; title: string; desc: string; examples: string; icon: React.ElementType }[] = [
  { id: 'chat', title: 'Chat & desktop apps', desc: 'No terminal, no files — everything happens in the app\'s Settings.', examples: 'Claude.ai · Claude Desktop · Cowork · ChatGPT', icon: MonitorSmartphone },
  { id: 'ide', title: 'Code editor agents', desc: 'Config file + a rules file so recording sticks in every session.', examples: 'Cursor · VS Code · Cline · Windsurf · Antigravity', icon: FileJson },
  { id: 'cli', title: 'Terminal agents', desc: 'One command; Claude Code even records every turn automatically.', examples: 'Claude Code · Codex CLI · Gemini CLI', icon: Terminal },
  { id: 'custom', title: 'Custom agent / API', desc: 'Your own agent, backend, or script — record straight from code.', examples: 'LangChain · SDKs · Gateway proxy', icon: Code2 },
]

// ── per-client record phases (reused) ─────────────────────────────────────────
const chatRecord = (where: string, extra?: string): Phase => ({
  snippets: [{ label: 'The recording rule — paste once, or save it permanently', code: RECORD_RULE }],
  steps: [
    `Quick: paste the rule at the start of a chat — the agent follows it for that whole conversation.`,
    `Permanent (recommended): save it in ${where} — then every new chat records without pasting anything.`,
    ...(extra ? [extra] : []),
  ],
  note: 'Chat apps can\'t run background hooks, so recording relies on the agent following this rule. Numbers may be estimates. For invoice-grade capture use Claude Code or the gateway.',
})

const ruleFileRecord = (file: string, how: string): Phase => ({
  snippets: [{ label: `Save as ${file}`, code: RECORD_RULE }],
  steps: [
    `Create ${file} in your project (or user-level equivalent) with the rule above. ${how}`,
    'From now on the agent calls record_usage after each response in every session — no per-session pasting.',
  ],
})

// ── client registry ───────────────────────────────────────────────────────────
const CLIENTS: Client[] = [
  // ═══ Chat & desktop apps — Settings UI only, never files/terminal ═══
  {
    id: 'claudeai', name: 'Claude.ai (web)', cat: 'chat', icon: Globe, recordKind: 'rule',
    connect: (url, key) => ({
      snippets: [{ label: 'Settings → Connectors → Add custom connector', code: `Name:  tokenfin\nURL:   ${connectorUrl(url, key)}` }],
      steps: [
        'Open claude.ai → Settings → Connectors → "Add custom connector".',
        'Paste the name and URL exactly (your key rides inside the URL — this dialog has no header field).',
        'Leave the OAuth Client ID / Secret fields empty and save.',
        'In any chat, open the tools menu (⚙/🔍 icon) and enable tokenfin.',
      ],
      note: 'One-time: connectors added here sync to Claude Desktop, mobile, and Cowork on the same account.',
    }),
    record: () => chatRecord('Settings → Profile → "personal preferences", or your Project\'s instructions'),
  },
  {
    id: 'claudedesk', name: 'Claude Desktop', cat: 'chat', icon: MessageSquareText, recordKind: 'rule',
    connect: (url, key) => ({
      snippets: [{ label: 'Settings → Connectors → Add custom connector', code: `Name:  tokenfin\nURL:   ${connectorUrl(url, key)}` }],
      steps: [
        'Claude Desktop → Settings → Connectors → "Add custom connector".',
        'Paste name + URL, leave OAuth fields empty, save.',
        'Already added it on claude.ai? It\'s synced — just enable tokenfin in the chat tools menu.',
      ],
    }),
    record: () => chatRecord('Settings → Profile preferences, or a Project\'s custom instructions (syncs with claude.ai)'),
  },
  {
    id: 'cowork', name: 'Cowork', cat: 'chat', icon: Bot, recordKind: 'rule',
    connect: (url, key) => ({
      snippets: [{ label: 'Connector (added via claude.ai or Desktop settings)', code: `Name:  tokenfin\nURL:   ${connectorUrl(url, key)}` }],
      steps: [
        'Cowork uses your Claude account\'s connectors: add tokenfin once via claude.ai or Claude Desktop → Settings → Connectors (name + URL above, OAuth empty).',
        'Open a Cowork session and ask: "list the tokenfin tools" — you should see 9 tools.',
      ],
      note: 'Cowork sessions are agentic and long — the recording rule below matters even more here, since one session can burn many turns.',
    }),
    record: () => chatRecord('a CLAUDE.md in the folder you connect, or paste it as your first message', 'Bonus for Cowork: it reads CLAUDE.md from your connected folder automatically — drop the rule in there once and every session obeys it.'),
  },
  {
    id: 'chatgpt', name: 'ChatGPT', cat: 'chat', icon: Globe, recordKind: 'rule',
    connect: (url, key) => ({
      snippets: [{ label: 'Custom connector (Developer Mode)', code: `Name:  tokenfin\nURL:   ${connectorUrl(url, key)}\nAuth:  None — the key is in the URL` }],
      steps: [
        'Enable Developer Mode first: Settings → Connectors → Advanced → Developer mode. (Standard connectors only accept search/fetch-style servers — tokenfin needs Developer Mode.)',
        'Add the connector with the name + URL above; leave OAuth empty.',
        'In a chat, enable tokenfin from the tools/connectors menu.',
      ],
    }),
    record: () => chatRecord('Settings → Personalization → Custom Instructions'),
  },

  // ═══ Code editor agents — config + persistent rules file ═══
  {
    id: 'cursor', name: 'Cursor', cat: 'ide', icon: FileJson, recordKind: 'rule',
    connect: (url, key) => ({
      snippets: [{ label: '~/.cursor/mcp.json (global) or .cursor/mcp.json (per-project)', code: remoteJson(url, key) }],
      steps: [
        'Cursor Settings → MCP → "Add new global MCP server" (opens mcp.json) — or create .cursor/mcp.json in the project.',
        'Paste, save — Cursor hot-reloads. The tokenfin entry should turn green with 9 tools.',
      ],
    }),
    record: () => ruleFileRecord('.cursor/rules/tokenfin.mdc (or legacy .cursorrules)', 'Cursor applies rules files to every Composer/Agent run.'),
  },
  {
    id: 'vscode', name: 'VS Code (Copilot agent)', cat: 'ide', icon: FileJson, recordKind: 'rule',
    connect: (url, key) => ({
      snippets: [{ label: '.vscode/mcp.json — top-level key is "servers", NOT "mcpServers"', code: vscodeJson(url, key) }],
      steps: [
        'Create .vscode/mcp.json (or command palette → "MCP: Add Server").',
        'Click the ▶ Start hint above the server entry; tools appear in Copilot agent mode.',
      ],
    }),
    record: () => ruleFileRecord('.github/copilot-instructions.md', 'Copilot reads it on every agent request in the workspace.'),
  },
  {
    id: 'cline', name: 'Cline / Roo Code', cat: 'ide', icon: Bot, recordKind: 'rule',
    connect: (url, key) => ({
      snippets: [{ label: 'MCP Servers → Configure (cline_mcp_settings.json)', code: bridgeJson(url, key) }],
      steps: ['In the extension: MCP Servers → "Configure MCP Servers" (opens its JSON).', 'Paste and save. The npx bridge needs Node 18+.'],
    }),
    record: () => ruleFileRecord('.clinerules', 'Cline injects it into every task.'),
  },
  {
    id: 'windsurf', name: 'Windsurf', cat: 'ide', icon: FileJson, recordKind: 'rule',
    connect: (url, key) => ({
      snippets: [{ label: '~/.codeium/windsurf/mcp_config.json', code: bridgeJson(url, key) }],
      steps: ['Windsurf Settings → Cascade → MCP → "View raw config".', 'Paste, save, then hit refresh in the MCP panel.'],
    }),
    record: () => ruleFileRecord('.windsurfrules', 'Cascade applies it to every flow.'),
  },
  {
    id: 'antigravity', name: 'Antigravity', cat: 'ide', icon: Bot, recordKind: 'rule',
    connect: (url, key) => ({
      snippets: [{ label: 'Agent panel → ⚙ → MCP Servers → Manage (mcp.json)', code: bridgeJson(url, key) }],
      steps: ['Open the MCP config from the agent panel, paste, save, refresh servers.', 'Bridge needs Node 18+.'],
    }),
    record: () => ruleFileRecord('AGENTS.md (project root)', 'Antigravity agents read AGENTS.md as standing instructions.'),
  },

  // ═══ Terminal agents ═══
  {
    id: 'claudecode', name: 'Claude Code', cat: 'cli', icon: Terminal, recordKind: 'hook',
    connect: (url, key) => ({
      snippets: [{ label: 'One command — MCP server + auto-record hook', code: `npx tokenfin@latest setup --key ${key} --url ${url}` }],
      steps: [
        'Run it in any terminal. It verifies your key live, registers the MCP server, and installs a Stop hook.',
        'Restart Claude Code once.',
      ],
      note: 'Read-only alternative (no auto-record): claude mcp add --transport http tokenfin ' + url + ' --header "Authorization: Bearer ' + key + '"',
    }),
    record: () => ({
      snippets: [{ label: 'Nothing to do — the hook records for you', code: 'npx tokenfin status   # all four checks should be ✔' }],
      steps: [
        'The Stop hook fires after every turn: it reads the real token counts from the session transcript (cache reads/writes priced correctly), retries failed sends, and dedupes — no estimates, no habits to teach.',
        'This is the most accurate integration TokenFin has. You\'re done after Phase A.',
      ],
    }),
  },
  {
    id: 'codex', name: 'Codex CLI', cat: 'cli', icon: Terminal, recordKind: 'rule',
    connect: (url, key) => ({
      snippets: [{ label: '~/.codex/config.toml', code: `[mcp_servers.tokenfin]\ncommand = "npx"\nargs = ["-y", "mcp-remote", "${url}", "--header", "Authorization: Bearer ${key}"]` }],
      steps: ['Append to ~/.codex/config.toml and restart Codex.', 'Needs Node 18+ for the npx bridge.'],
    }),
    record: () => ruleFileRecord('AGENTS.md (project root)', 'Codex treats AGENTS.md as standing instructions.'),
  },
  {
    id: 'gemini', name: 'Gemini CLI', cat: 'cli', icon: Terminal, recordKind: 'rule',
    connect: (url, key) => ({
      snippets: [{ label: 'Merge into ~/.gemini/settings.json (note: httpUrl)', code: geminiJson(url, key) }],
      steps: ['Merge the block into ~/.gemini/settings.json.', 'Restart, then run /mcp — tokenfin should list 9 tools.'],
    }),
    record: () => ruleFileRecord('GEMINI.md (project root)', 'Gemini CLI loads GEMINI.md as persistent context.'),
  },

  // ═══ Custom agent / API ═══
  {
    id: 'api', name: 'Your own agent / script', cat: 'custom', icon: Code2, recordKind: 'code',
    connect: (url, key) => ({
      snippets: [{ label: 'It\'s one JSON-RPC endpoint — test the connection', code: `curl -s -X POST ${url} \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${key}" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` }],
      steps: [
        'Any MCP SDK works (transport: Streamable HTTP, auth: Bearer header) — or skip MCP entirely and POST JSON-RPC directly, as above.',
        'The response lists 9 tools: 5 analytics, compress/retrieve/savings_stats, and record_usage.',
      ],
    }),
    record: (url, key) => ({
      snippets: [
        { label: 'After each LLM call — curl', code: `curl -s -X POST ${url} \\\n  -H "Content-Type: application/json" -H "Authorization: Bearer ${key}" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"record_usage","arguments":{\n    "model":"claude-opus-4-8","input_tokens":1200,"output_tokens":300,\n    "cache_read_tokens":0,"cache_creation_tokens":0,"event_id":"<unique-per-call>"}}}'` },
        { label: 'After each LLM call — JS/TS', code: `await fetch('${url}', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ${key}' },\n  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {\n    name: 'record_usage',\n    arguments: { model: resp.model, input_tokens: resp.usage.input_tokens,\n      output_tokens: resp.usage.output_tokens,\n      cache_read_tokens: resp.usage.cache_read_input_tokens ?? 0,\n      cache_creation_tokens: resp.usage.cache_creation_input_tokens ?? 0,\n      event_id: resp.id } } }),\n})` },
      ],
      steps: [
        'Call record_usage right after every provider response, passing the usage block the provider returns.',
        'Always send an event_id (the provider\'s response id is perfect) — retries then never double-count.',
        'Cost is computed server-side, cache-aware; pass cost_usd only to override.',
      ],
    }),
  },
  {
    id: 'gateway', name: 'Gateway proxy (guaranteed)', cat: 'custom', icon: Zap, recordKind: 'code',
    connect: (url, key) => ({
      snippets: [{ label: 'Point your SDK at the TokenFin gateway', code: `# self-host the gateway (backend/cmd/gateway, port 8003), then:\nexport ANTHROPIC_BASE_URL=https://<your-gateway-host>\nexport OPENAI_BASE_URL=https://<your-gateway-host>/v1\n# requests are forwarded unchanged; usage is recorded server-side` }],
      steps: [
        'Deploy the gateway once (Docker image in infra/docker); give it your TokenFin key.',
        'Change nothing in your code except the base URL — every request through it is recorded with exact provider-reported usage.',
      ],
      note: 'Strongest guarantee: capture happens server-side, no agent cooperation needed — plus output-shaping savings measured against a holdout.',
    }),
    record: () => ({
      snippets: [],
      steps: ['Nothing to do — the gateway records every request that passes through it, with exact usage straight from the provider response.'],
    }),
  },
]

// ── live first-event detector ─────────────────────────────────────────────────
type ListenState = 'idle' | 'listening' | 'found' | 'timeout' | 'error'
function FirstEventTest() {
  const [state, setState] = useState<ListenState>('idle')
  const [found, setFound] = useState<{ model: string; cost_usd: number } | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null } }
  useEffect(() => stop, [])

  const start = async () => {
    stop(); setFound(null); setState('listening')
    const supabase = createClient()
    const since = new Date().toISOString()
    let orgId: string | null = null
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('no session')
      const { data: m, error } = await supabase.from('members').select('org_id').eq('user_id', user.id).limit(1).maybeSingle()
      if (error || !m) throw error ?? new Error('no org')
      orgId = m.org_id as string
    } catch { setState('error'); return }

    const deadline = Date.now() + 5 * 60_000
    timer.current = setInterval(async () => {
      if (Date.now() > deadline) { stop(); setState('timeout'); return }
      const { data } = await supabase.from('usage_events')
        .select('model, cost_usd').eq('org_id', orgId!).gte('created_at', since)
        .order('created_at', { ascending: false }).limit(1)
      if (data && data.length > 0) {
        stop(); setFound({ model: data[0].model as string, cost_usd: Number(data[0].cost_usd ?? 0) }); setState('found')
      }
    }, 5000)
  }

  return (
    <div className="flex items-center gap-3 border-t border-[var(--border)] px-4 py-3">
      {state === 'found' ? (
        <>
          <PartyPopper size={16} className="flex-shrink-0 text-teal" />
          <div className="text-[12px] text-[var(--fg)]">
            <span className="font-semibold text-teal">Event received!</span>{' '}
            model <span className="font-mono">{found?.model}</span> · ${found?.cost_usd.toFixed(6)} — your pipeline works end to end.{' '}
            <a href="/dashboard" className="font-medium text-teal underline underline-offset-2">See it on the dashboard</a>
          </div>
        </>
      ) : (
        <>
          <Radio size={16} className={`flex-shrink-0 ${state === 'listening' ? 'animate-pulse text-teal' : 'text-[var(--fg-tertiary)]'}`} />
          <div className="flex-1 text-[12px] text-[var(--fg-secondary)]">
            {state === 'idle' && 'Live check: click Start, then trigger the test in your tool — this lights up the moment your first event lands.'}
            {state === 'listening' && 'Listening for your first event… now run step 2 in your AI tool. (Watching for up to 5 minutes.)'}
            {state === 'timeout' && 'No event in 5 minutes. Re-check Phase B, or see Troubleshooting below — then try again.'}
            {state === 'error' && 'Couldn\'t start the live check (session issue). No problem — run the test and watch the dashboard instead.'}
          </div>
          <button onClick={start} disabled={state === 'listening'}
            className="btn-primary flex-shrink-0 rounded-lg px-3 py-1.5 text-[11.5px] font-medium disabled:opacity-50">
            {state === 'listening' ? 'Listening…' : state === 'timeout' || state === 'error' ? 'Retry' : 'Start live check'}
          </button>
        </>
      )}
    </div>
  )
}

// ── page component ────────────────────────────────────────────────────────────
export function McpConnectClient({ endpoint }: { endpoint: string }) {
  const [catId, setCatId] = useState<CatId>('chat')
  const [clientId, setClientId] = useState('claudeai')
  const [rawKey, setRawKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const key = rawKey.trim() || PLACEHOLDER
  const keyed = rawKey.trim().length > 0
  const clients = CLIENTS.filter(c => c.cat === catId)
  const client = CLIENTS.find(c => c.id === clientId) ?? clients[0]
  const connect = client.connect(endpoint, key)
  const record = client.record(endpoint, key)

  const pickCat = (id: CatId) => {
    setCatId(id)
    const first = CLIENTS.find(c => c.cat === id)!
    setClientId(first.id)
  }

  const copy = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id); setTimeout(() => setCopiedId(null), 2000)
  }
  const CopyBtn = ({ id, text }: { id: string; text: string }) => (
    <button onClick={() => copy(id, text)}
      className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)]">
      {copiedId === id ? <><Check size={12} className="text-teal" /> Copied</> : <><Copy size={12} /> Copy</>}
    </button>
  )

  const PhaseCard = ({ tag, title, sub, phase, children }: { tag: string; title: string; sub?: string; phase: Phase; children?: React.ReactNode }) => (
    <div className="mb-4">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="rounded-md bg-[var(--green-bg)] px-1.5 py-0.5 text-[10.5px] font-bold tracking-wide text-teal">{tag}</span>
        <span className="text-[13px] font-semibold text-[var(--fg)]">{title}</span>
        {sub && <span className="truncate text-[11px] text-[var(--fg-tertiary)]">{sub}</span>}
      </div>
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)]">
        {phase.snippets.map((s, i) => (
          <div key={i} className={i > 0 ? 'border-t border-[var(--border)]' : ''}>
            <div className="flex items-center justify-between gap-2 px-4 pt-3">
              <span className="min-w-0 truncate text-[11px] font-medium text-[var(--fg-secondary)]">{s.label}</span>
              <CopyBtn id={`${client.id}-${tag}-${i}`} text={s.code} />
            </div>
            <pre className="overflow-x-auto whitespace-pre px-4 py-3 font-mono text-[11.5px] leading-relaxed text-[var(--fg)]">{s.code}</pre>
          </div>
        ))}
        {phase.steps.length > 0 && (
          <ol className={`space-y-2 px-4 py-3 ${phase.snippets.length ? 'border-t border-[var(--border)]' : ''}`}>
            {phase.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[12px] leading-relaxed text-[var(--fg-secondary)]">
                <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[var(--bg-tertiary)] text-[10px] font-semibold text-[var(--fg-secondary)]">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        )}
        {phase.note && <p className="border-t border-[var(--border)] px-4 py-2.5 text-[11px] leading-relaxed text-[var(--fg-tertiary)]">{phase.note}</p>}
        {children}
      </div>
    </div>
  )

  const testPhase: Phase = {
    snippets: [
      { label: '1 · Prove reading works — ask your agent', code: TEST_ASK },
      { label: '2 · Prove recording works — then watch the live check below', code: client.recordKind === 'hook' ? 'Ask Claude Code anything — the hook records the turn automatically.' : client.recordKind === 'code' ? 'Send one record_usage call from your code (or the curl above in Phase B).' : TEST_RECORD },
    ],
    steps: [],
  }

  return (
    <div className="mx-auto max-w-2xl">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--green-bg)]"><Puzzle size={22} className="text-teal" /></div>
        <div>
          <h1 className="text-[20px] font-bold tracking-tight text-[var(--fg)]">Connect your AI tools</h1>
          <p className="text-[13px] leading-snug text-[var(--fg-secondary)]">Three phases, honestly: connect the MCP server, make usage actually record, then prove it with a live test.</p>
        </div>
      </div>

      {/* Step 1 — key */}
      <div className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
        <div className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-[var(--fg)]">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--green-bg)] text-[10.5px] text-teal">1</span>
          Paste your API key
          <span className="ml-auto flex items-center gap-1 text-[10.5px] font-normal text-[var(--fg-tertiary)]"><ShieldCheck size={12} /> stays in your browser</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]" />
            <input
              type={showKey ? 'text' : 'password'} value={rawKey} onChange={e => setRawKey(e.target.value)}
              placeholder="tfk_prod_…  (Dashboard → API Keys → Create key)"
              autoComplete="off" spellCheck={false}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] py-2 pl-9 pr-9 font-mono text-[12px] text-[var(--fg)] placeholder:font-sans placeholder:text-[var(--fg-tertiary)] focus:border-teal focus:outline-none"
            />
            <button onClick={() => setShowKey(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)] hover:text-[var(--fg)]">
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <a href="/dashboard/keys" className="btn-secondary whitespace-nowrap rounded-xl px-3 py-2 text-[12px] font-medium">Create key</a>
        </div>
        {!keyed && <p className="mt-2 text-[11px] text-[var(--fg-tertiary)]">Every snippet below fills in automatically once you paste it. Use the full raw key — the masked tfk_…_xxxx from the key list won’t work.</p>}
      </div>

      {/* Step 2 — category */}
      <div className="mb-5">
        <div className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-[var(--fg)]">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--green-bg)] text-[10.5px] text-teal">2</span>
          How do you use AI?
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CATS.map(c => {
            const active = c.id === catId; const Icon = c.icon
            return (
              <button key={c.id} onClick={() => pickCat(c.id)}
                className={`rounded-2xl border p-3.5 text-left transition-colors ${active ? 'border-teal bg-[var(--green-bg)]' : 'border-[var(--border)] bg-[var(--bg-secondary)] hover:border-[var(--border-strong)]'}`}>
                <div className={`mb-1 flex items-center gap-2 text-[13px] font-semibold ${active ? 'text-teal' : 'text-[var(--fg)]'}`}><Icon size={15} /> {c.title}</div>
                <div className="text-[11.5px] leading-snug text-[var(--fg-secondary)]">{c.desc}</div>
                <div className="mt-1.5 text-[10.5px] text-[var(--fg-tertiary)]">{c.examples}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Step 3 — client */}
      <div className="mb-5">
        <div className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-[var(--fg)]">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--green-bg)] text-[10.5px] text-teal">3</span>
          Pick your tool
        </div>
        <div className="flex flex-wrap gap-2">
          {clients.map(c => {
            const active = c.id === client.id; const Icon = c.icon
            return (
              <button key={c.id} onClick={() => setClientId(c.id)}
                className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${active ? 'border-teal bg-[var(--green-bg)] text-teal' : 'border-[var(--border)] text-[var(--fg-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--fg)]'}`}>
                <Icon size={13} /> {c.name}
                {c.recordKind === 'hook' && <Zap size={11} className={active ? 'text-teal' : 'text-[var(--amber)]'} />}
              </button>
            )
          })}
        </div>
        {catId === 'cli' && <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--fg-tertiary)]"><Zap size={11} className="text-[var(--amber)]" /> Claude Code records every turn automatically via a hook — the most accurate option.</p>}
      </div>

      {/* Phases */}
      <PhaseCard tag="A · CONNECT" title={`Add tokenfin to ${client.name}`} phase={connect} />
      <PhaseCard
        tag="B · AUTO-RECORD"
        title={client.recordKind === 'hook' ? 'Already handled by the hook' : client.recordKind === 'code' ? 'Record from your code' : 'Teach it to record'}
        sub={client.recordKind === 'rule' ? 'connecting alone does not fill the dashboard — this does' : undefined}
        phase={record}
      />
      <PhaseCard tag="C · TEST" title="Prove it end to end" phase={testPhase}>
        <FirstEventTest />
      </PhaseCard>

      {/* Troubleshooting */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="px-4 pt-3 text-[12.5px] font-semibold text-[var(--fg)]">Troubleshooting</div>
        <div className="px-4 py-2">
          {[
            ['401 Unauthorized', 'You’re using the masked key from the list (tfk_…_xxxx). Only the full raw key works — it’s shown once at creation. Lost it? Create a new key and update your config.'],
            ['tokenfin doesn’t appear in the tool list', 'Fully restart the app (quit, not reload). For chat apps, check the connector saved without OAuth values; for editors, check the config path and that the JSON has no trailing commas.'],
            ['Connected, but the dashboard stays empty', 'That’s Phase B. Reading analytics works instantly, but recording needs the hook (Claude Code), the recording rule (chat apps & editors), or a record_usage call from your code. Re-do Phase B, then run the Phase C test.'],
            ['The agent forgets to record after a while', 'Long sessions can drift. Save the rule permanently (custom instructions / rules file / CLAUDE.md) instead of pasting per chat — or switch to Claude Code / the gateway for capture that can’t drift.'],
            ['npx bridge errors (mcp-remote)', 'The bridge needs Node 18+. Test with: npx -y mcp-remote --version. Behind a corporate proxy, set HTTPS_PROXY.'],
          ].map(([q, a], i) => (
            <details key={i} className="group border-b border-[var(--border)] py-2 last:border-b-0">
              <summary className="cursor-pointer list-none text-[12px] font-medium text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg)]">{q}</summary>
              <p className="pt-1.5 text-[11.5px] leading-relaxed text-[var(--fg-tertiary)]">{a}</p>
            </details>
          ))}
        </div>
      </div>

      <p className="mt-3 text-center text-[11px] text-[var(--fg-tertiary)]">
        Endpoint <code className="font-mono text-[var(--fg-secondary)]">{endpoint}</code> · Streamable HTTP · Bearer / x-api-key / ?key= auth · 9 tools
      </p>
    </div>
  )
}
