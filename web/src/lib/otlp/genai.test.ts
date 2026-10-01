import { describe, it, expect } from 'vitest'
import {
  normalizeId, genAiUsage, sanitizeAttributes, parseTraceRequest, statusCodeOf, spanKindOf,
  nanosToMs, flattenAttrs, isContentKey, agentSourceOf,
} from './genai'
import { encodeTraceRequest, decodeTraceRequest } from './traces-proto'
import { dedupeSpans, mirrorable, parentKey, priceSpans, spanRow, usageRowFor, spanEventId } from './traces'
import { costFromPrice, priceFor } from '@/lib/mcp/pricing'
import type { KeyCtx } from './auth'

// ── fixture builders (OTLP/JSON shape) ──────────────────────────────────────
const kv = (key: string, v: unknown) => ({
  key,
  value: typeof v === 'number'
    ? (Number.isInteger(v) ? { intValue: v } : { doubleValue: v })
    : typeof v === 'boolean' ? { boolValue: v }
    : Array.isArray(v) ? { arrayValue: { values: v.map(x => ({ stringValue: String(x) })) } }
    : { stringValue: String(v) },
})
const attrs = (o: Record<string, unknown>) => Object.entries(o).map(([k, v]) => kv(k, v))

const TRACE = '5b8efff798038103d269b633813fc60c'
const T0 = BigInt('1759132800000000000') // 2025-09-29T08:00:00Z in ns
const ns = (ms: number) => String(T0 + BigInt(ms) * BigInt(1_000_000))

function span(id: string, parent: string | null, name: string, a: Record<string, unknown>, startMs: number, endMs: number, extra: Record<string, unknown> = {}) {
  return {
    traceId: TRACE, spanId: id, ...(parent ? { parentSpanId: parent } : {}), name, kind: 3,
    startTimeUnixNano: ns(startMs), endTimeUnixNano: ns(endMs), attributes: attrs(a), ...extra,
  }
}

/** An agent (aggregate) → semconv chat + tool + OpenInference LLM + OpenLLMetry call, plus Claude Code. */
export const FIXTURE = {
  resourceSpans: [
    {
      resource: { attributes: attrs({ 'service.name': 'support-bot', 'deployment.environment.name': 'prod' }) },
      scopeSpans: [{
        scope: { name: 'opentelemetry.instrumentation.openai', version: '0.40.0' },
        spans: [
          // Aggregate: sums its children — must NOT be mirrored.
          span('a000000000000001', null, 'invoke_agent support', {
            'gen_ai.operation.name': 'invoke_agent', 'gen_ai.usage.input_tokens': 2700, 'gen_ai.usage.output_tokens': 230,
            'gen_ai.conversation.id': 'conv-42', 'user.email': 'Dev@Acme.com',
          }, 0, 900),
          // Semconv chat: input includes 200 cached tokens.
          span('a000000000000002', 'a000000000000001', 'chat gpt-4o', {
            'gen_ai.operation.name': 'chat', 'gen_ai.provider.name': 'openai',
            'gen_ai.request.model': 'gpt-4o', 'gen_ai.response.model': 'gpt-4o-2024-08-06',
            'gen_ai.usage.input_tokens': 1000, 'gen_ai.usage.output_tokens': 100,
            'gen_ai.usage.cache_read.input_tokens': 200,
            'gen_ai.input.messages': '[{"role":"user","content":"email me at a@b.com"}]',
            'gen_ai.response.finish_reasons': ['stop'],
          }, 10, 400),
          span('a000000000000003', 'a000000000000001', 'execute_tool search', { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 'search' }, 400, 450,
            { status: { code: 2, message: 'timeout' } }),
          // OpenInference (Anthropic raw usage: cache > prompt → prompt is uncached).
          span('a000000000000004', 'a000000000000001', 'ChatAnthropic', {
            'openinference.span.kind': 'LLM', 'llm.model_name': 'claude-sonnet-4-5', 'llm.provider': 'anthropic',
            'llm.token_count.prompt': 500, 'llm.token_count.completion': 50, 'llm.token_count.prompt_details.cache_read': 1000,
            'input.value': 'hello', 'session.id': 'sess-oi',
          }, 450, 700),
          // OpenLLMetry legacy names + indexed prompt content.
          span('a000000000000005', 'a000000000000001', 'openai.chat', {
            'gen_ai.system': 'OpenAI', 'llm.request.type': 'chat', 'gen_ai.request.model': 'gpt-4o-mini',
            'gen_ai.usage.prompt_tokens': 200, 'gen_ai.usage.completion_tokens': 80,
            'gen_ai.prompt.0.role': 'user', 'gen_ai.prompt.0.content': 'my key is sk-ant-abcdefghijklmnopqrstuvwxyz',
          }, 700, 890, { events: [{ name: 'exception', timeUnixNano: ns(880), attributes: attrs({ 'exception.type': 'RateLimitError', 'exception.message': 'slow down' }) }] }),
        ],
      }],
    },
    {
      resource: { attributes: attrs({ 'service.name': 'claude-code' }) },
      scopeSpans: [{ spans: [{
        traceId: 'c'.repeat(32), spanId: 'c'.repeat(16), name: 'claude_code.llm_request', kind: 'SPAN_KIND_CLIENT',
        startTimeUnixNano: ns(0), endTimeUnixNano: ns(10),
        attributes: attrs({ 'gen_ai.request.model': 'claude-opus-4-1', 'gen_ai.usage.input_tokens': 10, 'gen_ai.usage.output_tokens': 5 }),
      }] }],
    },
  ],
}

const byId = (spans: ReturnType<typeof parseTraceRequest>, id: string) => spans.find(s => s.spanId === id)!

describe('ids / enums / time', () => {
  it('normalizes hex, base64 and zero ids', () => {
    expect(normalizeId(TRACE.toUpperCase(), 16)).toBe(TRACE)
    expect(normalizeId(Buffer.from(TRACE, 'hex').toString('base64'), 16)).toBe(TRACE)
    expect(normalizeId(new Uint8Array(Buffer.from('a000000000000002', 'hex')), 8)).toBe('a000000000000002')
    expect(normalizeId('0000000000000000', 8)).toBeNull()
    expect(normalizeId('', 8)).toBeNull()
    expect(normalizeId(undefined, 8)).toBeNull()
  })
  it('reads status codes and span kinds as numbers or enum strings', () => {
    expect(statusCodeOf(2)).toBe(2)
    expect(statusCodeOf('STATUS_CODE_ERROR')).toBe(2)
    expect(statusCodeOf('STATUS_CODE_OK')).toBe(1)
    expect(statusCodeOf(undefined)).toBe(0)
    expect(spanKindOf('SPAN_KIND_CLIENT')).toBe(3)
    expect(spanKindOf(2)).toBe(2)
    expect(spanKindOf('junk')).toBe(0)
  })
  it('converts 19-digit nanos precisely', () => {
    expect(nanosToMs('1759132800123456789')).toBe(1759132800123.456)
    expect(nanosToMs('0')).toBeNull()
  })
  it('flattens arrays and kvlists', () => {
    expect(flattenAttrs([kv('a', ['x', 'y']), { key: 'k', value: { kvlistValue: { values: [kv('n', 1)] } } }]))
      .toEqual({ a: ['x', 'y'], k: { n: 1 } })
  })
})

describe('genAiUsage — attribute dialects', () => {
  it('semconv: prefers response model, subtracts cached input', () => {
    const u = genAiUsage({
      'gen_ai.request.model': 'gpt-4o', 'gen_ai.response.model': 'gpt-4o-2024-08-06', 'gen_ai.provider.name': 'OpenAI',
      'gen_ai.usage.input_tokens': 1000, 'gen_ai.usage.output_tokens': 100, 'gen_ai.usage.cache_read.input_tokens': 200,
      'gen_ai.usage.cache_creation.input_tokens': 50, 'gen_ai.operation.name': 'chat', 'gen_ai.conversation.id': 'c1',
    })
    expect(u).toMatchObject({ model: 'gpt-4o-2024-08-06', provider: 'openai', operation: 'chat', input: 750, output: 100, cacheRead: 200, cacheWrite: 50, total: 1100, sessionId: 'c1' })
  })
  it('legacy prompt/completion names (OpenLLMetry)', () => {
    const u = genAiUsage({ 'gen_ai.system': 'anthropic', 'gen_ai.request.model': 'claude-3-5-haiku', 'gen_ai.usage.prompt_tokens': 30, 'gen_ai.usage.completion_tokens': 7, 'llm.request.type': 'chat' })
    expect(u).toMatchObject({ provider: 'anthropic', input: 30, output: 7, total: 37, operation: 'chat' })
    expect(genAiUsage({ 'llm.usage.prompt_tokens': 3, 'llm.usage.completion_tokens': 2 })).toMatchObject({ input: 3, output: 2 })
  })
  it('OpenInference llm.token_count.* and llm.model_name', () => {
    const u = genAiUsage({ 'llm.model_name': 'gpt-4.1', 'llm.token_count.prompt': 900, 'llm.token_count.completion': 90, 'llm.token_count.prompt_details.cache_read': 400, 'openinference.span.kind': 'LLM' })
    expect(u).toMatchObject({ model: 'gpt-4.1', input: 500, cacheRead: 400, output: 90, total: 990, operation: 'llm' })
  })
  it('cache larger than input → input already uncached (Anthropic raw usage)', () => {
    expect(genAiUsage({ 'gen_ai.usage.input_tokens': 20, 'gen_ai.usage.cache_read_input_tokens': 5000 })).toMatchObject({ input: 20, cacheRead: 5000, total: 5020 })
  })
  it('total-only spans are priced as input', () => {
    expect(genAiUsage({ 'embedding.model_name': 'text-embedding-3-small', 'llm.token_count.total': 64 })).toMatchObject({ model: 'text-embedding-3-small', input: 64, total: 64 })
  })
  it('user identity from span or resource; email lower-cased', () => {
    expect(genAiUsage({ 'user.email': 'A@B.io' })).toMatchObject({ userEmail: 'a@b.io', userKey: 'A@B.io' })
    expect(genAiUsage({}, { 'enduser.id': 'svc-7' })).toMatchObject({ userEmail: null, userKey: 'svc-7' })
  })
})

describe('attributes — prompt capture + redaction', () => {
  const a = { 'gen_ai.input.messages': 'secret sk-ant-abcdefghijklmnopqrstuv', 'input.value': 'x', 'gen_ai.prompt.0.content': 'y', 'llm.input_messages.0.message.content': 'z', 'gen_ai.request.model': 'gpt-4o', note: 'mail me: ops@acme.io' }
  it('drops content keys when capture is off, still redacts the rest', () => {
    const out = sanitizeAttributes(a, false)
    expect(Object.keys(out).sort()).toEqual(['gen_ai.request.model', 'note'])
    expect(out.note).toBe('mail me: [REDACTED_EMAIL]')
  })
  it('keeps and redacts content when capture is on', () => {
    const out = sanitizeAttributes(a, true)
    expect(out['gen_ai.input.messages']).toBe('secret [REDACTED_API_KEY]')
    expect(out['input.value']).toBe('x')
  })
  it('recognizes content keys across dialects', () => {
    for (const k of ['gen_ai.prompt', 'gen_ai.completion.0.content', 'gen_ai.output.messages', 'gen_ai.system_instructions', 'output.value', 'llm.output_messages.0.message.content', 'traceloop.entity.input', 'gen_ai.tool.call.arguments'])
      expect(isContentKey(k)).toBe(true)
    for (const k of ['gen_ai.request.model', 'gen_ai.usage.input_tokens', 'gen_ai.tool.name', 'llm.model_name']) expect(isContentKey(k)).toBe(false)
  })
})

describe('parseTraceRequest', () => {
  const spans = parseTraceRequest(FIXTURE, { capturePrompts: false })
  it('parses every span with hex ids, service, status and durations', () => {
    expect(spans).toHaveLength(6)
    const chat = byId(spans, 'a000000000000002')
    expect(chat).toMatchObject({ traceId: TRACE, parentSpanId: 'a000000000000001', service: 'support-bot', spanKind: 3, durationMs: 390, source: 'otlp' })
    expect(chat.startIso).toBe('2025-09-29T08:00:00.010Z')
    expect(chat.attributes['gen_ai.input.messages']).toBeUndefined()
    expect(chat.attributes['otel.scope.name']).toBe('opentelemetry.instrumentation.openai')
    expect(chat.attributes['deployment.environment.name']).toBe('prod')
    expect(chat.attributes['gen_ai.response.finish_reasons']).toEqual(['stop'])
    expect(byId(spans, 'a000000000000003')).toMatchObject({ statusCode: 2, statusMessage: 'timeout' })
    expect(byId(spans, 'a000000000000005')).toMatchObject({ statusCode: 0, statusMessage: 'RateLimitError: slow down' })
    expect(byId(spans, 'c'.repeat(16)).source).toBe('claude_code')
  })
  it('children inherit user + session from ancestors in the same export', () => {
    expect(byId(spans, 'a000000000000002').usage).toMatchObject({ userEmail: 'dev@acme.com', sessionId: 'conv-42' })
    expect(byId(spans, 'a000000000000004').usage).toMatchObject({ userEmail: 'dev@acme.com', sessionId: 'sess-oi' })
    expect(byId(spans, 'c'.repeat(16)).usage.userEmail).toBeNull()
  })
  it('protobuf and JSON exports of the same trace parse identically', () => {
    const viaProto = parseTraceRequest(decodeTraceRequest(encodeTraceRequest(FIXTURE)), { capturePrompts: false })
    // enum strings (kind) are JSON-only; compare the numeric-kind fields that matter
    const strip = (s: any) => ({ ...s, spanKind: undefined })
    expect(viaProto.map(strip)).toEqual(spans.map(strip))
  })
})

describe('agent sources', () => {
  it('only real CLI agents are owned by logs / metrics', () => {
    expect(agentSourceOf({ 'service.name': 'claude-code' })).toBe('claude_code')
    expect(agentSourceOf({ 'service.name': 'codex_cli_rs' })).toBe('codex_cli')
    expect(agentSourceOf({ 'service.name': 'gemini-cli' })).toBe('gemini_cli')
    expect(agentSourceOf({ 'service.name': 'claude-support-bot' })).toBe('otlp')
    expect(agentSourceOf({})).toBe('otlp')
  })
})

describe('leaf mirror + pricing', () => {
  const CTX: KeyCtx = { orgId: 'org1', projectId: 'p1', keyId: 'k1', userId: null, timezone: 'UTC' }
  const spans = priceSpans(parseTraceRequest(FIXTURE, { capturePrompts: false }), [])
  // What trace_usage_parents returns: parents of token-bearing spans.
  const parents = new Set(spans.filter(s => s.usage.total > 0 && s.parentSpanId).map(s => parentKey(s.traceId, s.parentSpanId!)))

  it('mirrors leaves only; skips the aggregate, tools and Claude Code', () => {
    expect(mirrorable(spans, parents).map(s => s.spanId).sort()).toEqual(['a000000000000002', 'a000000000000004', 'a000000000000005'])
  })
  it('prices with lib/mcp/pricing (uncached input + cache at cache rate)', () => {
    const chat = spans.find(s => s.spanId === 'a000000000000002')!
    expect(chat.cost).toBe(costFromPrice(priceFor('gpt-4o-2024-08-06'), 800, 100, 200, 0))
    expect(chat.cost).toBeGreaterThan(0)
  })
  it('org overrides win', () => {
    const [s] = priceSpans(parseTraceRequest(FIXTURE, { capturePrompts: false }).filter(x => x.spanId === 'a000000000000005'),
      [{ model_prefix: 'gpt-4o-mini', input_per_m: 1, output_per_m: 10, cache_read_per_m: null, cache_write_per_m: null } as any])
    expect(s.cost).toBeCloseTo((200 * 1 + 80 * 10) / 1e6, 10)
  })
  it('builds idempotent, metered usage rows keyed by span', () => {
    const chat = spans.find(s => s.spanId === 'a000000000000002')!
    const row = usageRowFor(CTX, 'p1', chat, 'u1')
    expect(row).toMatchObject({
      event_id: spanEventId('org1', chat), source: 'otlp', cost_basis: 'metered', model: 'gpt-4o-2024-08-06',
      input_tokens: 800, cache_read_tokens: 200, total_tokens: 1100, user_id: 'u1', correlation_id: `trace:${TRACE}`,
      created_at: '2025-09-29T08:00:00.400Z', latency_ms: 390,
    })
    const oi = spans.find(s => s.spanId === 'a000000000000004')!
    expect(usageRowFor(CTX, 'p1', oi, null).session_id).toBe('sess-oi')
  })
  it('span rows carry status, service and tokens; duplicates collapse', () => {
    const row = spanRow('org1', spans.find(s => s.spanId === 'a000000000000003')!, null)
    expect(row).toMatchObject({ status_code: 2, service_name: 'support-bot', kind: 'execute_tool', total_tokens: 0 })
    expect(dedupeSpans([...spans, ...spans])).toHaveLength(spans.length)
  })
})

describe('prompt content is stored in full', () => {
  it('keeps a 50,000-char prompt attribute untruncated but still trims other attributes', async () => {
    const { sanitizeAttributes } = await import('./genai')
    const long = 'x'.repeat(50_000)
    const out = sanitizeAttributes({ 'gen_ai.prompt': long, 'some.other': long }, true)
    expect(out['gen_ai.prompt']).toBe(long)
    expect(String(out['some.other']).endsWith('…[truncated]')).toBe(true)
  })
})

describe('trace capture level (migration 025)', () => {
  it('problemOf: errors, exceptions, HTTP >= 400, warn levels, truncated / filtered responses', async () => {
    const { problemOf } = await import('./genai')
    expect(problemOf(2, {}, false)).toBe('error')
    expect(problemOf(0, {}, true)).toBe('error')
    expect(problemOf(0, { 'http.response.status_code': 429 }, false)).toBe('warning')
    expect(problemOf(0, { 'log.level': 'WARN' }, false)).toBe('warning')
    expect(problemOf(0, { 'gen_ai.response.finish_reasons': ['length'] }, false)).toBe('warning')
    expect(problemOf(0, { 'gen_ai.response.finish_reasons': ['stop'], 'http.response.status_code': 200 }, false)).toBeNull()
  })

  it('rowsForCapture: errors mode keeps problem traces in full, cost skeletons for the rest, drops the rest', async () => {
    const { rowsForCapture } = await import('./traces')
    const spans = [
      { traceId: 'ok', problem: null, usage: { total: 500 } },          // LLM span in a healthy trace → skeleton
      { traceId: 'ok', problem: null, usage: { total: 0 } },            // plain span in a healthy trace → dropped
      { traceId: 'bad', problem: 'error' as const, usage: { total: 0 } },
      { traceId: 'bad', problem: null, usage: { total: 900 } },         // same trace as an error → full
    ]
    const rows = spans.map((s, i) => ({ id: i, attributes: { 'gen_ai.prompt': 'secret' }, status_message: 'x', user_email: 'a@b.c' }))
    const out = rowsForCapture(spans, rows, 'errors')
    expect(out.map(r => [r.id, r.detail])).toEqual([[0, false], [2, true], [3, true]])
    expect(out[0]).toMatchObject({ attributes: {}, status_message: null, user_email: null })
    expect(out[1].attributes).toEqual({ 'gen_ai.prompt': 'secret' })
    expect(rowsForCapture(spans, rows, 'all').every(r => r.detail)).toBe(true)
  })
})

describe('coding-agent internal tracing is dropped (OpenCode SQL / session spans)', () => {
  it('drops zero-token, non-problem spans from CLI agents even in "all" mode; keeps their problem traces', async () => {
    const { rowsForCapture } = await import('./traces')
    const spans = [
      { traceId: 'oc1', problem: null, usage: { total: 0 }, source: 'opencode' },        // sql.execute → dropped
      { traceId: 'oc2', problem: 'error' as const, usage: { total: 0 }, source: 'opencode' }, // failing → kept
      { traceId: 'app', problem: null, usage: { total: 0 }, source: 'otlp' },            // your app, 'all' → kept
    ]
    const rows = spans.map((_, i) => ({ id: i, attributes: {} }))
    expect(rowsForCapture(spans, rows, 'all').map(r => r.id)).toEqual([1, 2])
    expect(rowsForCapture(spans, rows, 'errors').map(r => r.id)).toEqual([1])
  })
})
