'use client'

import { useState } from 'react'
import { Puzzle, Copy, Check, KeyRound, Terminal, MessageSquareText, FileJson, Sparkles, Globe } from 'lucide-react'

const KEY_VAR = '<YOUR_TOKENFIN_KEY>'

type Mode = 'cli' | 'bridge' | 'remote' | 'vscode' | 'toml' | 'connector' | 'prompt'
interface Tool { id: string; name: string; where: string; mode: Mode; icon: React.ElementType; group: string }

const TOOLS: Tool[] = [
  { id: 'universal',  name: 'Universal prompt',  where: 'paste into any AI tool',        mode: 'prompt',    icon: Sparkles,          group: 'Any' },
  // Agents & IDEs — send the Authorization header
  { id: 'claudecode', name: 'Claude Code',       where: 'one command — auto-records usage', mode: 'cli',     icon: Terminal,          group: 'Agents & IDEs' },
  { id: 'cursor',     name: 'Cursor',            where: '~/.cursor/mcp.json',            mode: 'remote',    icon: FileJson,          group: 'Agents & IDEs' },
  { id: 'windsurf',   name: 'Windsurf',          where: '~/.codeium/windsurf/mcp_config.json', mode: 'bridge', icon: FileJson,      group: 'Agents & IDEs' },
  { id: 'vscode',     name: 'VS Code / Cline',   where: '.vscode/mcp.json',              mode: 'vscode',    icon: FileJson,          group: 'Agents & IDEs' },
  { id: 'antigravity',name: 'Antigravity',       where: 'MCP settings → mcp.json',       mode: 'remote',    icon: FileJson,          group: 'Agents & IDEs' },
  { id: 'codex',      name: 'Codex',             where: '~/.codex/config.toml',          mode: 'toml',      icon: Terminal,          group: 'Agents & IDEs' },
  { id: 'claudedesk', name: 'Claude Desktop',    where: 'claude_desktop_config.json',    mode: 'bridge',    icon: MessageSquareText, group: 'Agents & IDEs' },
  // Browser connectors — no header field, so the key rides in the URL
  { id: 'claudeai',   name: 'Claude.ai',         where: 'Settings → Connectors → Add custom', mode: 'connector', icon: Globe,       group: 'Browser' },
  { id: 'chatgpt',    name: 'ChatGPT',           where: 'Settings → Connectors',         mode: 'connector', icon: Globe,             group: 'Browser' },
]

const GROUPS = ['Any', 'Agents & IDEs', 'Browser']
const authLabel = (m: Mode) => m === 'connector' ? 'URL key' : m === 'prompt' ? 'auto' : m === 'cli' ? 'auto-record' : 'header auth'

function build(tool: Tool, url: string): { code: string; steps?: string } {
  const remote = JSON.stringify({ mcpServers: { tokenfin: { type: 'http', url, headers: { Authorization: `Bearer ${KEY_VAR}` } } } }, null, 2)
  // VS Code's .vscode/mcp.json uses a top-level "servers" key — NOT "mcpServers".
  const vscode = JSON.stringify({ servers: { tokenfin: { type: 'http', url, headers: { Authorization: `Bearer ${KEY_VAR}` } } } }, null, 2)
  const bridge = JSON.stringify({ mcpServers: { tokenfin: { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', `Authorization: Bearer ${KEY_VAR}`] } } }, null, 2)
  const toml = `[mcp_servers.tokenfin]\ncommand = "npx"\nargs = ["-y", "mcp-remote", "${url}", "--header", "Authorization: Bearer ${KEY_VAR}"]`
  // One command: installs the MCP server AND the Stop hook that auto-records
  // every turn's usage. The MCP server alone is passive — the hook is what
  // actually fills the dashboard, so this is the recommended path.
  const cli = `npx tokenfin@latest setup --key ${KEY_VAR} --url ${url}`
  const connectorUrl = `${url}?key=${KEY_VAR}`
  const prompt =
`Add an MCP server to my setup and connect it.

  name:      tokenfin
  transport: Streamable HTTP
  url:       ${url}
  auth:      header "Authorization: Bearer ${KEY_VAR}"
             (if this tool has no header field, use ${connectorUrl})

If I use Claude Code, run:
  claude mcp add --transport http tokenfin ${url} --header "Authorization: Bearer ${KEY_VAR}"

Otherwise add to my client's mcpServers config:
${remote}

Then verify it's connected and list its tools.`

  switch (tool.mode) {
    case 'cli':    return { code: cli, steps: `Installs the MCP server + a Stop hook that auto-records every turn's usage. Needs Node & the claude CLI (both ship with Claude Code). Restart Claude Code after. Read-only alternative (no auto-record): claude mcp add --transport http tokenfin ${url} --header "Authorization: Bearer ${KEY_VAR}"` }
    case 'vscode': return { code: vscode, steps: 'Save as .vscode/mcp.json (workspace) or add to user settings. Note the top-level key is "servers" in VS Code. For Cline, use its MCP settings UI with the same url + header.' }
    case 'bridge': return { code: bridge, steps: tool.id === 'windsurf' ? 'Save the file, then refresh MCP servers in Windsurf.' : 'Save the file, then fully quit & reopen Claude Desktop.' }
    case 'toml':   return { code: toml, steps: 'Add to ~/.codex/config.toml, then restart Codex.' }
    case 'connector': return {
      code: `Name:  tokenfin\nURL:   ${connectorUrl}`,
      steps: tool.id === 'chatgpt'
        ? 'Requires ChatGPT Developer Mode (Settings → Connectors → Advanced) — standard connectors only accept servers exposing search/fetch tools. The key goes in the URL; leave OAuth fields empty.'
        : 'This dialog has no header field — the key goes in the URL. Leave OAuth Client ID/Secret empty.',
    }
    case 'prompt': return { code: prompt }
    default:       return { code: remote }
  }
}

// Step-by-step guide, adapted to the selected client.
function guide(tool: Tool): { title: string; steps: string[]; note?: string } {
  const key = 'Create an API key under Dashboard → API Keys and copy the full raw key.'
  if (tool.mode === 'cli') {
    return {
      title: 'Set up Claude Code (auto-records usage)',
      steps: [
        key,
        'Run the command above (replace the key). It registers the MCP server and installs a hook that records every turn.',
        'Restart Claude Code.',
        'Verify with npx tokenfin status — or just use Claude Code; your dashboard fills automatically.',
      ],
      note: 'Auto-recording is Claude Code only. It needs Node and the claude CLI, both of which ship with Claude Code.',
    }
  }
  if (tool.mode === 'connector') {
    return {
      title: `Set up ${tool.name}`,
      steps: [
        key,
        `Open ${tool.where}.`,
        'Paste the name and URL above (the key rides in the URL — leave OAuth fields empty).',
        'Save. The tokenfin analytics & compress tools appear in your tool list.',
      ],
      note: 'Browser connectors can read analytics and compress, but cannot auto-record usage. Use Claude Code (or the gateway) for automatic recording.',
    }
  }
  if (tool.mode === 'prompt') {
    return {
      title: 'Set up any AI tool',
      steps: [
        key,
        'Paste the prompt above into your AI tool and replace the key.',
        'Let it add the MCP server, then ask it to list the tokenfin tools to confirm.',
      ],
    }
  }
  return {
    title: `Set up ${tool.name}`,
    steps: [
      key,
      `Open ${tool.where} and paste the config above (replace the key).`,
      'Save the file and restart / reload the client.',
      'The tokenfin tools appear in your tool list.',
    ],
    note: 'Connects read & compress tools. Automatic usage recording requires Claude Code or the gateway.',
  }
}

export function McpConnectClient({ endpoint }: { endpoint: string }) {
  const [toolId, setToolId] = useState('universal')
  const [copied, setCopied] = useState(false)
  const tool = TOOLS.find(t => t.id === toolId)!
  const { code, steps } = build(tool, endpoint)
  const g = guide(tool)

  const copy = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000) }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--green-bg)]"><Puzzle size={22} className="text-teal" /></div>
        <div>
          <h1 className="text-[20px] font-bold tracking-tight text-[var(--fg)]">Connect via MCP</h1>
          <p className="text-[13px] leading-snug text-[var(--fg-secondary)]">One connection — analytics, token saving, usage/prompt auto-sync. Pick your tool, copy, paste.</p>
        </div>
      </div>

      {/* Grouped tool pills */}
      <div className="mb-4 space-y-2.5">
        {GROUPS.map(g => (
          <div key={g}>
            <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">{g}</div>
            <div className="flex flex-wrap gap-2">
              {TOOLS.filter(t => t.group === g).map(t => {
                const active = t.id === toolId; const Icon = t.icon
                return (
                  <button key={t.id} onClick={() => setToolId(t.id)}
                    className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${active ? 'border-teal bg-[var(--green-bg)] text-teal' : 'border-[var(--border)] text-[var(--fg-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--fg)]'}`}>
                    <Icon size={13} /> {t.name}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Snippet card */}
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2 text-[12px]">
            <tool.icon size={14} className="flex-shrink-0 text-[var(--fg-tertiary)]" />
            <span className="font-medium text-[var(--fg)]">{tool.name}</span>
            <span className="truncate text-[var(--fg-tertiary)]">· {tool.where}</span>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <span className="rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5 text-[10px] font-medium text-[var(--fg-secondary)]">{authLabel(tool.mode)}</span>
            <button onClick={copy} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)]">
              {copied ? <><Check size={12} className="text-teal" /> Copied</> : <><Copy size={12} /> Copy</>}
            </button>
          </div>
        </div>
        <pre className="overflow-x-auto whitespace-pre px-4 py-3.5 font-mono text-[11.5px] leading-relaxed text-[var(--fg)]">{code}</pre>
        {steps && <div className="border-t border-[var(--border)] px-4 py-2.5 text-[11.5px] text-[var(--fg-secondary)]">{steps}</div>}
      </div>

      {/* Setup guide (adapts to the selected client) */}
      <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
        <div className="mb-3 text-[12.5px] font-semibold text-[var(--fg)]">{g.title}</div>
        <ol className="space-y-2.5">
          {g.steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-[var(--fg-secondary)]">
              <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[var(--green-bg)] text-[10.5px] font-semibold text-teal">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        {g.note && <p className="mt-3 border-t border-[var(--border)] pt-2.5 text-[11.5px] leading-relaxed text-[var(--fg-tertiary)]">{g.note}</p>}
      </div>

      <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5 text-[12px] leading-relaxed text-[var(--fg-secondary)]">
        <KeyRound size={15} className="mt-0.5 flex-shrink-0 text-[var(--fg-tertiary)]" />
        <span>
          Replace <code className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5 font-mono text-[11px] text-[var(--fg)]">{KEY_VAR}</code> with your key —
          create one under <a className="font-medium text-teal underline underline-offset-2" href="/dashboard/keys">Dashboard → API Keys</a>, then copy it.
        </span>
      </div>

      <p className="mt-3 text-center text-[11px] text-[var(--fg-tertiary)]">
        Endpoint <code className="font-mono text-[var(--fg-secondary)]">{endpoint}</code> · Streamable HTTP · Bearer or ?key= auth
      </p>
    </div>
  )
}
