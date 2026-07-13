'use strict'

// Tool-aware MCP configuration. Each entry knows where its client reads MCP
// server config and in what shape, so `tokenfin setup --tool <id>` writes the
// right file for ANY supported tool — not just Claude Code.
//
// Auto-record capability differs by tool (this is a hard platform constraint):
//   - claudecode → deterministic Stop hook (handled in setup.js)
//   - others     → MCP `record_usage` tool is available, but recording is
//                  best-effort unless the tool is pointed at the recorder-proxy.
// We surface this honestly rather than over-promising.

const fs = require('fs')
const os = require('os')
const path = require('path')

const bearer = (key) => `Bearer ${key}`
const httpServer   = (url, key) => ({ type: 'http', url, headers: { Authorization: bearer(key) } })
const bridgeServer = (url, key) => ({ command: 'npx', args: ['-y', 'mcp-remote', url, '--header', `Authorization: ${bearer(key)}`] })

function claudeDesktopPath() {
  const home = os.homedir()
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  if (process.platform === 'win32')  return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
  return path.join(home, '.config', 'Claude', 'claude_desktop_config.json')
}

// id → { name, ...writer spec }. `serversKey` is the JSON top-level map key
// (Cursor/Windsurf/Desktop use "mcpServers"; VS Code uses "servers").
const TOOLS = {
  cursor:      { name: 'Cursor',           kind: 'json', file: () => path.join(os.homedir(), '.cursor', 'mcp.json'),                       serversKey: 'mcpServers', make: httpServer,   after: 'Reload Cursor (Cmd/Ctrl+Shift+P → “Reload Window”).' },
  windsurf:    { name: 'Windsurf',         kind: 'json', file: () => path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json'),   serversKey: 'mcpServers', make: bridgeServer, after: 'Refresh MCP servers in Windsurf.' },
  vscode:      { name: 'VS Code (native MCP)', kind: 'json', file: () => path.join(process.cwd(), '.vscode', 'mcp.json'),                   serversKey: 'servers',    make: httpServer,   after: 'Reload VS Code. Note: this is workspace-scoped to the current folder.' },
  claudedesk:  { name: 'Claude Desktop',   kind: 'json', file: claudeDesktopPath,                                                          serversKey: 'mcpServers', make: bridgeServer, after: 'Fully quit & reopen Claude Desktop.' },
  codex:       { name: 'Codex',            kind: 'toml', file: () => path.join(os.homedir(), '.codex', 'config.toml'),                     after: 'Restart Codex.' },
  antigravity: { name: 'Antigravity',      kind: 'print', make: httpServer,                                                               after: 'Paste into Antigravity → MCP settings (mcp.json), then reload.' },
  generic:     { name: 'Any MCP client',   kind: 'print', make: httpServer,                                                               after: 'Paste into your client’s mcpServers config, then reload it.' },
}

function backup(file) { try { if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak-tokenfin') } catch {} }

function writeJson(file, serversKey, serverObj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let cfg = {}
  if (fs.existsSync(file)) {
    backup(file)
    try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {
      throw new Error(file + ' exists but is not valid JSON — fix it, then re-run.')
    }
  }
  cfg[serversKey] = cfg[serversKey] || {}
  cfg[serversKey].tokenfin = serverObj // merge — never clobber other servers
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n')
}

function writeToml(file, url, key) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const block = `[mcp_servers.tokenfin]\ncommand = "npx"\nargs = ["-y", "mcp-remote", "${url}", "--header", "Authorization: Bearer ${key}"]\n`
  let existing = ''
  if (fs.existsSync(file)) {
    backup(file)
    existing = fs.readFileSync(file, 'utf8')
    // Drop any prior tokenfin block so re-runs don't duplicate it.
    existing = existing.replace(/\n*\[mcp_servers\.tokenfin\][\s\S]*?(?=\n\[|\s*$)/, '')
  }
  fs.writeFileSync(file, (existing.trim() ? existing.trim() + '\n\n' : '') + block)
}

// Returns { name, file?, snippet?, after }. Throws on unknown id.
function configureTool(id, { url, key }) {
  const t = TOOLS[id]
  if (!t) throw new Error(`unknown tool "${id}". Supported: ${listIds().join(', ')}`)
  if (t.kind === 'json') { const file = t.file(); writeJson(file, t.serversKey, t.make(url, key)); return { name: t.name, file, after: t.after } }
  if (t.kind === 'toml') { const file = t.file(); writeToml(file, url, key);                        return { name: t.name, file, after: t.after } }
  // print
  const snippet = JSON.stringify({ mcpServers: { tokenfin: t.make(url, key) } }, null, 2)
  return { name: t.name, snippet, after: t.after }
}

function listIds() { return ['claudecode', ...Object.keys(TOOLS)] }
function displayName(id) { return id === 'claudecode' ? 'Claude Code' : (TOOLS[id]?.name || id) }

module.exports = { TOOLS, configureTool, listIds, displayName }
