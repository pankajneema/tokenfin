// TokenFin plugin for OpenCode — first-party usage capture.
//
// One usage event per COMPLETED assistant message, with everything OpenCode
// knows about it: model, provider, input / output / reasoning / cache-read /
// cache-write tokens, latency, session id, prompt id (the user message) and the
// full prompt text. Events are batched to POST {url}/api/v1/ingest/batch.
//
// Zero dependencies, global fetch only. It never throws into OpenCode: every
// hook is wrapped, failures are retried with backoff, and a missing key just
// logs once. The assistant message id is the idempotency key, so replays and
// retries never double count.
//
// Config (first match wins):
//   key: TOKENFIN_API_KEY, TOKENFIN_KEY, ~/.tokenfin/config.json `key`
//   url: TOKENFIN_URL, TOKENFIN_APP_URL, config.json `appUrl` or `url`
//   prompt text: off when TOKENFIN_PROMPTS=0 or config.json `prompts: false`
//
// Install: `npx tokenfin setup` copies this file to
// ~/.config/opencode/plugin/tokenfin.js (OpenCode loads every *.js there).

import { readFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'

const VERSION = '0.1.0'
const DEFAULT_URL = 'https://tokenfin.curiousdevs.com'
const FLUSH_MS = 5_000
const MAX_BATCH = 500
const MAX_QUEUE = 5_000
const MAX_BACKOFF_MS = 5 * 60_000
const MAX_ATTEMPTS = 12
/** A message with `finish` but no `time.completed` is sent after this long. */
const FINISH_GRACE_MS = 15_000

// ── pure helpers ────────────────────────────────────────────────────────────

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }

/** Bounded insertion-ordered set/map: forget the oldest past `max`. */
function bounded(map, max) {
  while (map.size > max) map.delete(map.keys().next().value)
}

/** Full text of a user message: its typed text parts, joined, untruncated. */
function promptTextOf(parts) {
  const text = (Array.isArray(parts) ? parts : []).filter((p) => p && p.type === 'text' && typeof p.text === 'string' && !p.ignored)
  const typed = text.filter((p) => !p.synthetic)
  const use = typed.length ? typed : text
  const joined = use.map((p) => p.text).join('\n')
  return joined.trim() ? joined : null
}

/** "git@github.com:acme/app.git" / "https://github.com/acme/app" → "acme/app". */
function repoFromRemote(remote) {
  const s = String(remote || '').trim()
  if (!s) return null
  const m = /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(s)
  return m ? m[1] : null
}

/** OpenCode's own session title, unless it's still the placeholder "New session - <date>". */
function sessionTitleOf(info) {
  const t = String((info && info.title) || '').trim()
  return t && !/^new session\b/i.test(t) ? t : null
}

function safeHostname() {
  try { return hostname() || null } catch { return null }
}

function isCompleted(info) {
  return !!(info && info.time && info.time.completed)
}

/**
 * One ingest event for a completed assistant message, or null when it used no
 * tokens (aborted before the first response). Cost basis: OpenCode reports $0
 * for subscription (OAuth) providers — that usage is "notional" (priced at API
 * rates server-side, never a bill); anything with a real cost is "metered".
 */
function buildEvent(info, extra = {}) {
  if (!info || info.role !== 'assistant' || !info.id) return null
  const t = info.tokens || {}
  const cache = t.cache || {}
  const input = num(t.input), output = num(t.output), reasoning = num(t.reasoning)
  const cacheRead = num(cache.read), cacheWrite = num(cache.write)
  const tokens = input + output + reasoning + cacheRead + cacheWrite
  if (tokens <= 0 || !info.modelID) return null
  const cost = Number(info.cost) || 0
  const created = Number(info.time && info.time.created) || Date.now()
  const completed = Number(info.time && info.time.completed) || null
  const ev = {
    model: info.modelID,
    provider: info.providerID || null,
    source: 'opencode',
    tool: 'opencode',
    input_tokens: input,
    output_tokens: output,
    reasoning_tokens: reasoning,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    latency_ms: completed && completed >= created ? completed - created : null,
    timestamp: new Date(created).toISOString(),
    session_id: info.sessionID || null,
    correlation_id: info.parentID || null,
    idempotency_key: info.id,
    cost_usd: cost,
    cost_basis: cost === 0 && tokens > 0 ? 'notional' : 'metered',
    metadata: {
      agent: info.mode || null,
      finish: info.finish || null,
      plugin: 'tokenfin-opencode@' + VERSION,
    },
  }
  if (extra.user_email) ev.user_email = extra.user_email
  if (extra.repo) ev.repo = extra.repo
  if (extra.prompt_text) ev.prompt_text = extra.prompt_text
  if (extra.session_title) ev.session_title = extra.session_title
  return ev
}

// ── config ──────────────────────────────────────────────────────────────────

function readConfig(env = process.env, home = homedir()) {
  let file = {}
  try { file = JSON.parse(readFileSync(join(home, '.tokenfin', 'config.json'), 'utf8')) || {} } catch { /* none */ }
  const key = String(env.TOKENFIN_API_KEY || env.TOKENFIN_KEY || file.key || '').trim()
  // config.json `url` is the MCP endpoint (…/api/mcp) in CLI-written configs.
  const rawUrl = String(env.TOKENFIN_URL || env.TOKENFIN_APP_URL || file.appUrl || file.url || DEFAULT_URL).trim()
  const url = rawUrl.replace(/\/+$/, '').replace(/\/api\/mcp$/, '').replace(/\/+$/, '')
  const prompts = !(env.TOKENFIN_PROMPTS === '0' || env.TOKENFIN_PROMPTS === 'false' || file.prompts === false)
  return { key, url, prompts }
}

// ── git identity (cached per directory) ─────────────────────────────────────

function git(args, cwd) {
  return new Promise((resolve) => {
    try {
      execFile('git', args, { cwd, timeout: 2_000, windowsHide: true }, (err, out) => resolve(err ? '' : String(out || '').trim()))
    } catch { resolve('') }
  })
}

async function defaultGitInfo(dir) {
  if (!dir) return {}
  const [email, remote, branch] = await Promise.all([
    git(['config', 'user.email'], dir), git(['remote', 'get-url', 'origin'], dir), git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)])
  return { user_email: email || null, repo: repoFromRemote(remote), branch: branch && branch !== 'HEAD' ? branch : null }
}

// ── tracker (all state; testable without OpenCode) ───────────────────────────

function createTracker(opts = {}) {
  const fetchImpl = opts.fetch || globalThis.fetch
  const now = opts.now || Date.now
  const log = opts.log || (() => {})
  const flushMs = opts.flushMs ?? FLUSH_MS
  const graceMs = opts.graceMs ?? FINISH_GRACE_MS
  const gitInfo = opts.gitInfo || defaultGitInfo
  const loadConfig = opts.config ? () => opts.config : () => readConfig()
  const defaultDir = opts.directory || null

  let cfg = loadConfig()
  let cfgAt = now()
  const logged = new Set()
  const once = (k, level, msg) => { if (!logged.has(k)) { logged.add(k); try { log(level, msg) } catch {} } }

  const prompts = new Map()     // user message id → full text (from chat.message)
  const partText = new Map()    // user message id → Map(part id → part) (from message.part.updated)
  const assistants = new Set()  // assistant message ids seen (their parts are not prompts)
  const promptUsed = new Set()  // prompt ids whose text was already attached
  const sent = new Set()        // assistant message ids already queued (dedupe)
  const tentative = new Map()   // id → { info, since } — finish set, no time.completed yet
  const titles = new Map()      // session id → OpenCode's session title (session.updated)
  const parentOf = new Map()    // assistant message id → user message id (the prompt)
  const metaSent = new Set()    // session ids whose context (directory, start) was queued
  const toolSent = new Set()    // tool call ids already queued
  let ctxQueue = []             // [{ kind: 'meta'|'tool', item, dir, attempts }] → /api/v1/sessions/meta
  const gitCache = new Map()    // dir → Promise<{user_email, repo}>
  let queue = []                // [{ ev, dir, attempts }]
  let timer = null
  let flushing = null
  let backoffMs = 0

  function config() {
    // Pick up a key written by `tokenfin setup` after OpenCode started.
    if (!cfg.key && now() - cfgAt > 60_000) { cfg = loadConfig(); cfgAt = now() }
    return cfg
  }

  function schedule(ms = flushMs) {
    if (timer) return
    timer = setTimeout(() => { timer = null; tick().catch(() => {}) }, ms)
    if (timer && typeof timer.unref === 'function') timer.unref()
  }

  function promptFor(parentID) {
    if (!parentID || promptUsed.has(parentID)) return null
    let text = prompts.get(parentID) || null
    if (!text && partText.has(parentID)) text = promptTextOf(Array.from(partText.get(parentID).values()))
    return text
  }

  function enqueue(info) {
    if (sent.has(info.id)) return
    sent.add(info.id); bounded(sent, 20_000)
    tentative.delete(info.id)
    const c = config()
    if (!c.key) { once('nokey', 'warn', 'TokenFin: no key found (run `npx tokenfin setup`) — OpenCode usage is not being recorded.'); return }
    const text = c.prompts ? promptFor(info.parentID) : null
    const ev = buildEvent(info, { prompt_text: text, session_title: c.prompts ? titles.get(info.sessionID) : null })
    if (!ev) return
    if (text) { promptUsed.add(info.parentID); bounded(promptUsed, 20_000); prompts.delete(info.parentID); partText.delete(info.parentID) }
    queue.push({ ev, dir: (info.path && (info.path.root || info.path.cwd)) || defaultDir, attempts: 0 })
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE)
    schedule()
  }

  function promoteTentative(all) {
    for (const [id, t] of Array.from(tentative)) {
      if (all || now() - t.since >= graceMs) enqueue(t.info)
    }
  }

  async function tick() {
    promoteTentative(false)
    await flush()
    if (queue.length || ctxQueue.length) schedule(backoffMs || flushMs)
    else if (tentative.size) schedule(flushMs)
  }

  function pushCtx(kind, item, dir) {
    if (!config().key) return
    ctxQueue.push({ kind, item, dir, attempts: 0 })
    if (ctxQueue.length > MAX_QUEUE) ctxQueue.splice(0, ctxQueue.length - MAX_QUEUE)
    schedule()
  }

  /** One row per finished tool call — name, outcome, duration; never its input or output. */
  function onToolPart(part) {
    const st = part.state || {}
    if (st.status !== 'completed' && st.status !== 'error') return
    const key = part.callID || part.id
    if (!key || toolSent.has(key)) return
    toolSent.add(key); bounded(toolSent, 20_000)
    const t = st.time || {}
    const start = Number(t.start) || null, end = Number(t.end) || null
    pushCtx('tool', {
      event_key: 'opencode:' + key, session_id: part.sessionID, prompt_id: parentOf.get(part.messageID) || null,
      tool: String(part.tool || 'unknown'), success: st.status === 'completed',
      duration_ms: start && end && end >= start ? end - start : null,
      error: st.status === 'error' ? String(st.error || '').slice(0, 500) : null,
      at: new Date(start || now()).toISOString(),
    }, null)
  }

  async function flushCtx() {
    const c = config()
    if (!ctxQueue.length || !c.key) return
    const batch = ctxQueue.slice(0, MAX_BATCH)
    const events = await Promise.all(batch.filter((b) => b.kind === 'meta').map(async (b) => {
      if (!b.dir) return b.item
      const g = await (gitCache.get(b.dir) || (gitCache.set(b.dir, Promise.resolve().then(() => gitInfo(b.dir)).catch(() => ({}))), gitCache.get(b.dir)))
      return { ...b.item, git_branch: (g && g.branch) || null, repo: (g && g.repo) || null, user_email: (g && g.user_email) || null }
    }))
    const tools = batch.filter((b) => b.kind === 'tool').map((b) => b.item)
    let res
    try {
      res = await fetchImpl(c.url + '/api/v1/sessions/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key, 'User-Agent': 'tokenfin-opencode/' + VERSION },
        body: JSON.stringify({ events, tools }),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(15_000) : undefined,
      })
    } catch { res = null }
    if (res && (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429))) {
      ctxQueue = ctxQueue.slice(batch.length)       // sent, or a 4xx retrying can't fix (older server: 404)
      if (res && !res.ok) once('ctx:' + res.status, 'warn', 'TokenFin: session details not accepted (' + res.status + ').')
    } else {
      const keep = batch.filter((b) => ++b.attempts < 5)
      ctxQueue = keep.concat(ctxQueue.slice(batch.length))
    }
  }

  function onChatMessage(input, output) {
    const msg = output && output.message
    const id = (msg && msg.id) || (input && input.messageID)
    if (!id) return
    const text = promptTextOf(output && output.parts)
    if (text) { prompts.set(id, text); bounded(prompts, 500) }
  }

  function onEvent(event) {
    if (!event || typeof event !== 'object') return
    const p = event.properties || {}
    if (event.type === 'message.updated') {
      const info = p.info
      if (!info || !info.id) return
      if (info.role !== 'assistant') return
      assistants.add(info.id); bounded(assistants, 5_000)
      if (info.parentID) { parentOf.set(info.id, info.parentID); bounded(parentOf, 5_000) }
      partText.delete(info.id)
      if (sent.has(info.id)) return
      if (isCompleted(info)) enqueue(info)
      else if (info.finish) {
        const prev = tentative.get(info.id)
        tentative.set(info.id, { info, since: prev ? prev.since : now() })
        schedule()
      } else if (tentative.has(info.id)) tentative.get(info.id).info = info
    } else if (event.type === 'message.part.updated' && p.part && p.part.type === 'tool') {
      onToolPart(p.part)
    } else if (event.type === 'message.part.updated') {
      const part = p.part
      if (!part || part.type !== 'text' || !part.messageID || assistants.has(part.messageID)) return
      if (!partText.has(part.messageID)) { partText.set(part.messageID, new Map()); bounded(partText, 200) }
      partText.get(part.messageID).set(part.id || String(partText.get(part.messageID).size), part)
    } else if (event.type === 'session.updated' || event.type === 'session.created') {
      const info = p.info
      const title = sessionTitleOf(info)
      if (info && info.id && title) { titles.set(info.id, title); bounded(titles, 2_000) }
      if (info && info.id && !metaSent.has(info.id)) {
        metaSent.add(info.id); bounded(metaSent, 2_000)
        const created = Number(info.time && info.time.created) || now()
        pushCtx('meta', {
          session_id: info.id, event: 'start', agent: 'opencode', agent_version: info.version || null,
          cwd: info.directory || null, hostname: safeHostname(), at: new Date(created).toISOString(),
          start_source: info.parentID ? 'subagent' : 'startup',
        }, info.directory || defaultDir)
      }
    } else if (event.type === 'session.idle') {
      schedule(0)
    }
  }

  async function withGit(item) {
    const dir = item.dir
    if (!dir) return item.ev
    if (!gitCache.has(dir)) { gitCache.set(dir, Promise.resolve().then(() => gitInfo(dir)).catch(() => ({}))); bounded(gitCache, 50) }
    const g = (await gitCache.get(dir)) || {}
    const ev = { ...item.ev }
    if (g.user_email && !ev.user_email) ev.user_email = g.user_email
    if (g.repo && !ev.repo) ev.repo = g.repo
    return ev
  }

  async function send(batch) {
    const c = config()
    const events = await Promise.all(batch.map(withGit))
    let res
    try {
      res = await fetchImpl(c.url + '/api/v1/ingest/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key, 'User-Agent': 'tokenfin-opencode/' + VERSION },
        body: JSON.stringify({ events }),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(15_000) : undefined,
      })
    } catch (e) {
      return { retry: true, why: 'network: ' + ((e && e.message) || e) }
    }
    if (res.ok) {
      let body = null
      try { body = await res.json() } catch {}
      const errs = ((body && body.results) || []).filter((r) => r.status === 'error')
      if (errs.length) once('evt-err:' + errs[0].error, 'warn', 'TokenFin: ' + errs.length + ' event(s) rejected: ' + errs[0].error)
      return { ok: true }
    }
    const status = res.status
    let msg = ''
    try { msg = ((await res.json()) || {}).error || '' } catch {}
    if (status === 429 || status >= 500) return { retry: true, why: status + ' ' + msg }
    // 401/403 (bad or revoked key, spend block), 400/413: retrying won't help.
    once('http:' + status, 'error', 'TokenFin: ingest rejected (' + status + (msg ? ' ' + msg : '') + ') — run `npx tokenfin doctor`.')
    return { drop: true }
  }

  async function flush() {
    if (flushing) return flushing
    flushing = (async () => {
      while (queue.length && config().key) {
        const batch = queue.slice(0, MAX_BATCH)
        const r = await send(batch).catch((e) => ({ retry: true, why: String(e) }))
        if (r.retry) {
          const keep = batch.filter((b) => ++b.attempts < MAX_ATTEMPTS)
          queue = keep.concat(queue.slice(batch.length))
          backoffMs = Math.min(MAX_BACKOFF_MS, backoffMs ? backoffMs * 2 : flushMs * 2 || 1_000)
          once('retry', 'warn', 'TokenFin: send failed (' + r.why + '), retrying with backoff.')
          return
        }
        queue = queue.slice(batch.length)
        backoffMs = 0
      }
      await flushCtx().catch(() => {})
    })().finally(() => { flushing = null })
    return flushing
  }

  async function dispose(timeoutMs = 5_000) {
    if (timer) { clearTimeout(timer); timer = null }
    promoteTentative(true)
    let t
    await Promise.race([
      (async () => { await flushing; await flush() })(),
      new Promise((r) => { t = setTimeout(r, timeoutMs); if (t.unref) t.unref() }),
    ])
    clearTimeout(t)
  }

  return {
    onChatMessage, onEvent, flush, dispose, tick,
    get queued() { return queue.length },
    get contextQueued() { return ctxQueue.length },
    get pending() { return tentative.size },
  }
}

// ── OpenCode entry point ────────────────────────────────────────────────────

async function server(input, options) {
  const client = input && input.client
  const log = (level, message) => {
    try {
      const r = client && client.app && client.app.log && client.app.log({ body: { service: 'tokenfin', level, message } })
      if (r && typeof r.catch === 'function') r.catch(() => {})
    } catch { /* never surface logging errors */ }
  }
  const tracker = createTracker({ ...(options && typeof options === 'object' ? options : {}), log, directory: input && (input.worktree || input.directory) })
  const guard = (fn) => async (...a) => { try { await fn(...a) } catch (e) { try { log('warn', 'TokenFin: ' + ((e && e.message) || e)) } catch {} } }
  return {
    'chat.message': guard(async (i, o) => tracker.onChatMessage(i, o)),
    event: guard(async ({ event }) => tracker.onEvent(event)),
    dispose: guard(async () => tracker.dispose()),
  }
}
// Internals for tests — properties, not named exports: OpenCode treats every
// export of a plugin file as a plugin, so the default export is the only one.
Object.assign(server, { createTracker, buildEvent, promptTextOf, repoFromRemote, readConfig, isCompleted, VERSION })

// OpenCode 1.x plugin module shape. Path plugins must export an id.
export default { id: 'tokenfin', server }
