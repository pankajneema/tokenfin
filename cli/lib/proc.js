'use strict'

// Process helpers that never go through a shell.
//
// Why no shell: `shell: true` on Windows hands the command line to cmd.exe,
// which splits "Authorization: Bearer tfk_…" on spaces and treats & | ^ as
// operators — the MCP header got mangled and URLs with & were truncated. We
// pass argument arrays straight to the executable instead.
//
// Windows: npm-installed CLIs are .cmd shims that Node refuses to spawn
// without a shell (CVE-2024-27980). resolveCommand() finds the real target via
// `where`; if only a .cmd/.bat shim exists, callers get { shim: true } and
// fall back to printing the command for the user to run.

const { spawn, spawnSync } = require('child_process')

function resolveCommand(name) {
  if (process.platform !== 'win32') return { cmd: name, shim: false }
  const r = spawnSync('where', [name], { encoding: 'utf8' })
  if (r.error || r.status !== 0) return null
  const hits = String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  const exe = hits.find((h) => /\.exe$/i.test(h))
  if (exe) return { cmd: exe, shim: false }
  const shim = hits.find((h) => /\.(cmd|bat)$/i.test(h))
  return shim ? { cmd: shim, shim: true } : null
}

// Run without a shell. Returns spawnSync result, or { error } when unrunnable.
function run(name, args, opts = {}) {
  const r = resolveCommand(name)
  if (!r) return { error: new Error(name + ' not found'), status: null }
  if (r.shim) {
    // Only harmless, fixed args may go through cmd.exe (e.g. --version).
    if (!opts.allowShim) return { error: new Error('shim'), shim: true, status: null }
    return spawnSync(r.cmd, args, Object.assign({ stdio: 'ignore', shell: true }, opts.spawn))
  }
  return spawnSync(r.cmd, args, Object.assign({ stdio: 'ignore' }, opts.spawn))
}

function hasCmd(name) {
  const r = run(name, ['--version'], { allowShim: true })
  return !r.error && r.status === 0
}

// Open a URL in the default browser. win32: rundll32 url.dll,FileProtocolHandler
// takes the URL as ONE argv entry (no cmd.exe, so & in query strings survives).
function openBrowser(url) {
  const p = process.platform
  const cmd = p === 'darwin' ? 'open' : p === 'win32' ? 'rundll32' : 'xdg-open'
  const args = p === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
    return true
  } catch { return false }
}

module.exports = { resolveCommand, run, hasCmd, openBrowser }
