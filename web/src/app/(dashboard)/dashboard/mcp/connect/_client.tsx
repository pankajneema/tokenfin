'use client'

import { useState } from 'react'
import { Puzzle, Copy, Check, Loader2 } from 'lucide-react'
import type { SimpleRow } from './page'

const TOOLS = [
  { id: 'claude', name: 'Claude Desktop', file: '~/Library/Application Support/Claude/claude_desktop_config.json', mode: 'bridge' },
  { id: 'cursor', name: 'Cursor',          file: '~/.cursor/mcp.json',  mode: 'remote' },
  { id: 'vscode', name: 'VS Code / Cline', file: '.vscode/mcp.json',     mode: 'remote' },
  { id: 'generic', name: 'Other (generic)', file: 'mcp config',          mode: 'remote' },
] as const

// Build the correct config for each client.
//  - "remote": clients that natively support an HTTP MCP server with headers.
//  - "bridge": clients that only speak stdio → use the `mcp-remote` adapter,
//    the standard way to reach a remote bearer-auth server.
function configFor(toolId: string, url: string, rawKey: string): string {
  const remote = {
    mcpServers: { tokenfin: { type: 'http', url, headers: { Authorization: `Bearer ${rawKey}` } } },
  }
  const bridge = {
    mcpServers: { tokenfin: { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', `Authorization: Bearer ${rawKey}`] } },
  }
  const tool = TOOLS.find(t => t.id === toolId)!
  return JSON.stringify(tool.mode === 'bridge' ? bridge : remote, null, 2)
}

export function McpConnectClient({ orgId, userId, projects }: { orgId: string; userId: string; projects: SimpleRow[] }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [tool, setTool]   = useState('claude')
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')
  const [rawKey, setRawKey] = useState('')
  const [copied, setCopied] = useState('')

  const selected = TOOLS.find(t => t.id === tool)!
  const endpoint = (process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')) + '/api/mcp'

  async function connect() {
    setError(''); setRawKey('')
    if (!projectId) { setError('Pick a project'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/v1/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Least privilege: MCP keys are READ-ONLY — the server exposes no write tools.
        body: JSON.stringify({ org_id: orgId, project_id: projectId, env: 'production', scopes: ['read'], name: `MCP: ${selected.name}`, created_by: userId, user_id: userId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(typeof data.error === 'string' ? data.error : 'Failed to create key'); return }
      setRawKey(data.raw_key)
    } catch { setError('Network error') } finally { setBusy(false) }
  }

  function copy(text: string, tag: string) { navigator.clipboard.writeText(text); setCopied(tag); setTimeout(() => setCopied(''), 2000) }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--green-bg)]"><Puzzle size={20} className="text-teal" /></div>
        <div>
          <h1 className="text-[19px] font-bold text-[var(--fg)]">Connect an MCP client</h1>
          <p className="text-[13px] text-[var(--fg-secondary)]">Generate a key and copy-paste config — usage is tracked automatically.</p>
        </div>
      </div>

      <div className="space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-[var(--fg)]">Project</label>
            <select value={projectId} onChange={e => setProjectId(e.target.value)} className={selectCls}>
              {projects.length === 0 && <option value="">No projects</option>}
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-[var(--fg)]">Tool</label>
            <select value={tool} onChange={e => setTool(e.target.value)} className={selectCls}>
              {TOOLS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>

        {error && <p className="text-[12.5px] text-red-500">{error}</p>}

        {!rawKey ? (
          <button onClick={connect} disabled={busy || !projectId} className="btn-primary w-full justify-center disabled:opacity-60">
            {busy ? <><Loader2 size={15} className="animate-spin" /> Generating…</> : 'Generate key & config'}
          </button>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl bg-[var(--green-bg)] p-3 text-[12.5px] text-teal">
              ✓ Read-only key created. Copy the config into <code className="font-mono">{selected.file}</code>, then restart {selected.name}.
              The key is shown only once.
            </div>
            <div className="relative rounded-xl bg-[var(--bg-tertiary)] p-3">
              <button onClick={() => copy(configFor(tool, endpoint, rawKey), 'cfg')} className="absolute right-2 top-2 flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[11px] font-medium text-[var(--fg)] hover:bg-[var(--bg-hover)]">
                {copied === 'cfg' ? <><Check size={11} className="text-teal" />Copied</> : <><Copy size={11} />Copy</>}
              </button>
              <pre className="overflow-x-auto whitespace-pre font-mono text-[11px] leading-relaxed text-[var(--fg)]">{configFor(tool, endpoint, rawKey)}</pre>
            </div>
            <p className="text-[11px] text-[var(--fg-tertiary)]">Endpoint: <code className="font-mono">{endpoint}</code> · Streamable HTTP · Bearer auth · read-only</p>
            <button onClick={() => setRawKey('')} className="btn-secondary">Connect another</button>
          </div>
        )}
      </div>
    </div>
  )
}

const selectCls = 'w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12.5px] text-[var(--fg)] outline-none focus:border-[var(--border-strong)]'
