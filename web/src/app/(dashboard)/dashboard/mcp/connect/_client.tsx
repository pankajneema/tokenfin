'use client'

import { useState } from 'react'
import { Puzzle, Copy, Check, KeyRound, Terminal, MessageSquareText, FileJson, Sparkles } from 'lucide-react'

// The token in every snippet is a placeholder — paste your own key in its place.
const KEY_VAR = '<YOUR_TOKENFIN_KEY>'

type Mode = 'cli' | 'bridge' | 'remote' | 'prompt'
interface Tool { id: string; name: string; file: string; mode: Mode; icon: React.ElementType }

const TOOLS: Tool[] = [
  { id: 'universal', name: 'Universal prompt', file: 'paste into any AI tool', mode: 'prompt',  icon: Sparkles },
  { id: 'claudecode', name: 'Claude Code',     file: 'run in your terminal',   mode: 'cli',     icon: Terminal },
  { id: 'claude',     name: 'Claude Desktop',  file: '~/Library/Application Support/Claude/claude_desktop_config.json', mode: 'bridge', icon: MessageSquareText },
  { id: 'cursor',     name: 'Cursor',          file: '~/.cursor/mcp.json',      mode: 'remote',  icon: FileJson },
  { id: 'vscode',     name: 'VS Code / Cline', file: '.vscode/mcp.json',        mode: 'remote',  icon: FileJson },
  { id: 'generic',    name: 'Other (generic)', file: 'your MCP config',         mode: 'remote',  icon: FileJson },
]

function snippet(tool: Tool, url: string): string {
  const remote = JSON.stringify({ mcpServers: { tokenfin: { type: 'http', url, headers: { Authorization: `Bearer ${KEY_VAR}` } } } }, null, 2)
  const bridge = JSON.stringify({ mcpServers: { tokenfin: { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', `Authorization: Bearer ${KEY_VAR}`] } } }, null, 2)
  const cli = `claude mcp add --transport http tokenfin ${url} \\\n  --header "Authorization: Bearer ${KEY_VAR}"`
  const prompt =
`Add an MCP server to my setup and connect it.

  name:      tokenfin
  transport: Streamable HTTP
  url:       ${url}
  auth:      header "Authorization: Bearer ${KEY_VAR}"

If I use Claude Code, run:
  claude mcp add --transport http tokenfin ${url} --header "Authorization: Bearer ${KEY_VAR}"

Otherwise add this to my client's mcpServers config file:
${remote}

Then verify it's connected and list its tools.`

  switch (tool.mode) {
    case 'cli': return cli
    case 'bridge': return bridge
    case 'prompt': return prompt
    default: return remote
  }
}

export function McpConnectClient({ endpoint }: { endpoint: string }) {
  const [toolId, setToolId] = useState('universal')
  const [copied, setCopied] = useState(false)
  const tool = TOOLS.find(t => t.id === toolId)!
  const code = snippet(tool, endpoint)

  const copy = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000) }

  return (
    <div className="mx-auto max-w-2xl">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--green-bg)]"><Puzzle size={22} className="text-teal" /></div>
        <div>
          <h1 className="text-[20px] font-bold tracking-tight text-[var(--fg)]">Connect via MCP</h1>
          <p className="text-[13px] leading-snug text-[var(--fg-secondary)]">One connection — analytics, token saving, and usage/prompt auto-sync. Pick your tool, paste, done.</p>
        </div>
      </div>

      {/* Tool pills */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TOOLS.map(t => {
          const active = t.id === toolId
          const Icon = t.icon
          return (
            <button key={t.id} onClick={() => setToolId(t.id)}
              className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${active ? 'border-teal bg-[var(--green-bg)] text-teal' : 'border-[var(--border)] text-[var(--fg-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--fg)]'}`}>
              <Icon size={13} /> {t.name}
            </button>
          )
        })}
      </div>

      {/* Snippet card */}
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
          <div className="flex items-center gap-2 text-[12px]">
            <tool.icon size={14} className="text-[var(--fg-tertiary)]" />
            <span className="font-medium text-[var(--fg)]">{tool.name}</span>
            <span className="text-[var(--fg-tertiary)]">· {tool.file}</span>
          </div>
          <button onClick={copy} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)]">
            {copied ? <><Check size={12} className="text-teal" /> Copied</> : <><Copy size={12} /> Copy</>}
          </button>
        </div>
        <pre className="overflow-x-auto whitespace-pre px-4 py-3.5 font-mono text-[11.5px] leading-relaxed text-[var(--fg)]">{code}</pre>
      </div>

      {/* Key hint */}
      <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5 text-[12px] leading-relaxed text-[var(--fg-secondary)]">
        <KeyRound size={15} className="mt-0.5 flex-shrink-0 text-[var(--fg-tertiary)]" />
        <span>
          Replace <code className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5 font-mono text-[11px] text-[var(--fg)]">{KEY_VAR}</code> with your API key —
          create one under <a className="font-medium text-teal underline underline-offset-2" href="/dashboard/keys">Dashboard → API Keys</a> (shown once).
          {tool.mode === 'prompt' && ' The universal prompt makes any AI tool add and connect the server for you.'}
        </span>
      </div>

      <p className="mt-3 text-center text-[11px] text-[var(--fg-tertiary)]">
        Endpoint <code className="font-mono text-[var(--fg-secondary)]">{endpoint}</code> · Streamable HTTP · Bearer auth
      </p>
    </div>
  )
}
