#!/usr/bin/env node
'use strict'

const pkg = require('../package.json')
const { setup } = require('../lib/setup')
const { status } = require('../lib/status')
const { remove } = require('../lib/remove')
const { runLogin } = require('../lib/login')
const { runProxy } = require('../lib/proxy')

function parseArgs(argv) {
  const out = { _: [], flags: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--key' || a === '-k') out.flags.key = argv[++i]
    else if (a === '--url' || a === '-u') out.flags.url = argv[++i]
    else if (a === '--app-url' || a === '-a') out.flags.appUrl = argv[++i]
    else if (a === '--tool' || a === '-t') out.flags.tool = argv[++i]
    else if (a.startsWith('--tool=')) out.flags.tool = a.slice(7)
    else if (a === '--port' || a === '-p') out.flags.port = argv[++i]
    else if (a.startsWith('--port=')) out.flags.port = a.slice(7)
    else if (a === '--upstream') out.flags.upstream = argv[++i]
    else if (a === '--yes' || a === '-y') out.flags.yes = true
    else if (a === '--help' || a === '-h') out.flags.help = true
    else if (a === '--version' || a === '-v' || a === '-V') out.flags.version = true
    else if (a.startsWith('--key=')) out.flags.key = a.slice(6)
    else if (a.startsWith('--url=')) out.flags.url = a.slice(6)
    else if (a.startsWith('--app-url=')) out.flags.appUrl = a.slice(10)
    else out._.push(a)
  }
  return out
}

const HELP = `tokenfin ${pkg.version} — auto-record your AI tool usage to your TokenFin dashboard.

Usage:
  npx tokenfin login                          Sign in via browser (creates a project key)
  npx tokenfin setup [--tool <id>]            Configure a tool (interactive picker if omitted)
  npx tokenfin proxy [--port 8788]            Run a local recorder-proxy — auto-records ANY tool
  npx tokenfin status                         Show what's currently configured
  npx tokenfin remove                         Undo — remove the hook and MCP server

Supported --tool ids:
  claudecode (default, auto-records) · cursor · windsurf · vscode · claudedesk · codex · antigravity · generic

Options:
  -k, --key <key>     TokenFin API key (or TOKENFIN_KEY). Skips browser login.
  -t, --tool <id>     Which client to configure (see list above). Interactive picker if omitted.
  -u, --url <url>     MCP endpoint (or TOKENFIN_URL). Default: https://tokenfin.curiousdevs.com/api/mcp
  -a, --app-url <url> TokenFin web app origin for login (or TOKENFIN_APP_URL). Derived from --url if omitted.
  -y, --yes           Non-interactive; never prompt or open a browser.
  -h, --help          Show this help.
  -v, --version       Print version.

login  → opens your browser, you approve, a project API key is created and stored (~/.tokenfin/config.json).
setup  → registers the tokenfin MCP server + installs the Claude Code auto-record hook (idempotent).
The MCP server alone is passive; the hook is what makes recording actually happen.`

async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2))
  if (flags.version) { console.log(pkg.version); return }
  const cmd = _[0] || (flags.help ? 'help' : 'help')
  switch (cmd) {
    case 'login': case 'auth': await runLogin(flags); break
    case 'setup': case 'init': case 'start': await setup(flags); break
    case 'proxy': runProxy(flags); break // long-running; records every LLM call
    case 'status': await status(); break
    case 'remove': case 'uninstall': await remove(); break
    case 'help': console.log(HELP); break
    default:
      console.error(`tokenfin: unknown command "${cmd}"\n`)
      console.log(HELP)
      process.exit(1)
  }
}

main().catch(e => { console.error('tokenfin: ' + ((e && e.message) || e)); process.exit(1) })
