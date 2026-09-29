import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TokenFinClient, wrapAnthropic, wrapOpenAI } from '../src/index'
import { startMock } from './mock-server'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Mimics Stainless' APIPromise: a thenable with extra helpers and lazy memoized parse. */
class FakeAPIPromise<T> {
  private parsed: Promise<T> | null = null
  constructor(private readonly make: () => Promise<T>) {}
  private parse() { return (this.parsed ??= this.make()) }
  then<A, B>(f?: (v: T) => A, r?: (e: unknown) => B) { return this.parse().then(f as any, r as any) }
  catch<B>(r: (e: unknown) => B) { return this.parse().catch(r) }
  async withResponse() { return { data: await this.parse(), response: { status: 200 } } }
}

/** Mimics Stainless' Stream: async-iterable via a prototype method. */
class FakeStream<E> {
  constructor(private readonly events: E[]) {}
  async *iterator() { for (const e of this.events) yield e }
  [Symbol.asyncIterator]() { return this.iterator() }
}

function fakeAnthropic(opts: { fail?: boolean } = {}) {
  const calls: any[] = []
  const messages = {
    create(params: any) {
      calls.push(params)
      return new FakeAPIPromise(async () => {
        if (opts.fail) throw Object.assign(new Error('overloaded'), { status: 529 })
        if (params.stream) return new FakeStream([
          { type: 'message_start', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 12, output_tokens: 1, cache_read_input_tokens: 300, cache_creation_input_tokens: 40 } } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } },
          { type: 'message_delta', usage: { output_tokens: 57 } },
          { type: 'message_stop' },
        ])
        return { id: 'msg_1', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'hi' }],
          usage: { input_tokens: 20, output_tokens: 8, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 } }
      })
    },
  }
  return { client: { messages }, calls }
}

function fakeOpenAI() {
  const calls: any[] = []
  const completions = {
    create(params: any) {
      calls.push(params)
      return new FakeAPIPromise(async () => {
        if (params.stream) {
          const chunks: any[] = [
            { model: 'gpt-4o', choices: [{ delta: { content: 'a' } }], usage: null },
            { model: 'gpt-4o', choices: [{ delta: { content: 'b' } }], usage: null },
          ]
          if (params.stream_options?.include_usage) chunks.push({ model: 'gpt-4o', choices: [],
            usage: { prompt_tokens: 1000, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 800 } } })
          return new FakeStream(chunks)
        }
        return { model: 'gpt-4o-2024-08-06', choices: [{ message: { content: 'x' } }],
          usage: { prompt_tokens: 500, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 200 } } }
      })
    },
  }
  const responses = {
    create: (params: any) => { calls.push(params); return new FakeAPIPromise(async () => ({ model: 'gpt-5', output: [],
      usage: { input_tokens: 90, output_tokens: 9, input_tokens_details: { cached_tokens: 40 } } })) },
  }
  return { client: { chat: { completions }, responses }, calls }
}

async function harness() {
  const srv = await startMock(() => ({ status: 200 }))
  const tf = new TokenFinClient({ apiKey: 'tfk_test', baseUrl: srv.url, flushIntervalMs: 0, flushOnExit: false })
  const events = async () => { await tf.flush(); return srv.received.flatMap(r => r.body.events) }
  return { srv, tf, events }
}

test('anthropic non-streaming: same return value, usage incl. cache tokens, no prompt by default', async () => {
  const { srv, tf, events } = await harness()
  try {
    const { client } = fakeAnthropic()
    const wrapped = wrapAnthropic(client, tf)
    assert.equal(wrapped, client)
    const p = wrapped.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 10, messages: [{ role: 'user', content: 'secret' }] })
    assert.ok(p instanceof FakeAPIPromise, 'APIPromise identity preserved')
    const { data } = await (p as any).withResponse()
    assert.equal(data.id, 'msg_1')
    const [e] = await events()
    assert.equal(e.model, 'claude-sonnet-4-6')
    assert.deepEqual([e.input_tokens, e.output_tokens, e.cache_read_tokens, e.cache_write_tokens], [20, 8, 1000, 50])
    assert.equal(e.provider, 'anthropic')
    assert.equal(typeof e.latency_ms, 'number')
    assert.equal(e.prompt_text, undefined)
  } finally { await srv.close() }
})

test('anthropic streaming: caller sees every event, usage from message_start + message_delta', async () => {
  const { srv, tf, events } = await harness()
  try {
    const { client } = fakeAnthropic()
    wrapAnthropic(client, tf, { capturePrompts: true, projectId: 'proj', userEmail: 'dev@x.test' })
    const stream: any = await client.messages.create({ model: 'claude-sonnet-4-6', stream: true, messages: [{ role: 'user', content: [{ type: 'text', text: 'hello there' }] }] })
    assert.ok(stream instanceof FakeStream)
    const seen: string[] = []
    for await (const ev of stream) seen.push(ev.type)
    assert.deepEqual(seen, ['message_start', 'content_block_delta', 'message_delta', 'message_stop'])
    const [e] = await events()
    assert.deepEqual([e.input_tokens, e.output_tokens, e.cache_read_tokens, e.cache_write_tokens], [12, 57, 300, 40])
    assert.equal(e.metadata.stream, true)
    assert.equal(e.prompt_text, 'hello there')
    assert.equal(e.project_id, 'proj')
    assert.equal(e.user_email, 'dev@x.test')
  } finally { await srv.close() }
})

test('anthropic SDK errors propagate unchanged and nothing is recorded', async () => {
  const { srv, tf, events } = await harness()
  try {
    const { client } = fakeAnthropic({ fail: true })
    wrapAnthropic(client, tf)
    await assert.rejects(async () => { await client.messages.create({ model: 'm', messages: [] }) }, /overloaded/)
    assert.deepEqual(await events(), [])
  } finally { await srv.close() }
})

test('openai non-streaming: input excludes cached, cached → cache_read', async () => {
  const { srv, tf, events } = await harness()
  try {
    const { client } = fakeOpenAI()
    wrapOpenAI(client, tf)
    const res: any = await client.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: 'x' }] })
    assert.equal(res.choices[0].message.content, 'x')
    await client.responses.create({ model: 'gpt-5', input: 'hi' })
    const [a, b] = await events()
    assert.deepEqual([a.model, a.input_tokens, a.output_tokens, a.cache_read_tokens], ['gpt-4o-2024-08-06', 300, 20, 200])
    assert.deepEqual([b.model, b.input_tokens, b.output_tokens, b.cache_read_tokens], ['gpt-5', 50, 9, 40])
  } finally { await srv.close() }
})

test('openai streaming: include_usage auto-set, usage-only trailer hidden, caller params untouched', async () => {
  const { srv, tf, events } = await harness()
  try {
    const { client, calls } = fakeOpenAI()
    wrapOpenAI(client, tf)
    const params = { model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'x' }] }
    const stream: any = await client.chat.completions.create(params)
    const chunks: any[] = []
    for await (const c of stream) chunks.push(c)
    assert.equal(chunks.length, 2)
    assert.ok(chunks.every(c => c.choices.length === 1))
    assert.deepEqual(calls[0].stream_options, { include_usage: true })
    assert.equal((params as any).stream_options, undefined)
    const [e] = await events()
    assert.deepEqual([e.input_tokens, e.output_tokens, e.cache_read_tokens], [200, 30, 800])
  } finally { await srv.close() }
})

test('openai streaming with caller-set include_usage keeps the trailer visible', async () => {
  const { srv, tf, events } = await harness()
  try {
    const { client } = fakeOpenAI()
    wrapOpenAI(client, tf)
    const stream: any = await client.chat.completions.create({ model: 'gpt-4o', stream: true, stream_options: { include_usage: true }, messages: [] })
    let n = 0
    for await (const _ of stream) n++
    assert.equal(n, 3)
    assert.equal((await events()).length, 1)
  } finally { await srv.close() }
})

test('wrapping twice does not double count; early break still records', async () => {
  const { srv, tf, events } = await harness()
  try {
    const { client } = fakeAnthropic()
    wrapAnthropic(wrapAnthropic(client, tf), tf)
    const stream: any = await client.messages.create({ model: 'm', stream: true, messages: [] })
    for await (const _ of stream) break
    const evs = await events()
    assert.equal(evs.length, 1)
    assert.equal(evs[0].metadata.stream_status, 'aborted')
  } finally { await srv.close() }
})
