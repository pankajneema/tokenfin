// node --test tokenfin.test.js — plugin logic without OpenCode or a server.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import plugin from './tokenfin.js'

const { createTracker, buildEvent, promptTextOf, repoFromRemote, readConfig } = plugin.server

// SDK-shaped fixtures (@opencode-ai/sdk AssistantMessage / UserMessage / TextPart).
const T0 = Date.UTC(2026, 8, 30, 10, 0, 0)
function assistant(over = {}) {
  return {
    id: 'msg_a1', sessionID: 'ses_1', role: 'assistant', parentID: 'msg_u1',
    time: { created: T0 }, modelID: 'claude-sonnet-4-6', providerID: 'anthropic', mode: 'build',
    path: { cwd: '/tmp/x', root: '/tmp/x' }, cost: 0,
    tokens: { input: 12, output: 340, reasoning: 25, cache: { read: 41_000, write: 1_800 } },
    ...over,
  }
}
const updated = (info) => ({ type: 'message.updated', properties: { info } })
const done = (over = {}) => assistant({ time: { created: T0, completed: T0 + 4_200 }, finish: 'stop', ...over })
const userMsg = (id = 'msg_u1') => ({ id, sessionID: 'ses_1', role: 'user', time: { created: T0 - 10 }, agent: 'build', model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' } })
const text = (t, over = {}) => ({ id: 'prt_' + Math.random(), sessionID: 'ses_1', messageID: 'msg_u1', type: 'text', text: t, ...over })

function harness(over = {}) {
  const calls = []
  const logs = []
  const fetch = over.fetch || (async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url, init, body })
    return new Response(JSON.stringify({ results: body.events.map((_, index) => ({ index, status: 'accepted', code: 201 })) }), { status: 200 })
  })
  const t = createTracker({
    fetch, flushMs: 60_000, graceMs: 0, log: (l, m) => logs.push([l, m]),
    config: { key: 'tfk_test_x', url: 'http://tf.test', prompts: true },
    gitInfo: async () => ({ user_email: 'dev@acme.test', repo: 'acme/app' }),
    ...over,
  })
  return { t, calls, logs }
}

test('buildEvent: payload shape, cost basis rule, latency', () => {
  const ev = buildEvent(done(), { prompt_text: 'hi' })
  assert.deepEqual(
    { ...ev, metadata: undefined },
    {
      model: 'claude-sonnet-4-6', provider: 'anthropic', source: 'opencode', tool: 'opencode',
      input_tokens: 12, output_tokens: 340, reasoning_tokens: 25, cache_read_tokens: 41_000, cache_write_tokens: 1_800,
      latency_ms: 4_200, timestamp: new Date(T0).toISOString(), session_id: 'ses_1', correlation_id: 'msg_u1',
      idempotency_key: 'msg_a1', cost_usd: 0, cost_basis: 'notional', prompt_text: 'hi', metadata: undefined,
    })
  assert.equal(ev.metadata.agent, 'build')
  // OpenCode reports a cost even for subscription logins → still notional by default…
  assert.equal(buildEvent(done({ cost: 0.0123 })).cost_basis, 'notional')
  // …metered only when the user opts in (API-key billing).
  assert.equal(buildEvent(done({ cost: 0.0123 }), { cost_basis: 'metered' }).cost_basis, 'metered')
  assert.equal(buildEvent(done({ tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })), null)
  assert.equal(buildEvent({ ...userMsg() }), null)
})

test('promptTextOf joins every typed text part, untruncated; synthetic only as fallback', () => {
  const big = 'y'.repeat(20_000)
  assert.equal(promptTextOf([text('first'), { type: 'file', url: 'x' }, text(big)]), 'first\n' + big)
  assert.equal(promptTextOf([text('typed'), text('file contents', { synthetic: true })]), 'typed')
  assert.equal(promptTextOf([text('only synthetic', { synthetic: true })]), 'only synthetic')
  assert.equal(promptTextOf([text('x', { ignored: true })]), null)
  assert.equal(promptTextOf([]), null)
})

test('repoFromRemote handles ssh and https remotes', () => {
  assert.equal(repoFromRemote('git@github.com:acme/app.git'), 'acme/app')
  assert.equal(repoFromRemote('https://github.com/acme/app'), 'acme/app')
  assert.equal(repoFromRemote('https://gitlab.com/group/sub/app.git/'), 'sub/app')
  assert.equal(repoFromRemote(''), null)
})

test('sends only completed messages, once, with prompt text on the first message of the prompt', async () => {
  const { t, calls } = harness()
  t.onChatMessage({ sessionID: 'ses_1', messageID: 'msg_u1' }, { message: userMsg(), parts: [text('explain'), text('this repo')] })
  t.onEvent(updated(userMsg()))
  t.onEvent(updated(assistant({ tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })))   // streaming
  t.onEvent(updated(assistant()))                     // still streaming, no finish
  assert.equal(t.queued, 0)
  t.onEvent(updated(done()))
  t.onEvent(updated(done()))                          // fired again
  t.onEvent(updated(done({ id: 'msg_a2', time: { created: T0 + 5_000, completed: T0 + 6_000 } })))  // 2nd call, same prompt
  assert.equal(t.queued, 2)
  await t.flush()
  assert.equal(calls.length, 1)
  const { url, init, body } = calls[0]
  assert.equal(url, 'http://tf.test/api/v1/ingest/batch')
  assert.equal(init.headers.Authorization, 'Bearer tfk_test_x')
  assert.deepEqual(body.events.map((e) => e.idempotency_key), ['msg_a1', 'msg_a2'])
  assert.equal(body.events[0].prompt_text, 'explain\nthis repo')
  assert.equal('prompt_text' in body.events[1], false)
  assert.equal(body.events[0].user_email, 'dev@acme.test')
  assert.equal(body.events[0].repo, 'acme/app')
  // later updates of an already-sent message are ignored
  t.onEvent(updated(done()))
  assert.equal(t.queued, 0)
})

test('sends OpenCode\'s session title (not the "New session" placeholder); none when prompts are off', async () => {
  const sess = (title) => ({ type: 'session.updated', properties: { info: { id: 'ses_1', title, time: { created: T0, updated: T0 } } } })
  const { t, calls } = harness()
  t.onEvent(sess('New session - 2026-09-30T10:00:00.000Z'))
  t.onEvent(updated(done()))
  t.onEvent(sess('Refactor the billing module'))
  t.onEvent(updated(done({ id: 'msg_a2', time: { created: T0 + 5_000, completed: T0 + 6_000 } })))
  await t.flush()
  const evs = calls[0].body.events
  assert.equal('session_title' in evs[0], false)
  assert.equal(evs[1].session_title, 'Refactor the billing module')

  const off = harness({ config: { key: 'tfk_test_x', url: 'http://tf.test', prompts: false } })
  off.t.onEvent(sess('Secret project name'))
  off.t.onEvent(updated(done()))
  await off.t.flush()
  assert.equal('session_title' in off.calls[0].body.events[0], false)
})

test('session context (directory, branch, start) and tool calls go to /api/v1/sessions/meta; inputs never sent', async () => {
  const { t, calls } = harness({ gitInfo: async () => ({ user_email: 'dev@acme.test', repo: 'acme/app', branch: 'feat/x' }) })
  const sess = { type: 'session.created', properties: { info: { id: 'ses_1', directory: '/Users/dev/app', version: '1.18.33', title: 'New session - x', time: { created: T0, updated: T0 } } } }
  t.onEvent(sess)
  t.onEvent({ ...sess, type: 'session.updated' })            // context queued once per session
  t.onEvent(updated(done()))                                   // assistant msg_a1 → parent msg_u1
  const tool = (id, status, extra = {}) => ({ type: 'message.part.updated', properties: { part: {
    id: 'prt_' + id, callID: 'call_' + id, sessionID: 'ses_1', messageID: 'msg_a1', type: 'tool', tool: 'bash',
    state: { status, input: { command: 'rm -rf secret' }, output: 'SECRET OUTPUT', time: { start: T0 + 100, end: T0 + 1_300 }, ...extra } } } })
  t.onEvent(tool('1', 'running'))                             // not finished → ignored
  t.onEvent(tool('1', 'completed'))
  t.onEvent(tool('1', 'completed'))                           // repeated update → once
  t.onEvent(tool('2', 'error', { error: 'exit 1' }))
  assert.equal(t.contextQueued, 3)
  await t.flush()
  const meta = calls.find((c) => c.url === 'http://tf.test/api/v1/sessions/meta')
  assert.ok(meta)
  assert.equal(meta.body.events.length, 1)
  assert.equal(meta.body.events[0].cwd, '/Users/dev/app')
  assert.equal(meta.body.events[0].git_branch, 'feat/x')
  assert.equal(meta.body.events[0].event, 'start')
  assert.equal(meta.body.events[0].at, new Date(T0).toISOString())
  assert.deepEqual(meta.body.tools.map((x) => [x.event_key, x.tool, x.success, x.duration_ms, x.prompt_id]),
    [['opencode:call_1', 'bash', true, 1200, 'msg_u1'], ['opencode:call_2', 'bash', false, 1200, 'msg_u1']])
  assert.equal(JSON.stringify(meta.body).includes('rm -rf secret'), false)
  assert.equal(JSON.stringify(meta.body).includes('SECRET OUTPUT'), false)
  assert.equal(t.contextQueued, 0)
})

test('prompt text falls back to message.part.updated when chat.message was not seen', async () => {
  const { t, calls } = harness()
  t.onEvent({ type: 'message.part.updated', properties: { part: text('from parts', { id: 'p1' }) } })
  t.onEvent({ type: 'message.part.updated', properties: { part: text('from parts, edited', { id: 'p1' }) } })
  t.onEvent(updated(done()))
  await t.flush()
  assert.equal(calls[0].body.events[0].prompt_text, 'from parts, edited')
})

test('prompts:false never sends prompt text', async () => {
  const { t, calls } = harness({ config: { key: 'k', url: 'http://tf.test', prompts: false } })
  t.onChatMessage({}, { message: userMsg(), parts: [text('secret')] })
  t.onEvent(updated(done()))
  await t.flush()
  assert.equal('prompt_text' in calls[0].body.events[0], false)
})

test('finish without time.completed is sent after the grace period (and on dispose)', async () => {
  let clock = T0
  const { t, calls } = harness({ now: () => clock, graceMs: 15_000 })
  t.onEvent(updated(assistant({ finish: 'stop' })))
  await t.tick()
  assert.equal(calls.length, 0)
  t.onEvent(updated(assistant({ finish: 'stop', tokens: { input: 1, output: 999, reasoning: 0, cache: { read: 0, write: 0 } } })))
  clock += 16_000
  await t.tick()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].body.events[0].output_tokens, 999)   // latest snapshot

  const h2 = harness({ graceMs: 60_000 })
  h2.t.onEvent(updated(assistant({ id: 'msg_z', finish: 'stop' })))
  await h2.t.dispose()
  assert.equal(h2.calls.length, 1)
})

test('retries 5xx / network with backoff, drops on 401, never throws', async () => {
  let n = 0
  const seen = []
  const fetch = async (_u, init) => {
    n++
    seen.push(JSON.parse(init.body).events.length)
    if (n === 1) throw new Error('ECONNREFUSED')
    if (n === 2) return new Response('{"error":"down"}', { status: 503 })
    return new Response(JSON.stringify({ results: [] }), { status: 200 })
  }
  const { t, logs } = harness({ fetch })
  t.onEvent(updated(done()))
  await t.flush(); assert.equal(t.queued, 1)
  await t.flush(); assert.equal(t.queued, 1)
  await t.flush(); assert.equal(t.queued, 0)
  assert.deepEqual(seen, [1, 1, 1])
  assert.equal(logs.filter(([, m]) => /retrying/.test(m)).length, 1)   // logged once

  const h = harness({ fetch: async () => new Response('{"error":"Invalid API key"}', { status: 401 }) })
  h.t.onEvent(updated(done()))
  await h.t.flush()
  assert.equal(h.t.queued, 0)
  assert.match(h.logs[0][1], /401 Invalid API key/)
})

test('missing key: nothing queued, logged once', async () => {
  const { t, calls, logs } = harness({ config: { key: '', url: 'http://tf.test', prompts: true } })
  t.onEvent(updated(done()))
  t.onEvent(updated(done({ id: 'msg_a9' })))
  await t.flush()
  assert.equal(calls.length, 0)
  assert.equal(logs.length, 1)
  assert.match(logs[0][1], /no key/)
})

test('readConfig: env wins, then ~/.tokenfin/config.json (url may be the MCP url)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-oc-'))
  try {
    assert.equal(readConfig({}, home).key, '')
    fs.mkdirSync(path.join(home, '.tokenfin'))
    fs.writeFileSync(path.join(home, '.tokenfin', 'config.json'), JSON.stringify({ key: 'tfk_file', url: 'http://local:3002/api/mcp', prompts: false }))
    assert.deepEqual(readConfig({}, home), { key: 'tfk_file', url: 'http://local:3002', prompts: false, basis: 'notional' })
    assert.deepEqual(readConfig({ TOKENFIN_API_KEY: 'tfk_env', TOKENFIN_URL: 'http://env/' }, home), { key: 'tfk_env', url: 'http://env', prompts: false, basis: 'notional' })
    assert.equal(readConfig({ TOKENFIN_COST_BASIS: 'metered' }, home).basis, 'metered')
  } finally { fs.rmSync(home, { recursive: true, force: true }) }
})

test('OpenCode entry: default export is { id, server } and hooks swallow errors', async () => {
  assert.equal(plugin.id, 'tokenfin')
  const hooks = await plugin.server({ client: { app: { log: async () => { throw new Error('x') } } }, directory: '/nonexistent' },
    { config: { key: 'k', url: 'http://127.0.0.1:9', prompts: true }, flushMs: 60_000 })
  await hooks.event({ event: null })
  await hooks.event({ event: updated(done()) })
  await hooks['chat.message']({}, null)
  await hooks.dispose()   // unreachable server: must resolve, not throw
})
