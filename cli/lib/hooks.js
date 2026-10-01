'use strict'

// Claude Code hooks helpers:
//  • TokenFin session hooks (SessionStart + SessionEnd → ~/.tokenfin/hooks/session.js)
//    installed by `setup` (opt out: --no-session-hooks), removed by `remove`,
//    checked by `doctor`;
//  • a stable per-hook id + flat index for the dashboard's Hooks tab;
//  • the hook operations `config pull` may apply (enable / disable / delete an
//    existing hook, add a fixed TokenFin template). Disabled hooks are parked
//    in ~/.tokenfin/disabled-hooks.json so they can be re-enabled.
// Settings objects are edited in memory; callers write them atomically.

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { writeFileAtomic, writeJsonAtomic } = require('./fsx')

const SESSION_EVENTS = ['SessionStart', 'SessionEnd']
const SESSION_TIMEOUT_S = 5
const sessionScriptPath = () => path.join(os.homedir(), '.tokenfin', 'hooks', 'session.js')
const sessionScriptSource = () => path.join(__dirname, 'session-hook.js')
const sessionCommand = () => 'node "' + sessionScriptPath().replace(/\\/g, '/') + '"'
const SESSION_RE = /\.tokenfin[\\/]+hooks[\\/]+session\.js/
const isSessionHook = (h) => !!(h && typeof h.command === 'string' && SESSION_RE.test(h.command))
const isTokenfinHook = (h) => !!(h && typeof h.command === 'string' && /\.tokenfin[\\/]/.test(h.command))
const disabledPath = () => path.join(os.homedir(), '.tokenfin', 'disabled-hooks.json')

function installSessionScript() {
  const src = fs.readFileSync(sessionScriptSource())
  let cur = null
  try { cur = fs.readFileSync(sessionScriptPath()) } catch {}
  if (!cur || !cur.equals(src)) writeFileAtomic(sessionScriptPath(), src)
}

// Remove hooks matching `pred` from settings.hooks; drops empty groups/events.
function stripHooks(settings, pred) {
  let removed = 0
  const hooks = settings && settings.hooks
  if (!hooks || typeof hooks !== 'object') return removed
  for (const ev of Object.keys(hooks)) {
    if (!Array.isArray(hooks[ev])) continue
    const next = []
    for (const g of hooks[ev]) {
      if (g && typeof g.command === 'string') { if (pred(g, ev, '')) { removed++; continue } next.push(g); continue }
      if (g && Array.isArray(g.hooks)) {
        const kept = g.hooks.filter((h) => { if (pred(h, ev, g.matcher || '')) { removed++; return false } return true })
        if (kept.length === 0 && g.hooks.length > 0) continue
        next.push(kept.length === g.hooks.length ? g : Object.assign({}, g, { hooks: kept }))
      } else next.push(g)
    }
    if (next.length) hooks[ev] = next
    else delete hooks[ev]
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks
  return removed
}

const stripSessionHooks = (settings) => stripHooks(settings, isSessionHook)

function hasSessionHooks(settings) {
  const hooks = (settings && settings.hooks) || {}
  return SESSION_EVENTS.every((ev) => Array.isArray(hooks[ev]) && hooks[ev].some((g) => g && Array.isArray(g.hooks) && g.hooks.some(isSessionHook)))
}

// Idempotent: replaces any existing TokenFin session hook entries.
function addSessionHooks(settings) {
  stripSessionHooks(settings)
  settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {}
  for (const ev of SESSION_EVENTS) {
    const list = Array.isArray(settings.hooks[ev]) ? settings.hooks[ev] : []
    list.push({ hooks: [{ type: 'command', command: sessionCommand(), timeout: SESSION_TIMEOUT_S }] })
    settings.hooks[ev] = list
  }
  return settings
}

// ── ids + index ───────────────────────────────────────────────────────────────
const hookId = (event, matcher, hook) => crypto.createHash('sha256')
  .update(event + '\0' + (matcher || '') + '\0' + String((hook && (hook.command || hook.prompt)) || JSON.stringify(hook || {})))
  .digest('hex').slice(0, 12)

function eachHook(settings, fn) {
  const hooks = (settings && settings.hooks) || {}
  for (const ev of Object.keys(hooks)) {
    if (!Array.isArray(hooks[ev])) continue
    for (const g of hooks[ev]) {
      if (g && typeof g.command === 'string') fn(ev, '', g)
      else if (g && Array.isArray(g.hooks)) for (const h of g.hooks) fn(ev, g.matcher || '', h)
    }
  }
}

function readDisabled() {
  try { const j = JSON.parse(fs.readFileSync(disabledPath(), 'utf8')); return Array.isArray(j) ? j : [] } catch { return [] }
}
function writeDisabled(list) {
  if (!list.length) { try { fs.unlinkSync(disabledPath()) } catch {} ; return }
  writeJsonAtomic(disabledPath(), list, { mode: 0o600 })
}

// Flat list for the snapshot. Commands are RAW here — the caller redacts.
function hooksIndex(settings, disabled) {
  const out = []
  eachHook(settings, (ev, matcher, h) => out.push({
    id: hookId(ev, matcher, h), event: ev, matcher, type: h.type || 'command',
    command: String(h.command || h.prompt || ''), timeout: typeof h.timeout === 'number' ? h.timeout : null,
    disabled: false, tokenfin: isTokenfinHook(h),
  }))
  for (const d of disabled || []) {
    if (!d || !d.hook) continue
    out.push({ id: d.id, event: d.event, matcher: d.matcher || '', type: d.hook.type || 'command',
      command: String(d.hook.command || d.hook.prompt || ''), timeout: typeof d.hook.timeout === 'number' ? d.hook.timeout : null,
      disabled: true, tokenfin: isTokenfinHook(d.hook) })
  }
  return out
}

// Apply hook ops to `settings` (in memory) and the parked list.
// Returns { settings, disabled, notes: [..human lines..], sessionScript: bool }.
// Throws on an unknown id or op — nothing is written in that case.
function applyHookOps(settings, disabledIn, ops) {
  let disabled = disabledIn.slice()
  const notes = []
  let sessionScript = false
  for (const o of ops) {
    if (o.op === 'add_template') {
      if (o.template !== 'tokenfin-session') throw new Error('unknown hook template ' + o.template)
      addSessionHooks(settings); sessionScript = true
      notes.push('add TokenFin session hooks (SessionStart + SessionEnd → ' + sessionCommand() + ')')
      continue
    }
    if (o.op === 'disable' || o.op === 'delete') {
      let found = null
      const removed = stripHooks(settings, (h, ev, matcher) => {
        if (!found && hookId(ev, matcher, h) === o.id) { found = { event: ev, matcher, hook: h }; return true }
        return false
      })
      if (removed) {
        if (o.op === 'disable') disabled.push({ id: o.id, event: found.event, matcher: found.matcher, hook: found.hook })
        notes.push(o.op + ' hook ' + o.id + ' (' + found.event + (found.matcher ? ' ' + found.matcher : '') + ')')
        continue
      }
      const parked = disabled.find((d) => d.id === o.id)
      if (parked && o.op === 'delete') { disabled = disabled.filter((d) => d.id !== o.id); notes.push('delete disabled hook ' + o.id); continue }
      if (parked && o.op === 'disable') { notes.push('hook ' + o.id + ' is already disabled'); continue }
      throw new Error('hook ' + o.id + ' not found in settings.json')
    }
    if (o.op === 'enable') {
      const parked = disabled.find((d) => d.id === o.id)
      if (!parked) {
        let live = false
        eachHook(settings, (ev, m, h) => { if (hookId(ev, m, h) === o.id) live = true })
        if (live) { notes.push('hook ' + o.id + ' is already enabled'); continue }
        throw new Error('disabled hook ' + o.id + ' not found')
      }
      settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {}
      const list = Array.isArray(settings.hooks[parked.event]) ? settings.hooks[parked.event] : []
      const group = list.find((g) => g && Array.isArray(g.hooks) && (g.matcher || '') === (parked.matcher || ''))
      if (group) group.hooks.push(parked.hook)
      else list.push(Object.assign(parked.matcher ? { matcher: parked.matcher } : {}, { hooks: [parked.hook] }))
      settings.hooks[parked.event] = list
      disabled = disabled.filter((d) => d.id !== o.id)
      notes.push('enable hook ' + o.id + ' (' + parked.event + (parked.matcher ? ' ' + parked.matcher : '') + ')')
      continue
    }
    throw new Error('unsupported hook op ' + o.op)
  }
  return { settings, disabled, notes, sessionScript }
}

module.exports = {
  SESSION_EVENTS, sessionScriptPath, sessionScriptSource, sessionCommand, isSessionHook, installSessionScript,
  stripHooks, stripSessionHooks, hasSessionHooks, addSessionHooks,
  hookId, eachHook, hooksIndex, readDisabled, writeDisabled, disabledPath, applyHookOps,
}
