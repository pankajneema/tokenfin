import { describe, it, expect, vi } from 'vitest'
import { parseQuestion, resolvePeriod, looksLikeQuestion, parsePeriod } from './intents'
import { answerIntent, exploreLink, type AskData } from './answer'
import { ask } from './index'
import { mapQuestionWithLLM, extractJson } from './llm'
import type { DashBreakdown } from '@/lib/rollups'

describe('parseQuestion', () => {
  const cases: [string, unknown][] = [
    ['How much did we spend last week?', { kind: 'total', period: { kind: 'last_week' } }],
    ['total spend today', { kind: 'total', period: { kind: 'today' } }],
    ['spend by model this month', { kind: 'spend_by', dim: 'model', period: { kind: 'this_month' } }],
    ['cost per project over the last 7 days', { kind: 'spend_by', dim: 'project', period: { kind: 'last_n_days', n: 7 } }],
    ['model breakdown yesterday', { kind: 'spend_by', dim: 'model', period: { kind: 'yesterday' } }],
    ['daily spend by day last 2 weeks', { kind: 'spend_by', dim: 'day', period: { kind: 'last_n_days', n: 14 } }],
    ['top 5 models', { kind: 'top', dim: 'model', n: 5, period: { kind: 'last_n_days', n: 30 } }],
    ['top ten projects last month', { kind: 'top', dim: 'project', n: 10, period: { kind: 'last_month' } }],
    ['top members this week', { kind: 'top', dim: 'member', n: 5, period: { kind: 'this_week' } }],
    ['who spent the most yesterday?', { kind: 'top', dim: 'member', n: 5, period: { kind: 'yesterday' } }],
    ['which model cost the most last week', { kind: 'top', dim: 'model', n: 1, period: { kind: 'last_week' } }],
    ['biggest spenders', { kind: 'top', dim: 'member', n: 5, period: { kind: 'last_n_days', n: 30 } }],
    ['compare this week vs last week', { kind: 'compare', unit: 'week' }],
    ['how does this month compare to last month?', { kind: 'compare', unit: 'month' }],
    ['MTD', { kind: 'mtd' }],
    ['what is our month-to-date spend', { kind: 'mtd' }],
    ['projected spend', { kind: 'mtd' }],
    ['are we on track this month?', { kind: 'mtd' }],
    ['How much did Alice spend last week?', { kind: 'member_spend', member: 'alice', period: { kind: 'last_week' } }],
    ['how much has bob@acme.io spent this month', { kind: 'member_spend', member: 'bob@acme.io', period: { kind: 'this_month' } }],
    ["carol's spend yesterday", { kind: 'member_spend', member: 'carol', period: { kind: 'yesterday' } }],
    ['how much did I spend today', { kind: 'member_spend', member: 'me', period: { kind: 'today' } }],
  ]
  for (const [q, want] of cases) it(q, () => expect(parseQuestion(q)).toEqual(want))

  it('returns null for non-spend text', () => {
    expect(parseQuestion('api keys')).toBeNull()
    expect(parseQuestion('')).toBeNull()
    expect(parseQuestion('hello there')).toBeNull()
  })

  it('"how much did we spend" is an org total, not a member', () => {
    expect(parseQuestion('how much did we spend this month')).toEqual({ kind: 'total', period: { kind: 'this_month' } })
  })
})

describe('periods', () => {
  // 2026-09-29 is a Tuesday.
  const today = '2026-09-29'
  it('resolves calendar periods in org-local day labels', () => {
    expect(resolvePeriod({ kind: 'this_week' }, today)).toMatchObject({ from: '2026-09-28', to: today })
    expect(resolvePeriod({ kind: 'last_week' }, today)).toMatchObject({ from: '2026-09-21', to: '2026-09-27' })
    expect(resolvePeriod({ kind: 'this_month' }, today)).toMatchObject({ from: '2026-09-01', to: today })
    expect(resolvePeriod({ kind: 'last_month' }, today)).toMatchObject({ from: '2026-08-01', to: '2026-08-31' })
    expect(resolvePeriod({ kind: 'last_n_days', n: 7 }, today)).toMatchObject({ from: '2026-09-23', to: today })
    expect(resolvePeriod({ kind: 'last_month' }, '2026-03-15')).toMatchObject({ from: '2026-02-01', to: '2026-02-28' })
  })
  it('week starts Monday even on a Sunday', () => {
    expect(resolvePeriod({ kind: 'this_week' }, '2026-10-04')).toMatchObject({ from: '2026-09-28' })
  })
  it('parses "past 3 months" as days', () => {
    expect(parsePeriod('past 3 months')).toEqual({ kind: 'last_n_days', n: 90 })
  })
})

describe('looksLikeQuestion', () => {
  it('distinguishes questions from page searches', () => {
    expect(looksLikeQuestion('how much did we spend?')).toBe(true)
    expect(looksLikeQuestion('top 5 models')).toBe(true)
    expect(looksLikeQuestion('keys')).toBe(false)
    expect(looksLikeQuestion('alerts')).toBe(false)
  })
})

/* ── Answers with a fake rollups layer ── */
const totals = (cost: number, metered = cost, notional = 0) => ({ cost_usd: cost, metered_cost_usd: metered, notional_cost_usd: notional, requests: 10, total_tokens: 1000 })
const row = (key: string, cost: number) => ({
  key, cost_usd: cost, metered_cost_usd: cost, notional_cost_usd: 0, vendor_cost_usd: 0, requests: 3,
  input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0, total_tokens: 500,
  avg_latency_ms: null, active_days: 1, users: 1,
})
function fakeData(rows: ReturnType<typeof row>[] = []) {
  const summary = vi.fn(async (from: string) => from < '2026-09-01' ? totals(50) : totals(80, 60, 20))
  const breakdown = vi.fn(async (): Promise<DashBreakdown> => ({ rows, other: null, total_keys: rows.length }))
  const data: AskData = { summary, breakdown, projectName: id => ({ p1: 'Checkout' } as Record<string, string>)[id] ?? id }
  return { data, summary, breakdown }
}
const orgCtx = { today: '2026-09-29', scopeUserKey: null }

describe('answerIntent', () => {
  it('total: shows metered and notional apart and links to explore', async () => {
    const { data, summary } = fakeData()
    const a = await answerIntent({ kind: 'total', period: { kind: 'this_month' } }, data, orgCtx)
    expect(summary).toHaveBeenCalledWith('2026-09-01', '2026-09-29', {})
    expect(a.answer).toContain('$80.00')
    expect(a.answer).toContain('$60.00 metered')
    expect(a.answer).toContain('notional')
    expect(a.link).toBe('/dashboard/explore?dim=day&range=custom&from=2026-09-01&to=2026-09-29')
  })

  it('top: slices to N, maps project names', async () => {
    const { data, breakdown } = fakeData([row('p1', 9), row('p2', 5), row('p3', 1)])
    const a = await answerIntent({ kind: 'top', dim: 'project', n: 2, period: { kind: 'last_n_days', n: 30 } }, data, orgCtx)
    expect(breakdown).toHaveBeenCalledWith('2026-08-31', '2026-09-29', 'project', {}, 2)
    expect(a.table!.rows).toHaveLength(2)
    expect(a.table!.rows[0][0]).toBe('Checkout')
    expect(a.answer).toContain('Checkout leads')
    expect(a.link).toContain('dim=project')
  })

  it('compare: same span of the previous week', async () => {
    const { data, summary } = fakeData()
    const a = await answerIntent({ kind: 'compare', unit: 'week' }, data, orgCtx)
    expect(summary).toHaveBeenCalledWith('2026-09-28', '2026-09-29', {})
    expect(summary).toHaveBeenCalledWith('2026-09-21', '2026-09-22', {})
    expect(a.table!.rows).toHaveLength(2)
  })

  it('mtd: straight-line projection', async () => {
    const { data } = fakeData()
    const a = await answerIntent({ kind: 'mtd' }, data, orgCtx)
    // $80 over 29 of 30 days → $82.76
    expect(a.answer).toContain('$82.76')
  })

  it('member_spend: fuzzy match on user_key', async () => {
    const { data } = fakeData([row('alice@acme.io', 12), row('bob@acme.io', 3)])
    const a = await answerIntent({ kind: 'member_spend', member: 'alice', period: { kind: 'last_week' } }, data, orgCtx)
    expect(a.answer).toMatch(/^alice@acme.io spent \$12.00/)
    expect(a.link).toContain('member=alice%40acme.io')
  })

  it('member scope: every query is limited to the caller and other members are refused', async () => {
    const { data, summary, breakdown } = fakeData([row('me@acme.io', 4)])
    const ctx = { today: '2026-09-29', scopeUserKey: 'me@acme.io' }
    await answerIntent({ kind: 'top', dim: 'member', n: 5, period: { kind: 'this_month' } }, data, ctx)
    expect(breakdown).toHaveBeenCalledWith('2026-09-01', '2026-09-29', 'member', { user_key: 'me@acme.io' }, 5)
    const a = await answerIntent({ kind: 'member_spend', member: 'alice', period: { kind: 'this_month' } }, data, ctx)
    expect(a.answer).toContain('only see your own')
    expect(summary).toHaveBeenLastCalledWith('2026-09-01', '2026-09-29', { user_key: 'me@acme.io' })
    expect(breakdown).toHaveBeenCalledTimes(1)
  })

  it('exploreLink encodes filters', () => {
    expect(exploreLink({ from: 'a', to: 'b', dim: 'model', filters: { project_id: 'x', model: null } })).toBe('/dashboard/explore?dim=model&range=custom&from=a&to=b&project=x')
  })
})

describe('ask + LLM fallback', () => {
  it('uses the parser first and never calls the LLM when it matches', async () => {
    const { data } = fakeData()
    const llm = vi.fn()
    const r = await ask('total spend today', data, orgCtx, llm)
    expect(llm).not.toHaveBeenCalled()
    expect(r.intent).toEqual({ kind: 'total', period: { kind: 'today' } })
  })

  it('falls back to the LLM mapper, then examples', async () => {
    const { data } = fakeData()
    const r = await ask('what were our damages for the fortnight', data, orgCtx, async () => ({ kind: 'mtd' }))
    expect(r.intent).toEqual({ kind: 'mtd' })
    expect((r as { source: string }).source).toBe('llm')
    const none = await ask('tell me a joke', data, orgCtx)
    expect(none.intent).toBeNull()
  })
})

describe('mapQuestionWithLLM (mocked fetch)', () => {
  it('returns null without a key and never fetches', async () => {
    const f = vi.fn()
    expect(await mapQuestionWithLLM('x', { apiKey: '', fetchImpl: f })).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('sends only the question + schema and validates the reply', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({
      stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sure: {"kind":"top","dim":"model","n":3,"period":{"kind":"this_week"}}' }],
    }) }))
    const intent = await mapQuestionWithLLM('priciest three llms this wk', { apiKey: 'test-key', fetchImpl: f })
    expect(intent).toEqual({ kind: 'top', dim: 'model', n: 3, period: { kind: 'this_week' } })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    const body = JSON.parse(String(init.body))
    expect(body.messages).toEqual([{ role: 'user', content: 'priciest three llms this wk' }])
    expect(JSON.stringify(body)).not.toMatch(/cost_usd|rows/)
  })

  it('rejects invalid or out-of-scope replies', async () => {
    const reply = (text: string) => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }] }) }))
    expect(await mapQuestionWithLLM('q', { apiKey: 'k', fetchImpl: reply('{"kind":"none"}') })).toBeNull()
    expect(await mapQuestionWithLLM('q', { apiKey: 'k', fetchImpl: reply('{"kind":"top","dim":"weather","n":3}') })).toBeNull()
    expect(await mapQuestionWithLLM('q', { apiKey: 'k', fetchImpl: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) })).toBeNull()
    expect(extractJson('no json')).toBeNull()
  })
})
