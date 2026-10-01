import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TokenFinClient, TokenFinPolicyError, wrapAnthropic, wrapOpenAI, findRoute, isModelBlocked } from '../src/index'
import type { Policy } from '../src/index'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Mimics Stainless' APIPromise (thenable + withResponse). */
class FakeAPIPromise<T> {
  private parsed: Promise<T> | null = null
  constructor(private readonly make: () => Promise<T>) {}
  private parse() { return (this.parsed ??= this.make()) }
  then<A, B>(f?: (v: T) => A, r?: (e: unknown) => B) { return this.parse().then(f as any, r as any) }
  catch<B>(r: (e: unknown) => B) { return this.parse().catch(r) }
  async withResponse() { return { data: await this.parse(), response: { status: 200 } } }
}

function fakeAnthropic() {
  const calls: any[] = []
  const messages = {
    create(params: any) {
      calls.push(params)
      return new FakeAPIPromise(async () => ({ id: 'm', model: params.model, content: [], usage: { input_tokens: 10, output_tokens: 5 } }))
    },
  }
  return { client: { messages }, calls }
}

function fakeOpenAI() {
  const calls: any[] = []
  const completions = {
    create(params: any) {
      calls.push(params)
      return new FakeAPIPromise(async () => ({ model: params.model, choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } }))
    },
  }
  return { client: { chat: { completions } }, calls }
}

/** A mocked fetch serving the policy (optionally delayed / failing) and accepting ingest. */
function mockFetch(opts: { policy?: Policy | null; status?: number; delayMs?: number; throws?: boolean } = {}) {
  const log: { url: string; method: string; headers: Record<string, string>; body: any }[] = []
  const fetchImpl = (async (url: string, init: any = {}) => {
    const headers = init.headers ?? {}
    log.push({ url, method: init.method ?? 'GET', headers, body: init.body ? JSON.parse(init.body) : null })
    if (url.endsWith('/api/v1/policy')) {
      if (opts.delayMs) await new Promise(r => setTimeout(r, opts.delayMs))
      if (opts.throws) throw new Error('network down')
      const status = opts.status ?? 200
      if (status === 200 && headers['If-None-Match'] === `"${opts.policy?.version}"`) return new Response(null, { status: 304 })
      return new Response(JSON.stringify(opts.policy ?? {}), { status, headers: { 'content-type': 'application/json', etag: `"${opts.policy?.version}"` } })
    }
    return new Response(JSON.stringify({ accepted: 1, results: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fetchImpl, log }
}

const POLICY: Policy = {
  routes: [
    { from: 'claude-opus', to: 'claude-sonnet-4-6', match: 'prefix' },
    { from: 'gpt-4o', to: 'gpt-4o-mini', match: 'exact' },
  ],
  blocked_models: ['claude-3-opus'],
  version: 'v1',
  ttl_seconds: 60,
}

function client(f: ReturnType<typeof mockFetch>) {
  return new TokenFinClient({ apiKey: 'tfk_test', baseUrl: 'http://tf.test', fetch: f.fetchImpl, flushIntervalMs: 0, flushOnExit: false })
}
async function tracked(tf: TokenFinClient, f: ReturnType<typeof mockFetch>) {
  await tf.flush()
  return f.log.filter(l => l.url.includes('/api/v1/ingest')).flatMap(l => l.body.events ?? [l.body])
}

test('findRoute: exact beats prefix, longest prefix wins, case-insensitive', () => {
  const p: Policy = { routes: [
    { from: 'claude-opus', to: 'a', match: 'prefix' },
    { from: 'claude-opus-4', to: 'b', match: 'prefix' },
    { from: 'claude-opus-4-8', to: 'c' },
  ], blocked_models: [], version: 'x' }
  assert.equal(findRoute(p, 'claude-opus-4-8')?.to, 'c')
  assert.equal(findRoute(p, 'Claude-Opus-4-1')?.to, 'b')
  assert.equal(findRoute(p, 'claude-opus-3')?.to, 'a')
  assert.equal(findRoute(p, 'claude-sonnet-4'), null)
  // an exact route never matches as a prefix
  assert.equal(findRoute({ routes: [{ from: 'gpt-4o', to: 'x' }], blocked_models: [], version: '' }, 'gpt-4o-mini'), null)
  assert.equal(isModelBlocked(POLICY, 'claude-3-opus-20240229'), true)
  assert.equal(isModelBlocked(POLICY, 'claude-3-5-sonnet'), false)
})

test('anthropic: model rewritten per route, routed_from recorded, Bearer key sent', async () => {
  const f = mockFetch({ policy: POLICY })
  const tf = client(f)
  const { client: c, calls } = fakeAnthropic()
  wrapAnthropic(c, tf)
  const res: any = await c.messages.create({ model: 'claude-opus-4-8', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(calls[0].model, 'claude-sonnet-4-6')
  assert.equal(res.model, 'claude-sonnet-4-6')
  const evs = await tracked(tf, f)
  assert.equal(evs.length, 1)
  assert.equal(evs[0].model, 'claude-sonnet-4-6')
  assert.equal(evs[0].metadata.routed_from, 'claude-opus-4-8')
  const pol = f.log.find(l => l.url.endsWith('/api/v1/policy'))!
  assert.equal(pol.headers.Authorization, 'Bearer tfk_test')
  await tf.shutdown()
})

test('first call waits at most policyWaitMs for a slow policy, then goes through unrouted (fail open)', async () => {
  const f = mockFetch({ policy: POLICY, delayMs: 400 })
  const tf = client(f)
  const { client: c, calls } = fakeAnthropic()
  wrapAnthropic(c, tf, { policyWaitMs: 50 })
  const t0 = Date.now()
  await c.messages.create({ model: 'claude-opus-4-8', messages: [] })
  const waited = Date.now() - t0
  assert.ok(waited < 300, `waited ${waited}ms`)
  assert.equal(calls[0].model, 'claude-opus-4-8')
  await new Promise(r => setTimeout(r, 450))        // policy arrives in the background
  await c.messages.create({ model: 'claude-opus-4-8', messages: [] })
  assert.equal(calls[1].model, 'claude-sonnet-4-6')
  await tf.shutdown()
})

test('the deferred first call keeps withResponse() (used by messages.stream())', async () => {
  const f = mockFetch({ policy: POLICY, delayMs: 20 })
  const tf = client(f)
  const { client: c, calls } = fakeAnthropic()
  wrapAnthropic(c, tf)
  const r: any = await (c.messages.create({ model: 'claude-opus-4-1', messages: [] }) as any).withResponse()
  assert.equal(r.response.status, 200)
  assert.equal(calls[0].model, 'claude-sonnet-4-6')
  await tf.shutdown()
})

test('policy fetch errors / 404 fail open', async () => {
  for (const f of [mockFetch({ throws: true }), mockFetch({ status: 404 }), mockFetch({ status: 500 })]) {
    const tf = client(f)
    const { client: c, calls } = fakeOpenAI()
    wrapOpenAI(c, tf, { enforcePolicy: true })
    await c.chat.completions.create({ model: 'gpt-4o', messages: [] })
    assert.equal(calls[0].model, 'gpt-4o')
    await tf.shutdown()
  }
})

test('blocked models: routed only by default, throw TokenFinPolicyError with enforcePolicy', async () => {
  const f = mockFetch({ policy: POLICY })
  const tf = client(f)
  await tf.policy().ready(500)
  const a = fakeAnthropic(); wrapAnthropic(a.client, tf)
  await a.client.messages.create({ model: 'claude-3-opus-20240229', messages: [] })
  assert.equal(a.calls.length, 1)                     // default: never blocks

  const b = fakeAnthropic(); wrapAnthropic(b.client, tf, { enforcePolicy: true })
  assert.throws(() => b.client.messages.create({ model: 'claude-3-opus-20240229', messages: [] }),
    (e: unknown) => e instanceof TokenFinPolicyError && e.model === 'claude-3-opus-20240229')
  assert.equal(b.calls.length, 0)
  await tf.shutdown()
})

test('openai exact route; routeModels:false leaves the model alone', async () => {
  const f = mockFetch({ policy: POLICY })
  const tf = client(f)
  await tf.policy().ready(500)
  const a = fakeOpenAI(); wrapOpenAI(a.client, tf)
  await a.client.chat.completions.create({ model: 'gpt-4o', messages: [] })
  await a.client.chat.completions.create({ model: 'gpt-4o-2024-08-06', messages: [] })
  assert.deepEqual(a.calls.map(c => c.model), ['gpt-4o-mini', 'gpt-4o-2024-08-06'])
  const b = fakeOpenAI(); wrapOpenAI(b.client, tf, { routeModels: false })
  await b.client.chat.completions.create({ model: 'gpt-4o', messages: [] })
  assert.equal(b.calls[0].model, 'gpt-4o')
  await tf.shutdown()
})

test('refresh uses If-None-Match and keeps the policy on 304', async () => {
  const f = mockFetch({ policy: POLICY })
  const tf = new TokenFinClient({ apiKey: 'k', baseUrl: 'http://tf.test', fetch: f.fetchImpl, flushIntervalMs: 0, flushOnExit: false, policyTtlMs: 1 })
  const pm = tf.policy()
  await pm.ready(500)
  pm.refresh(true)
  await new Promise(r => setTimeout(r, 20))
  const gets = f.log.filter(l => l.url.endsWith('/api/v1/policy'))
  assert.equal(gets.length, 2)
  assert.equal(gets[1].headers['If-None-Match'], '"v1"')
  assert.equal(pm.current()?.version, 'v1')
  await tf.shutdown()
})
