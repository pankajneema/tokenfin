import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import protobuf from 'protobufjs'

import { attrVal, attrsToMap, nanoToIso, num } from './attrs'
import { tokenFieldFor, detectSource, costBasisFor, isRecognizedMetric, isDeltaTemporality } from './mapping'
import { readOtlp } from './decode'
import { decodeLogsProto } from './proto'
import { normalizeLogs, scanMetrics, type UsageRow } from './normalize'
import { persistRows } from './persist'
import type { KeyCtx } from './auth'

const CTX: KeyCtx = { orgId: 'org1', projectId: 'proj1', keyId: 'key1', userId: null }

// ── OTLP/JSON builders ───────────────────────────────────────────────────────
const kv = (key: string, value: any) => ({ key, value })
const S = (s: string) => ({ stringValue: s })
const I = (n: number) => ({ intValue: n })
const D = (n: number) => ({ doubleValue: n })

function record(attrs: Record<string, unknown>, time = 1752566400000000, eventName = 'claude_code.api_request') {
  const attributes = Object.entries(attrs).map(([k, v]) =>
    typeof v === 'number'
      ? kv(k, Number.isInteger(v) ? I(v) : D(v))
      : kv(k, S(String(v))))
  return { timeUnixNano: time, eventName, attributes }
}
function logsBody(records: any[], serviceName = 'claude-code') {
  return { resourceLogs: [{ resource: { attributes: [kv('service.name', S(serviceName))] }, scopeLogs: [{ logRecords: records }] }] }
}
const FULL = {
  model: 'claude-opus-4-8', input_tokens: 1200, output_tokens: 340,
  cache_read_tokens: 800, cache_creation_tokens: 64, cost_usd: 0.0512,
  request_id: 'req_abc', 'prompt.id': 'pid-1', 'user.email': 'dev@acme.com', 'session.id': 'sess-9',
}

// ── attrs ────────────────────────────────────────────────────────────────────
describe('attrs', () => {
  it('attrVal reads each OTLP value kind', () => {
    expect(attrVal(S('x'))).toBe('x')
    expect(attrVal(I(5))).toBe(5)
    expect(attrVal(D(1.5))).toBe(1.5)
    expect(attrVal({ boolValue: true })).toBe(true)
    expect(attrVal(undefined)).toBeUndefined()
  })
  it('attrsToMap flattens key/value pairs', () => {
    expect(attrsToMap([kv('a', S('1')), kv('b', I(2))])).toEqual({ a: '1', b: 2 })
  })
  it('nanoToIso converts and guards', () => {
    expect(nanoToIso(1752566400000000)).toBe(new Date(1752566400).toISOString())
    expect(nanoToIso(0)).toBeNull()
    expect(nanoToIso(undefined)).toBeNull()
  })
  it('num tolerates strings and junk', () => {
    expect(num('5')).toBe(5); expect(num(undefined)).toBe(0); expect(num('x')).toBe(0)
  })
})

// ── mapping ──────────────────────────────────────────────────────────────────
describe('mapping', () => {
  it('tokenFieldFor normalizes camelCase, snake, and GenAI names', () => {
    expect(tokenFieldFor('input')).toBe('input_tokens')
    expect(tokenFieldFor('cacheRead')).toBe('cache_read_tokens')
    expect(tokenFieldFor('cacheCreation')).toBe('cache_write_tokens')
    expect(tokenFieldFor('cached')).toBe('cache_read_tokens')
    expect(tokenFieldFor('reasoning')).toBe('reasoning_tokens')
    expect(tokenFieldFor('prompt')).toBe('input_tokens')
    expect(tokenFieldFor('nonsense')).toBeNull()
  })
  it('detectSource uses service.name then a hint', () => {
    expect(detectSource({ 'service.name': 'claude-code' })).toBe('claude_code')
    expect(detectSource({ 'service.name': 'codex' })).toBe('codex_cli')
    expect(detectSource({}, 'gen_ai.client.token.usage')).toBe('gemini_cli')
    expect(detectSource({})).toBe('otlp')
  })
  it('costBasisFor is notional for CLI agents', () => {
    expect(costBasisFor('claude_code')).toBe('notional')
  })
  it('temporality + recognition helpers', () => {
    expect(isDeltaTemporality(1)).toBe(true)
    expect(isDeltaTemporality(2)).toBe(false)
    expect(isRecognizedMetric('claude_code.token.usage')).toBe(true)
    expect(isRecognizedMetric('gen_ai.anything')).toBe(true)
    expect(isRecognizedMetric('some.random.metric')).toBe(false)
  })
})

// ── normalizeLogs ────────────────────────────────────────────────────────────
describe('normalizeLogs', () => {
  it('maps a full api_request event to one notional row', () => {
    const [r] = normalizeLogs(logsBody([record(FULL)]), CTX)
    expect(r.event_id).toBe('claude_code:req_abc')
    expect(r.source).toBe('claude_code')
    expect(r.input_tokens).toBe(1200)
    expect(r.output_tokens).toBe(340)
    expect(r.cache_read_tokens).toBe(800)
    expect(r.cache_write_tokens).toBe(64)
    expect(r.cost_basis).toBe('notional')
    expect(r.cost_usd).toBeGreaterThan(0)      // server-priced
    expect(r.correlation_id).toBe('pid-1')
    expect(r.user_email).toBe('dev@acme.com')
    expect(r.session_id).toBe('sess-9')
  })
  it('keeps cache-only turns (tokens > 0 via cache)', () => {
    const rows = normalizeLogs(logsBody([record({ model: 'claude-opus-4-8', input_tokens: 0, output_tokens: 0, cache_read_tokens: 500, request_id: 'r' })]), CTX)
    expect(rows).toHaveLength(1)
    expect(rows[0].cache_read_tokens).toBe(500)
  })
  it('skips records with no model or no tokens', () => {
    expect(normalizeLogs(logsBody([record({ input_tokens: 10, output_tokens: 5, request_id: 'r' })]), CTX)).toHaveLength(0) // no model
    expect(normalizeLogs(logsBody([record({ model: 'm', input_tokens: 0, output_tokens: 0, request_id: 'r' })]), CTX)).toHaveLength(0) // no tokens
  })
  it('skips error / refusal events even if tokens present', () => {
    const rows = normalizeLogs(logsBody([record({ model: 'm', input_tokens: 5, output_tokens: 5 }, 1e15, 'claude_code.api_error')]), CTX)
    expect(rows).toHaveLength(0)
  })
  it('derives a deterministic event_id when no request_id (replay-safe)', () => {
    const body = logsBody([record({ model: 'claude-opus-4-8', input_tokens: 5, output_tokens: 5, 'prompt.id': 'p9' })])
    const a = normalizeLogs(body, CTX)[0].event_id
    const b = normalizeLogs(body, CTX)[0].event_id
    expect(a).toBe(b)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })
  it('emits one row per record with distinct ids', () => {
    const rows = normalizeLogs(logsBody([record({ ...FULL, request_id: 'r1' }), record({ ...FULL, request_id: 'r2' })]), CTX)
    expect(rows.map(r => r.event_id)).toEqual(['claude_code:r1', 'claude_code:r2'])
  })
  it('falls back to GenAI semconv attribute names', () => {
    const [r] = normalizeLogs(logsBody([record({ 'gen_ai.request.model': 'gemini-x', 'gen_ai.usage.input_tokens': 11, 'gen_ai.usage.output_tokens': 7, request_id: 'g1' })], 'gemini-cli'), CTX)
    expect(r.model).toBe('gemini-x')
    expect(r.input_tokens).toBe(11)
    expect(r.output_tokens).toBe(7)
  })
  it('prices server-side and IGNORES the client-reported cost (spec: never client-supplied)', () => {
    // Unknown model → server default pricing (10*2 + 10*8)/1e6 = 0.0001, NOT the event's 0.5.
    const [r] = normalizeLogs(logsBody([record({ model: 'totally-unknown-model-xyz', input_tokens: 10, output_tokens: 10, cost_usd: 0.5, request_id: 'u1' })]), CTX)
    expect(r.cost_usd).not.toBeCloseTo(0.5, 3)
    expect(r.cost_usd).toBeGreaterThan(0)
  })
})

// ── scanMetrics (health only) ─────────────────────────────────────────────────
describe('scanMetrics', () => {
  const metricsBody = (metrics: any[]) => ({ resourceMetrics: [{ resource: { attributes: [] }, scopeMetrics: [{ metrics }] }] })
  it('flags delta temporality on a recognized metric', () => {
    const h = scanMetrics(metricsBody([{ name: 'claude_code.token.usage', sum: { dataPoints: [], aggregationTemporality: 1 } }]))
    expect(h.recognized).toBe(1)
    expect(h.sawDelta).toBe(true)
  })
  it('does not flag cumulative', () => {
    const h = scanMetrics(metricsBody([{ name: 'claude_code.token.usage', sum: { dataPoints: [], aggregationTemporality: 2 } }]))
    expect(h.sawDelta).toBe(false)
  })
  it('reports unrecognized metric names (never silent)', () => {
    const h = scanMetrics(metricsBody([{ name: 'vendor.renamed.metric', sum: { dataPoints: [] } }]))
    expect(h.unrecognized).toContain('vendor.renamed.metric')
  })
})

// ── protobuf decode round-trips to the same rows as JSON ──────────────────────
describe('decode (protobuf)', () => {
  const protoSrc = fs.readFileSync(path.join(__dirname, 'proto.ts'), 'utf8')
  const OTLP = protoSrc.match(/const OTLP_PROTO = `([\s\S]*?)`/)![1]
  const root = protobuf.parse(OTLP, { keepCase: false }).root
  const LogsReq = root.lookupType('tokenfin.otlp.ExportLogsServiceRequest')

  it('decodeLogsProto yields the same normalized row as the JSON path', () => {
    const body = logsBody([record(FULL)])
    const buf = LogsReq.encode(LogsReq.fromObject(body)).finish()
    const decoded = decodeLogsProto(buf)
    const pb = normalizeLogs(decoded, CTX)[0]
    const json = normalizeLogs(body, CTX)[0]
    expect(pb.event_id).toBe(json.event_id)
    expect(pb.input_tokens).toBe(1200)
    expect(pb.cache_write_tokens).toBe(64)
  })

  it('readOtlp parses a JSON request body', async () => {
    const body = logsBody([record(FULL)])
    const req: any = { headers: { get: () => 'application/json' }, json: async () => body }
    expect(await readOtlp(req, 'logs')).toEqual(body)
  })
})

// ── persist (idempotency + notional never rolls into usage_agg) ───────────────
function mockAdmin({ projectId = 'proj1' as string | null, inserted = [{ id: 'ev1' }] as any[] } = {}) {
  const rpcCalls: any[] = []
  const upsertCalls: any[] = []
  const admin: any = {
    from(table: string) {
      let isUpsert = false
      const b: any = {
        select: () => (isUpsert ? Promise.resolve({ data: inserted, error: null }) : b),
        eq: () => b, order: () => b, limit: () => b, not: () => b, update: () => b,
        maybeSingle: () => Promise.resolve({ data: table === 'projects' ? (projectId ? { id: projectId } : null) : null, error: null }),
        upsert: (rec: any) => { isUpsert = true; upsertCalls.push(rec); return b },
      }
      return b
    },
    rpc: (name: string, params: any) => { rpcCalls.push({ name, params }); return Promise.resolve({ error: null }) },
    __rpcCalls: rpcCalls, __upsertCalls: upsertCalls,
  }
  return admin
}

const meteredRow: UsageRow = {
  event_id: 'm1', ts: new Date(1752566400000).toISOString(), source: 'ingest',
  provider_request_id: null, correlation_id: null, model: 'claude-opus-4-8',
  input_tokens: 10, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0,
  cost_usd: 0.01, cost_basis: 'metered', user_email: null, session_id: null,
}

describe('persistRows', () => {
  it('notional rows insert but NEVER roll into usage_agg', async () => {
    const admin = mockAdmin()
    const rows = normalizeLogs(logsBody([record(FULL)]), CTX)  // notional
    const res = await persistRows(admin, CTX, rows)
    expect(res.inserted).toBe(1)
    expect(admin.__rpcCalls).toHaveLength(0)  // metered totals stay clean
  })
  it('metered rows DO roll into usage_agg', async () => {
    const admin = mockAdmin()
    const res = await persistRows(admin, CTX, [meteredRow])
    expect(res.inserted).toBe(1)
    expect(admin.__rpcCalls).toHaveLength(1)
    expect(admin.__rpcCalls[0].name).toBe('upsert_usage_agg')
  })
  it('a duplicate (empty upsert result) counts as duplicate and skips agg', async () => {
    const admin = mockAdmin({ inserted: [] })
    const res = await persistRows(admin, CTX, [meteredRow])
    expect(res).toEqual({ inserted: 0, duplicate: 1 })
    expect(admin.__rpcCalls).toHaveLength(0)
  })
})
