import { describe, it, expect, beforeEach } from 'vitest'
import { deriveProductivity, memoryMetricState, type MetricState } from './metrics'
import { normalizeLogs, normalizeApiErrors, scanMetrics } from './normalize'
import { persistRows } from './persist'
import { repoFrom, allocationTagsFrom, userKeyFrom } from './attrs'
import { isRecognizedMetric } from './mapping'
import { matchOverride, priceWithOverrides, invalidateOrgPrices, type OrgModelPrice } from '@/lib/pricing-overrides'
import { computeCost } from '@/lib/mcp/pricing'
import type { KeyCtx } from './auth'

const CTX: KeyCtx = { orgId: 'org1', projectId: 'proj1', keyId: 'key1', userId: 'u-1' }
const S = (s: string) => ({ stringValue: s })
const kv = (key: string, v: string | number) =>
  ({ key, value: typeof v === 'number' ? (Number.isInteger(v) ? { intValue: v } : { doubleValue: v }) : S(v) })

function fakeState(): MetricState & { m: Map<string, number> } {
  return memoryMetricState()
}

const RES = [kv('service.name', 'claude-code'), kv('user.email', 'dev@acme.com'), kv('vcs.repository.name', 'atlas')]
const mBody = (metrics: any[], res = RES) => ({ resourceMetrics: [{ resource: { attributes: res }, scopeMetrics: [{ metrics }] }] })
const sum = (name: string, temporality: 1 | 2, dataPoints: any[]) => ({ name, sum: { aggregationTemporality: temporality, isMonotonic: true, dataPoints } })
const T0 = 1_790_000_000_000_000_000   // ns
const pt = (value: number, attrs: Record<string, string> = {}, o: { time?: number; start?: number } = {}) => ({
  startTimeUnixNano: o.start ?? T0 - 3600e9,        // process started an hour ago (not "fresh")
  timeUnixNano: o.time ?? T0,
  ...(Number.isInteger(value) ? { asInt: value } : { asDouble: value }),
  attributes: [kv('session.id', 's1'), ...Object.entries(attrs).map(([k, v]) => kv(k, v))],
})

// One realistic Claude Code export at a given set of cumulative values.
const ccExport = (t: 1 | 2, v: { add: number; rem: number; commits: number; prs: number; acc: number; rej: number; active: number; sessions: number }, time = T0) => mBody([
  sum('claude_code.lines_of_code.count', t, [pt(v.add, { type: 'added' }, { time }), pt(v.rem, { type: 'removed' }, { time })]),
  sum('claude_code.commit.count', t, [pt(v.commits, {}, { time })]),
  sum('claude_code.pull_request.count', t, [pt(v.prs, {}, { time })]),
  sum('claude_code.code_edit_tool.decision', t, [
    pt(v.acc, { decision: 'accept', tool_name: 'Edit', language: 'TypeScript' }, { time }),
    pt(v.rej, { decision: 'reject', tool_name: 'Edit', language: 'TypeScript' }, { time }),
  ]),
  sum('claude_code.active_time.total', t, [pt(v.active, { type: 'user' }, { time }), pt(v.active, { type: 'cli' }, { time })]),
  sum('claude_code.session.count', t, [pt(v.sessions, {}, { time })]),
  sum('claude_code.token.usage', t, [pt(999, { type: 'input', model: 'claude-opus-4-8' }, { time })]),
])

describe('deriveProductivity', () => {
  it('delta temporality: each value is the increment', async () => {
    const r = await deriveProductivity(ccExport(1, { add: 40, rem: 5, commits: 1, prs: 0, acc: 3, rej: 1, active: 12.5, sessions: 1 }), CTX, fakeState())
    expect(r.deltas).toHaveLength(1)
    expect(r.deltas[0]).toMatchObject({
      user_key: 'dev@acme.com', user_id: 'u-1', repo: 'atlas',
      lines_added: 40, lines_removed: 5, commits: 1, pull_requests: 0,
      edits_accepted: 3, edits_rejected: 1, active_seconds: 25, sessions: 1,
    })
  })

  it('cumulative: first sight of an old process baselines, the next export emits the diff', async () => {
    const st = fakeState()
    const first = await deriveProductivity(ccExport(2, { add: 100, rem: 10, commits: 2, prs: 1, acc: 5, rej: 0, active: 60, sessions: 1 }), CTX, st)
    expect(first.deltas).toHaveLength(0)
    expect(first.skippedFirstSeen).toBeGreaterThan(0)
    const second = await deriveProductivity(ccExport(2, { add: 130, rem: 12, commits: 3, prs: 1, acc: 7, rej: 1, active: 90, sessions: 1 }, T0 + 60e9), CTX, st)
    expect(second.deltas).toHaveLength(1)
    expect(second.deltas[0]).toMatchObject({
      lines_added: 30, lines_removed: 2, commits: 1, pull_requests: 0,
      edits_accepted: 2, edits_rejected: 1, active_seconds: 60, sessions: 0,
    })
  })

  it('cumulative: a series that started recently is counted in full (no lost first session)', async () => {
    const body = mBody([sum('claude_code.session.count', 2, [pt(1, {}, { start: T0 - 60e9 })])])
    const r = await deriveProductivity(body, CTX, fakeState())
    expect(r.deltas[0].sessions).toBe(1)
  })

  it('cumulative: a NEW series from an already-seen process counts in full', async () => {
    const st = fakeState()
    await deriveProductivity(ccExport(2, { add: 1, rem: 0, commits: 0, prs: 0, acc: 0, rej: 0, active: 1, sessions: 1 }), CTX, st)
    // /clear → new session.id → new series, same process start time
    const body = mBody([sum('claude_code.commit.count', 2, [{ ...pt(2), attributes: [kv('session.id', 's2')] }])])
    const r = await deriveProductivity(body, CTX, st)
    expect(r.deltas[0].commits).toBe(2)
  })

  it('cumulative counter reset emits nothing', async () => {
    const st = fakeState()
    const b = (v: number) => mBody([sum('claude_code.commit.count', 2, [pt(v)])])
    await deriveProductivity(b(5), CTX, st)
    const r = await deriveProductivity(b(2), CTX, st)
    expect(r.deltas).toHaveLength(0)
  })

  it('splits by repo and falls back to account uuid, then "unknown"', async () => {
    const res = [kv('user.account_uuid', 'acct-9'), kv('vcs.repository.url.full', 'https://github.com/acme/billing.git')]
    const r = await deriveProductivity(mBody([sum('claude_code.commit.count', 1, [pt(1)])], res), CTX, fakeState())
    expect(r.deltas[0]).toMatchObject({ user_key: 'acct-9', repo: 'billing' })
    const r2 = await deriveProductivity(mBody([sum('claude_code.commit.count', 1, [pt(1)])], []), CTX, fakeState())
    expect(r2.deltas[0]).toMatchObject({ user_key: 'unknown', repo: '' })
  })

  it('productivity metrics are recognized (no "unrecognized" warning)', () => {
    for (const n of ['claude_code.lines_of_code.count', 'claude_code.commit.count', 'claude_code.pull_request.count',
      'claude_code.code_edit_tool.decision', 'claude_code.active_time.total', 'claude_code.session.count']) {
      expect(isRecognizedMetric(n)).toBe(true)
    }
    expect(scanMetrics(ccExport(1, { add: 1, rem: 1, commits: 1, prs: 1, acc: 1, rej: 1, active: 1, sessions: 1 })).unrecognized).toEqual([])
  })
})

// ── logs enrichment ──────────────────────────────────────────────────────────
const rec = (attrs: Record<string, string | number>, eventName = 'claude_code.api_request', time = T0) =>
  ({ timeUnixNano: time, eventName, attributes: Object.entries(attrs).map(([k, v]) => kv(k, v)) })
const lBody = (records: any[], res: any[] = [kv('service.name', 'claude-code')]) =>
  ({ resourceLogs: [{ resource: { attributes: res }, scopeLogs: [{ logRecords: records }] }] })
const API_REQ = {
  model: 'claude-opus-4-8', input_tokens: 1000, output_tokens: 200, cache_read_tokens: 0, cache_creation_tokens: 0,
  cost_usd: 0.0199, duration_ms: 2300, request_id: 'req_1', 'user.email': 'dev@acme.com', 'session.id': 's1',
  query_source: 'subagent', 'agent.name': 'reviewer', 'skill.name': 'pdf', 'mcp_server.name': 'github',
}

describe('normalizeLogs enrichment', () => {
  it('captures vendor cost without letting it replace the server-side price', () => {
    const [row] = normalizeLogs(lBody([rec(API_REQ)]), CTX)
    expect(row.vendor_cost_usd).toBe(0.0199)
    expect(row.cost_usd).toBe(computeCost('claude-opus-4-8', 1000, 200))
    expect(row.price_known).toBe(true)
    expect(row).toMatchObject({ query_source: 'subagent', agent_name: 'reviewer', skill_name: 'pdf', mcp_server: 'github' })
  })

  it('reads repo + cost-allocation tags from resource attributes', () => {
    const res = [kv('service.name', 'claude-code'), kv('vcs.repository.name', 'atlas'),
      kv('team.name', 'platform'), kv('cost_center', 'cc-42'), kv('department', 'eng'), kv('project', 'apollo'),
      kv('host.name', 'mbp')]
    const [row] = normalizeLogs(lBody([rec(API_REQ)], res), CTX)
    expect(row.repo).toBe('atlas')
    expect(row.extra_tags).toEqual({ 'team.name': 'platform', cost_center: 'cc-42', department: 'eng', project: 'apollo' })
  })

  it('attribute helpers', () => {
    expect(repoFrom({ 'vcs.repository.url.full': 'git@github.com:acme/api.git' })).toBe('api')
    expect(repoFrom({ repository: 'mono' })).toBe('mono')
    expect(repoFrom({})).toBe('')
    expect(allocationTagsFrom({ 'cost.center': 'x', 'team.id': 7, other: 'y' })).toEqual({ 'cost.center': 'x', 'team.id': '7' })
    expect(userKeyFrom({ 'user.email': 'a@b.c', 'user.account_uuid': 'u' })).toBe('a@b.c')
  })

  it('counts api_error events per user·model·day and never creates usage rows', () => {
    const err = (model: string) => rec({ model, error: 'overloaded', status_code: 529, 'user.email': 'dev@acme.com' }, 'claude_code.api_error')
    const body = lBody([err('claude-opus-4-8'), err('claude-opus-4-8'), err('claude-haiku-4-5'), rec(API_REQ)])
    expect(normalizeLogs(body, CTX)).toHaveLength(1)   // only the api_request
    const errs = normalizeApiErrors(body)
    expect(errs).toHaveLength(2)
    expect(errs.find(e => e.model === 'claude-opus-4-8')).toMatchObject({ user_key: 'dev@acme.com', errors: 2 })
    expect(errs.find(e => e.model === 'claude-haiku-4-5')?.errors).toBe(1)
  })
})

// ── custom price overrides ───────────────────────────────────────────────────
const OVR: OrgModelPrice[] = [
  { model_prefix: 'claude-opus', input_per_m: 1, output_per_m: 2, cache_read_per_m: null, cache_write_per_m: null },
  { model_prefix: 'claude-opus-4-8', input_per_m: 3, output_per_m: 4, cache_read_per_m: 0.5, cache_write_per_m: null },
]

function adminWithPrices(prices: OrgModelPrice[]) {
  const upserts: any[] = []
  const admin: any = {
    from(table: string) {
      let isUpsert = false
      const b: any = {
        select: () => (isUpsert ? Promise.resolve({ data: [{ id: 'e' }], error: null }) : b),
        eq: () => (table === 'org_model_prices' ? Promise.resolve({ data: prices, error: null }) : b),
        order: () => b, limit: () => b,
        maybeSingle: () => Promise.resolve({ data: table === 'projects' ? { id: 'proj1' } : null, error: null }),
        upsert: (r: any) => { isUpsert = true; upserts.push(r); return b },
      }
      return b
    },
    rpc: () => Promise.resolve({ error: null }),
    __upserts: upserts,
  }
  return admin
}

describe('price overrides', () => {
  beforeEach(() => invalidateOrgPrices())

  it('longest prefix wins, case-insensitive', () => {
    expect(matchOverride(OVR, 'Claude-Opus-4-8-20260101')?.model_prefix).toBe('claude-opus-4-8')
    expect(matchOverride(OVR, 'claude-opus-4-7')?.model_prefix).toBe('claude-opus')
    expect(matchOverride(OVR, 'gpt-5')).toBeNull()
  })

  it('override beats list price; list price otherwise; fallback flags priceKnown=false', () => {
    const t = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 0 }
    expect(priceWithOverrides(OVR, 'claude-opus-4-8', t)).toEqual({ cost: 7.5, priceKnown: true, overridePrefix: 'claude-opus-4-8' })
    expect(priceWithOverrides(OVR, 'gpt-5', t).cost).toBe(computeCost('gpt-5', 1e6, 1e6, 1e6))
    expect(priceWithOverrides(OVR, 'totally-new-model', t).priceKnown).toBe(false)
  })

  it('persistRows re-prices with the org override and tags unknown-price rows', async () => {
    const admin = adminWithPrices([OVR[1]])
    const rows = normalizeLogs(lBody([rec(API_REQ), rec({ ...API_REQ, model: 'mystery-9', request_id: 'req_2' })]), CTX)
    await persistRows(admin, CTX, rows)
    const [opus, mystery] = admin.__upserts[0]   // one array upsert per export
    expect(opus.cost_usd).toBe(+((1000 * 3 + 200 * 4) / 1e6).toFixed(8))
    expect(opus.vendor_cost_usd).toBe(0.0199)
    expect(opus.tags.price_known).toBeUndefined()
    expect(mystery.cost_usd).toBe(computeCost('mystery-9', 1000, 200))   // $2/$8 default
    expect(mystery.tags.price_known).toBe('false')
    expect(opus.tags.source).toBe('claude_code')
  })
})
