import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TokenFinClient } from '../src/index'
import { parseRetryAfter, uuidV4 } from '../src/utils'
import { startMock } from './mock-server'

const mk = (url: string, extra: Record<string, unknown> = {}) =>
  new TokenFinClient({ apiKey: 'tfk_test', baseUrl: url, flushIntervalMs: 0, flushOnExit: false, ...extra })

test('batch endpoint: one request, snake_case wire format with first-class fields', async () => {
  const srv = await startMock(() => ({ status: 200, body: { results: [{ index: 0, status: 'accepted' }, { index: 1, status: 'duplicate' }] } }))
  try {
    const tf = mk(srv.url)
    tf.track({ model: 'claude-sonnet-4-6', inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 7,
      projectId: 'p1', userEmail: 'a@b.test', sessionId: 's1', latencyMs: 42, timestamp: new Date('2026-09-01T00:00:00Z'), idempotencyKey: 'k1' })
    tf.track({ model: 'gpt-4o', inputTokens: 1, outputTokens: 1 })
    const r = await tf.shutdown()
    assert.deepEqual(r, { sent: 2, dropped: 0 })
    assert.equal(srv.received.length, 1)
    assert.equal(srv.received[0].path, '/api/v1/ingest/batch')
    assert.equal(srv.received[0].headers.authorization, 'Bearer tfk_test')
    const e = srv.received[0].body.events[0]
    assert.deepEqual(
      { m: e.model, cr: e.cache_read_tokens, cw: e.cache_write_tokens, p: e.project_id, u: e.user_email, s: e.session_id, l: e.latency_ms, t: e.timestamp, k: e.idempotency_key },
      { m: 'claude-sonnet-4-6', cr: 100, cw: 7, p: 'p1', u: 'a@b.test', s: 's1', l: 42, t: '2026-09-01T00:00:00.000Z', k: 'k1' })
    assert.match(srv.received[0].body.events[1].idempotency_key, /^[0-9a-f-]{36}$/)
  } finally { await srv.close() }
})

test('falls back to single endpoint on 404 and remembers it', async () => {
  const srv = await startMock(req => req.path.endsWith('/batch') ? { status: 404 } : { status: 201 })
  try {
    const tf = mk(srv.url)
    for (let i = 0; i < 3; i++) tf.track({ model: 'm', inputTokens: 1, outputTokens: 1, idempotencyKey: `k${i}` })
    assert.deepEqual(await tf.flush(), { sent: 3, dropped: 0 })
    tf.track({ model: 'm', inputTokens: 1, outputTokens: 1 })
    await tf.flush()
    const paths = srv.received.map(r => r.path)
    assert.equal(paths.filter(p => p.endsWith('/batch')).length, 1)
    assert.equal(paths.filter(p => p === '/api/v1/ingest').length, 4)
    assert.equal(srv.received[1].headers['idempotency-key'], 'k0')
  } finally { await srv.close() }
})

test('non-retryable 4xx counts as dropped, not sent (and is not retried)', async () => {
  const srv = await startMock(req => req.path.endsWith('/batch') ? { status: 404 } : { status: 400, body: { error: 'bad' } })
  try {
    const tf = mk(srv.url)
    tf.track({ model: 'm', inputTokens: 1, outputTokens: 1 })
    tf.track({ model: 'm', inputTokens: 1, outputTokens: 1 })
    assert.deepEqual(await tf.flush(), { sent: 0, dropped: 2 })
    assert.equal(srv.received.length, 3) // 1 batch probe + 2 singles, no retries
    assert.deepEqual(tf.stats(), { sent: 0, dropped: 2, queued: 0 })
  } finally { await srv.close() }
})

test('batch per-event results: mixed accepted / rejected / retryable', async () => {
  let calls = 0
  const srv = await startMock(req => {
    calls++
    if (calls === 1) return { status: 207, body: { results: [
      { index: 0, status: 201 }, { index: 1, status: 422, error: 'invalid' }, { index: 2, status: 503 }] } }
    assert.equal(req.body.events.length, 1) // only the retryable one is re-sent
    return { status: 200, body: { results: [{ index: 0, ok: true }] } }
  })
  try {
    const tf = mk(srv.url, { maxRetries: 2 })
    for (let i = 0; i < 3; i++) tf.track({ model: 'm', inputTokens: 1, outputTokens: 1 })
    assert.deepEqual(await tf.flush(), { sent: 2, dropped: 1 })
    assert.equal(calls, 2)
  } finally { await srv.close() }
})

test('honours Retry-After on 429 then succeeds', async () => {
  const times: number[] = []
  const srv = await startMock((_r, n) => { times.push(Date.now()); return n === 1 ? { status: 429, headers: { 'Retry-After': '1' } } : { status: 200 } })
  try {
    const tf = mk(srv.url)
    tf.track({ model: 'm', inputTokens: 1, outputTokens: 1 })
    assert.deepEqual(await tf.flush(), { sent: 1, dropped: 0 })
    assert.ok(times[1] - times[0] >= 950, `waited ${times[1] - times[0]}ms`)
  } finally { await srv.close() }
})

test('503 exhausted retries → dropped; 408 is retried', async () => {
  const srv = await startMock(() => ({ status: 503, headers: { 'Retry-After': '0' } }))
  try {
    const tf = mk(srv.url, { maxRetries: 2 })
    tf.track({ model: 'm', inputTokens: 1, outputTokens: 1 })
    assert.deepEqual(await tf.flush(), { sent: 0, dropped: 1 })
    assert.equal(srv.received.length, 3)
  } finally { await srv.close() }
  const srv2 = await startMock((_r, n) => (n === 1 ? { status: 408 } : { status: 200 }))
  try {
    const tf = mk(srv2.url)
    tf.track({ model: 'm', inputTokens: 1, outputTokens: 1 })
    assert.deepEqual(await tf.flush(), { sent: 1, dropped: 0 })
  } finally { await srv2.close() }
})

test('network failure never throws; circuit opens after repeated failures', async () => {
  const tf = mk('http://127.0.0.1:1', { maxRetries: 0, timeoutMs: 500 })
  for (let i = 0; i < 6; i++) {
    tf.track({ model: 'm', inputTokens: 1, outputTokens: 1 })
    const r = await tf.flush()
    assert.equal(r.dropped, 1)
  }
  assert.equal(tf.stats().dropped, 6)
})

test('bounded queue drops oldest and counts it', async () => {
  const srv = await startMock(req => ({ status: 200, body: { results: req.body.events.map((_: unknown, i: number) => ({ index: i, status: 'accepted' })) } }))
  try {
    const tf = mk(srv.url, { maxQueueSize: 2, batchSize: 10 })
    for (let i = 0; i < 5; i++) tf.track({ model: `m${i}`, inputTokens: 1, outputTokens: 1 })
    assert.deepEqual(tf.stats(), { sent: 0, dropped: 3, queued: 2 })
    await tf.flush()
    assert.deepEqual(srv.received[0].body.events.map((e: { model: string }) => e.model), ['m3', 'm4'])
  } finally { await srv.close() }
})

test('size-triggered and interval flush', async () => {
  const srv = await startMock(() => ({ status: 200 }))
  try {
    const tf = new TokenFinClient({ apiKey: 'tfk_test', baseUrl: srv.url, batchSize: 2, flushIntervalMs: 50, flushOnExit: false })
    tf.track({ model: 'm', inputTokens: 1, outputTokens: 1 })
    tf.track({ model: 'm', inputTokens: 1, outputTokens: 1 }) // hits batchSize
    tf.track({ model: 'm', inputTokens: 1, outputTokens: 1 }) // picked up by the timer
    await new Promise(r => setTimeout(r, 300))
    assert.equal(tf.stats().sent, 3)
    await tf.shutdown()
  } finally { await srv.close() }
})

test('no SIGINT/SIGTERM handlers are installed; beforeExit is detached on shutdown', async () => {
  const before = { int: process.listenerCount('SIGINT'), term: process.listenerCount('SIGTERM'), exit: process.listenerCount('beforeExit') }
  const tf = new TokenFinClient({ apiKey: 'tfk_test', baseUrl: 'http://127.0.0.1:1', flushIntervalMs: 0 })
  assert.equal(process.listenerCount('SIGINT'), before.int)
  assert.equal(process.listenerCount('SIGTERM'), before.term)
  assert.equal(process.listenerCount('beforeExit'), before.exit + 1)
  await tf.shutdown()
  assert.equal(process.listenerCount('beforeExit'), before.exit)
})

test('utils: Retry-After parsing and uuid', () => {
  assert.equal(parseRetryAfter('3'), 3000)
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 5_000), 5000)
  assert.equal(parseRetryAfter('garbage'), null)
  assert.match(uuidV4(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})
