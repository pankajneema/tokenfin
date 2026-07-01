'use client'

import { useState } from 'react'
import { Puzzle, Copy, Check, KeyRound } from 'lucide-react'

// The token in the config is a placeholder — paste your own key in its place.
const KEY_VAR = '<YOUR_TOKENFIN_KEY>'

const TOOLS = [
  { id: 'claude', name: 'Claude Desktop',  file: '~/Library/Application Support/Claude/claude_desktop_config.json', mode: 'bridge' },
  { id: 'cursor', name: 'Cursor',          file: '~/.cursor/mcp.json',  mode: 'remote' },
  { id: 'vscode', name: 'VS Code / Cline', file: '.vscode/mcp.json',     mode: 'remote' },
  { id: 'generic', name: 'Other (generic)', file: 'your MCP config',     mode: 'remote' },
] as const

// Ready-to-paste config per client. `remote` = native HTTP MCP; `bridge` =
// stdio clients via the mcp-remote adapter. Token is always a placeholder.
function configFor(toolId: string, url: string): string {
  const remote = {
    mcpServers: { tokenfin: { type: 'http', url, headers: { Authorization: `Bearer ${KEY_VAR}` } } },
  }
  const bridge = {
    mcpServers: { tokenfin: { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', `Authorization: Bearer ${KEY_VAR}`] } },
  }
  const tool = TOOLS.find(t => t.id === toolId)!
  return JSON.stringify(tool.mode === 'bridge' ? bridge : remote, null, 2)
}

export function McpConnectClient({ endpoint }: { endpoint: string }) {
  const [tool, setTool] = useState('claude')
  const [copied, setCopied] = useState(false)
  const selected = TOOLS.find(t => t.id === tool)!
  const config = configFor(tool, endpoint)

  const copy = () => { navigator.clipboard.writeText(config); setCopied(true); setTimeout(() => setCopied(false), 2000) }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--green-bg)]"><Puzzle size={20} className="text-teal" /></div>
        <div>
          <h1 className="text-[19px] font-bold text-[var(--fg)]">Connect via MCP</h1>
          <p className="text-[13px] text-[var(--fg-secondary)]">One connection for analytics, token saving, and usage/prompt auto-sync. Copy the config below and paste in your key.</p>
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
        <div>
          <label className="mb-1.5 block text-[12.5px] font-semibold text-[var(--fg)]">Client</label>
          <select value={tool} onChange={e => setTool(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12.5px] text-[var(--fg)] outline-none focus:border-[var(--border-strong)]">
            {TOOLS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-[12.5px] font-semibold text-[var(--fg)]">Config — paste into <code className="font-mono text-[11.5px]">{selected.file}</code></label>
            <button onClick={copy} className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--fg)] hover:bg-[var(--bg-hover)]">
              {copied ? <><Check size={11} className="text-teal" />Copied</> : <><Copy size={11} />Copy</>}
            </button>
          </div>
          <pre className="overflow-x-auto whitespace-pre rounded-xl bg-[var(--bg-tertiary)] p-3 font-mono text-[11.5px] leading-relaxed text-[var(--fg)]">{config}</pre>
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-[12px] text-[var(--fg-secondary)]">
          <KeyRound size={15} className="mt-0.5 flex-shrink-0 text-[var(--fg-tertiary)]" />
          <span>
            Replace <code className="font-mono text-[var(--fg)]">{KEY_VAR}</code> with your API key.
            Create one under <a className="text-teal underline" href="/dashboard/keys">Dashboard → API Keys</a> (shown once at creation), then restart {selected.name}.
          </span>
        </div>

        <p className="text-[11px] text-[var(--fg-tertiary)]">Endpoint: <code className="font-mono">{endpoint}</code> · Streamable HTTP · Bearer auth</p>
      </div>
    </div>
  )
}
