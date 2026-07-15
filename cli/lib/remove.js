'use strict'

// `tokenfin remove` — full, clean uninstall. Strips the OTel env block from
// ~/.claude/settings.json (backup first) and unregisters the MCP server.

const fs = require('fs')
const { spawnSync } = require('child_process')
const {
  MANAGED_KEYS, readClaudeSettings, writeClaudeSettings, backupClaudeSettings, claudeSettingsPath,
  codexConfigPath, stripCodexBlock, geminiSettingsPath, readGeminiSettings, writeGeminiSettings,
} = require('./otel')

const log = (m) => process.stdout.write(m + '\n')

async function remove() {
  // 1. Claude Code — strip our env keys from settings.json
  try {
    const p = claudeSettingsPath()
    if (!fs.existsSync(p)) {
      log('· ~/.claude/settings.json not found')
    } else {
      backupClaudeSettings()
      const s = readClaudeSettings()
      if (s.env) {
        let removed = 0
        for (const k of MANAGED_KEYS) if (k in s.env) { delete s.env[k]; removed++ }
        if (Object.keys(s.env).length === 0) delete s.env
        writeClaudeSettings(s)
        log(removed ? '✔ Claude Code — removed OTel env from settings.json' : '· Claude Code — nothing to remove')
      } else {
        log('· Claude Code — no env block')
      }
    }
  } catch (e) { log('· Claude Code — could not edit settings.json: ' + e.message) }

  // 2. Codex — strip the managed [otel] block
  try {
    const p = codexConfigPath()
    if (fs.existsSync(p)) {
      const { text, removed } = stripCodexBlock(fs.readFileSync(p, 'utf8'))
      if (removed) { fs.writeFileSync(p, text); log('✔ Codex CLI — removed [otel] block from config.toml') }
      else log('· Codex CLI — no TokenFin block')
    }
  } catch (e) { log('· Codex CLI — could not edit config.toml: ' + e.message) }

  // 3. Gemini — drop the telemetry block
  try {
    const p = geminiSettingsPath()
    if (fs.existsSync(p)) {
      const s = readGeminiSettings()
      if (s.telemetry) { delete s.telemetry; writeGeminiSettings(s); log('✔ Gemini CLI — removed telemetry from settings.json') }
      else log('· Gemini CLI — no telemetry block')
    }
  } catch (e) { log('· Gemini CLI — could not edit settings.json: ' + e.message) }

  // 4. unregister the read-only MCP server
  const r = spawnSync('claude', ['mcp', 'remove', 'tokenfin', '-s', 'user'], { stdio: 'ignore', shell: process.platform === 'win32' })
  log(r.status === 0 ? '✔ removed tokenfin MCP server' : '· MCP server was not registered')

  log('')
  log('Removed. Restart your agents to apply.')
}

module.exports = { remove }
