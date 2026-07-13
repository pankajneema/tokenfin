'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const log = (m) => process.stdout.write(m + '\n')

async function remove() {
  const dir = path.join(os.homedir(), '.claude')
  const recPath = path.join(dir, 'tokenfin-record-usage.js')
  const cfgPath = path.join(dir, 'tokenfin-hook.json')
  const settingsPath = path.join(dir, 'settings.json')

  // 1. drop the Stop hook from settings.json (backup first)
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8')
    fs.copyFileSync(settingsPath, settingsPath + '.bak-tokenfin')
    const s = JSON.parse(raw)
    // match quoted (current) and unquoted (pre-0.1.1) hook commands
    const isOurs = (h) => typeof h.command === 'string' && h.command.includes('tokenfin-record-usage.js')
    if (s.hooks && Array.isArray(s.hooks.Stop)) {
      s.hooks.Stop = s.hooks.Stop
        .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !isOurs(h)) }))
        .filter(g => (g.hooks || []).length > 0)
      if (s.hooks.Stop.length === 0) delete s.hooks.Stop
      fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2) + '\n')
      log('✔ removed Stop hook from settings.json')
    }
  } catch { log('· no Stop hook to remove') }

  // 2. delete the local files
  for (const p of [recPath, cfgPath]) {
    try { fs.unlinkSync(p); log('✔ deleted ' + p) } catch {}
  }

  // 3. unregister the MCP server
  const r = spawnSync('claude', ['mcp', 'remove', 'tokenfin', '-s', 'user'], { stdio: 'ignore', shell: process.platform === 'win32' })
  log(r.status === 0 ? '✔ removed tokenfin MCP server' : '· MCP server was not registered')

  log('')
  log('Removed. Restart Claude Code to apply.')
}

module.exports = { remove }
