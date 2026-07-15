#!/usr/bin/env node
'use strict'

const pkg = require('../package.json')
const { setup } = require('../lib/setup')
const { status } = require('../lib/status')
const { doctor } = require('../lib/doctor')
const { remove } = require('../lib/remove')
const { runLogin } = require('../lib/login')

function parseArgs(argv) {
  const out = { _: [], flags: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--key' || a === '-k') out.flags.key = argv[++i]
    else if (a === '--url' || a === '-u') out.flags.url = argv[++i]
    else if (a === '--app-url' || a === '-a') out.flags.appUrl = argv[++i]
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

const HELP = `tokenfin — connect your coding agents to TokenFin (LLM cost tracking)

Usage:
  npx tokenfin <command> [options]

Commands:
  login      Open a browser, approve, and store an ingest key (~/.tokenfin/config.json).
  setup      Point Claude Code's native OpenTelemetry at TokenFin, then wait for the
             first real event. Writes an env block to ~/.claude/settings.json.
  status     Show whether Claude Code is configured and events are flowing.
  doctor     Diagnose why events might not be arriving, and how to fix it.
  remove     Fully undo setup (strip the env block, unregister the MCP server).

Options:
  -k, --key <key>       Ingest key (or TOKENFIN_KEY). Skips browser login.
  -a, --app-url <url>   TokenFin web app origin (or TOKENFIN_APP_URL).
  -y, --yes             Non-interactive; never prompt to open a browser.
  -h, --help            Show help.
  -v, --version         Print version.

How it works:
  Claude Code, Codex, and Gemini ship native OpenTelemetry. TokenFin is an OTLP
  receiver — no proxy in your request path, no provider keys held, no hooks.
  Usage is captured from each agent's own telemetry and shown on your dashboard.`

async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2))
  if (flags.version) { console.log(pkg.version); return }
  const cmd = _[0] || (flags.help ? 'help' : 'help')
  switch (cmd) {
    case 'login': case 'auth':          await runLogin(flags); break
    case 'setup': case 'init': case 'start': await setup(flags); break
    case 'status':                      await status(flags); break
    case 'doctor':                      await doctor(flags); break
    case 'remove': case 'uninstall':    await remove(); break
    case 'help':                        console.log(HELP); break
    default:
      console.error(`tokenfin: unknown command "${cmd}"\n`)
      console.log(HELP)
      process.exit(1)
  }
}

main().catch((e) => { console.error('tokenfin: ' + ((e && e.message) || e)); process.exit(1) })
