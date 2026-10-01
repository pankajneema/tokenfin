#!/usr/bin/env node
'use strict'

// TokenFin session hook for Claude Code (SessionStart / SessionEnd).
//
// SELF-CONTAINED ON PURPOSE (node builtins only): `tokenfin setup` copies this
// exact file to ~/.tokenfin/hooks/session.js and registers it as a command
// hook, so a session start never pays for an `npx` resolve.
//
// Contract with Claude Code:
//   • reads the hook JSON from stdin (session_id, cwd, hook_event_name,
//     source | reason, transcript_path) — the transcript is NEVER read or sent;
//   • prints NOTHING (SessionStart stdout is injected into Claude's context);
//   • always exits 0, within ~2 s, whatever happens (never blocks a session).
//
// Sends {session_id, event, agent, cwd, git_branch, repo, hostname,
// agent_version, start_source?, end_reason?, at} to {appUrl}/api/v1/sessions/meta
// with this device's ingest key from ~/.tokenfin/config.json.

const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const https = require('https')
const { execFileSync } = require('child_process')

const HARD_DEADLINE_MS = 1900
const quit = () => { try { process.exit(0) } catch { /* ignore */ } }

const tfDir = () => path.join(os.homedir(), '.tokenfin')
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }

function readStdin(ms) {
  return new Promise((resolve) => {
    let buf = ''
    const t = setTimeout(() => resolve(buf), ms)
    try {
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', (c) => { buf += c; if (buf.length > 1e6) { clearTimeout(t); resolve(buf) } })
      process.stdin.on('end', () => { clearTimeout(t); resolve(buf) })
      process.stdin.on('error', () => { clearTimeout(t); resolve(buf) })
    } catch { clearTimeout(t); resolve(buf) }
  })
}

function git(cwd, args) {
  try {
    const out = execFileSync('git', ['-C', cwd].concat(args), { timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', windowsHide: true })
    return String(out).trim() || null
  } catch { return null }
}

// Never send credentials embedded in a remote URL (https://user:token@host/…).
function cleanRemote(u) {
  if (!u) return null
  return String(u).replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]+@/i, '$1').slice(0, 500)
}

function post(url, key, body, timeoutMs) {
  return new Promise((resolve) => {
    let u
    try { u = new URL(url) } catch { return resolve(false) }
    const data = JSON.stringify(body)
    const mod = u.protocol === 'http:' ? http : https
    const req = mod.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Authorization: 'Bearer ' + key },
    }, (res) => { res.resume(); res.on('end', () => resolve(true)) })
    req.on('error', () => resolve(false))
    req.setTimeout(timeoutMs, () => { try { req.destroy() } catch {} ; resolve(false) })
    req.write(data)
    req.end()
  })
}

async function main() {
  if (process.env.TOKENFIN_SESSION_HOOK === '0') return
  const cfg = readJson(path.join(tfDir(), 'config.json')) || {}
  const key = String(cfg.key || cfg.read_key || '').trim()
  const appUrl = String(cfg.appUrl || '').replace(/\/$/, '')
  if (!key || !/^https?:\/\//.test(appUrl)) return

  let input = {}
  try { input = JSON.parse(await readStdin(500)) || {} } catch { input = {} }
  const sessionId = typeof input.session_id === 'string' ? input.session_id.slice(0, 200) : ''
  if (!sessionId) return
  const event = input.hook_event_name === 'SessionEnd' ? 'end' : 'start'
  const cwd = typeof input.cwd === 'string' ? input.cwd : null

  let branch = null, repo = null
  if (cwd && fs.existsSync(cwd)) {
    // symbolic-ref works on a fresh repo too; detached HEAD → short sha.
    branch = git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']) || git(cwd, ['rev-parse', '--short', 'HEAD'])
    repo = cleanRemote(git(cwd, ['remote', 'get-url', 'origin']))
  }
  // agent version cached by `tokenfin config push` (never spawn claude here).
  const state = readJson(path.join(tfDir(), 'agent-state.json')) || {}
  const version = state.versions && state.versions.claude_code ? String(state.versions.claude_code.v || '') || null : null

  const body = {
    session_id: sessionId, event, agent: 'claude_code', cwd, git_branch: branch, repo,
    hostname: os.hostname(), agent_version: version, at: new Date().toISOString(),
  }
  if (event === 'start' && typeof input.source === 'string') body.start_source = input.source.slice(0, 40)
  if (event === 'end' && typeof input.reason === 'string') body.end_reason = input.reason.slice(0, 40)
  await post(appUrl + '/api/v1/sessions/meta', key, body, 1200)
}

module.exports = { cleanRemote }

if (require.main === module) {
  // Hard stop: whatever happens, exit 0 before Claude Code's hook timeout.
  setTimeout(quit, HARD_DEADLINE_MS)
  process.on('uncaughtException', quit)
  process.on('unhandledRejection', quit)
  main().then(quit, quit)
}
