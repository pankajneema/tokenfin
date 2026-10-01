#!/usr/bin/env node
'use strict'

const pkg = require('../package.json')

function parseArgs(argv) {
  const out = { _: [], flags: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--key' || a === '-k') out.flags.key = argv[++i]
    else if (a === '--read-key') out.flags.readKey = argv[++i]
    else if (a === '--url' || a === '-u') out.flags.url = argv[++i]
    else if (a === '--app-url' || a === '-a') out.flags.appUrl = argv[++i]
    else if (a === '--yes' || a === '-y') out.flags.yes = true
    else if (a === '--device') out.flags.device = true
    else if (a === '--no-prompts') out.flags.prompts = false
    else if (a === '--prompts') out.flags.prompts = true
    else if (a === '--statusline') out.flags.statusline = true
    else if (a === '--no-wait') out.flags.wait = false
    else if (a === '--no-mcp') out.flags.mcp = false
    else if (a === '--no-session-hooks') out.flags.sessionHooks = false
    else if (a === '--session-hooks') out.flags.sessionHooks = true
    else if (a === '--no-revoke') out.flags.revoke = false
    else if (a === '--json') out.flags.json = true
    else if (a === '--dry-run') out.flags.dryRun = true
    else if (a === '--help' || a === '-h') out.flags.help = true
    else if (a === '--version' || a === '-v' || a === '-V') out.flags.version = true
    else if (a.startsWith('--key=')) out.flags.key = a.slice(6)
    else if (a.startsWith('--read-key=')) out.flags.readKey = a.slice(11)
    else if (a.startsWith('--url=')) out.flags.url = a.slice(6)
    else if (a.startsWith('--app-url=')) out.flags.appUrl = a.slice(10)
    else out._.push(a)
  }
  return out
}

const HELP = `tokenfin ${pkg.version} — connect your coding agents to TokenFin (LLM cost tracking)

Usage:
  npx tokenfin@latest <command> [options]

Commands:
  login       Sign in (browser) and store this device's keys in ~/.tokenfin/config.json.
              Re-points existing agent configs at the new key.
  login --device
              Same, for SSH / devcontainers: prints a code to approve in any browser.
  setup       Point every installed agent's native OpenTelemetry at TokenFin
              (Claude Code, Codex CLI, Gemini CLI, OpenCode), then wait for the
              first real event.
  status      Is Claude Code configured, and are events flowing?
  doctor      Diagnose why events might not be arriving (incl. revoked keys).
  budget      Today / month-to-date spend and your tightest budget.
  budgets apply <file> [--dry-run]
              Budgets-as-code: plan / apply limits + alerts from a YAML file
              (needs an admin-scoped key via --key or TOKENFIN_API_KEY).
  config push Upload a REDACTED snapshot of each agent's config (Dashboard → Agents).
              Secrets are removed on this machine before anything is sent.
  config pull [--yes]
              Review and apply config changes requested in the dashboard: shows
              the diff, asks, backs up the file, writes it, reports back.
  config show Print the redacted snapshot "config push" would send.
  statusline  One line for Claude Code's status bar (used by setup --statusline).
  remove      Fully undo setup, revoke this device's key, delete ~/.tokenfin.

Options:
  -k, --key <key>       Ingest key (or TOKENFIN_KEY). Skips browser login.
      --read-key <key>  Read key for status/doctor/budget/MCP (defaults to --key).
  -a, --app-url <url>   TokenFin web app origin (or TOKENFIN_APP_URL).
      --no-prompts      setup: never send prompt text (token counts/cost only).
      --prompts         setup: re-enable prompt text capture.
      --statusline      setup: add the TokenFin budget line to Claude Code's
                        status bar (only if you don't already have a statusLine).
      --no-wait         setup: don't wait for the first event.
      --no-mcp          setup: don't register the read-only MCP server.
      --no-session-hooks
                        setup: don't add the Claude Code SessionStart/SessionEnd
                        hooks (session id, cwd, git branch → richer Sessions).
      --session-hooks   setup: re-enable them.
  -y, --yes             Non-interactive; never prompt or open a browser.
  -h, --help            Show help.
  -v, --version         Print version.

Privacy:
  By default Claude Code, Codex and Gemini also send the TEXT of each prompt so
  your workspace can see which prompts cost what. It expires after 90 days and
  your org admin can switch it off for everyone. Opt out: setup --no-prompts.

How it works:
  Claude Code, Codex, and Gemini ship native OpenTelemetry. TokenFin is an OTLP
  receiver — no proxy in your request path, no provider keys held, no hooks.`

async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2))
  if (flags.version) { console.log(pkg.version); return }
  const cmd = _[0] || 'help'
  if (flags.help && cmd !== 'help') { console.log(HELP); return }

  // statusline must be fast and quiet: no update check, no extra output.
  if (cmd === 'statusline') { await require('../lib/budget').statusline(); return }

  const { checkForUpdate, updateNotice } = require('../lib/update')
  const updateP = (cmd === 'help' || cmd === 'remove' || cmd === 'uninstall') ? Promise.resolve(null) : checkForUpdate(pkg.version, flags).catch(() => null)

  switch (cmd) {
    case 'login': case 'auth':               await require('../lib/login').runLogin(flags); break
    case 'setup': case 'init': case 'start': await require('../lib/setup').setup(flags); break
    case 'status':                           await require('../lib/status').status(flags); break
    case 'doctor': {
      const r = await require('../lib/doctor').doctor(flags)
      if (r && r.fails) process.exitCode = 1
      break
    }
    case 'budget':                           await require('../lib/budget').budget(flags); break
    case 'config':                           process.exitCode = await require('../lib/agentconfig').configCmd(_, flags); break
    case 'budgets':                          process.exitCode = await require('../lib/budgets').budgets(_, flags); break
    case 'remove': case 'uninstall':         await require('../lib/remove').remove(flags); break
    case 'help':                             console.log(HELP); break
    default:
      console.error(`tokenfin: unknown command "${cmd}"\n`)
      console.log(HELP)
      process.exit(1)
  }

  const latest = await updateP
  if (latest) process.stderr.write(updateNotice(pkg.version, latest))
}

main().catch((e) => { console.error('tokenfin: ' + ((e && e.message) || e)); process.exit(1) })
