'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const mark = (ok) => (ok ? '✔' : '✗')

async function status() {
  const dir = path.join(os.homedir(), '.claude')
  const cfgPath = path.join(dir, 'tokenfin-hook.json')
  const recPath = path.join(dir, 'tokenfin-record-usage.js')
  const settingsPath = path.join(dir, 'settings.json')

  let url = null
  try { url = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).url } catch {}

  const cfgOk = fs.existsSync(cfgPath)
  const recOk = fs.existsSync(recPath)

  let hookOk = false
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    // match quoted (current) and unquoted (pre-0.1.1) hook commands
    hookOk = (s.hooks && s.hooks.Stop || []).some(g => (g.hooks || []).some(h => typeof h.command === 'string' && h.command.includes('tokenfin-record-usage.js')))
  } catch {}

  let mcpOk = false
  const r = spawnSync('claude', ['mcp', 'list'], { encoding: 'utf8', shell: process.platform === 'win32' })
  if (!r.error && r.stdout) mcpOk = /tokenfin/i.test(r.stdout)

  process.stdout.write([
    'TokenFin — Claude Code setup status',
    `  ${mark(cfgOk)} hook config       ${cfgPath}`,
    `  ${mark(recOk)} recorder script   ${recPath}`,
    `  ${mark(hookOk)} Stop hook         settings.json`,
    `  ${mark(mcpOk)} MCP server        ${url || 'tokenfin'}`,
    '',
    (cfgOk && recOk && hookOk && mcpOk)
      ? 'All set. Usage auto-records after each Claude Code turn.'
      : 'Not fully configured. Run: npx tokenfin setup --key <tfk_prod_...>',
    '',
  ].join('\n'))
}

module.exports = { status }
