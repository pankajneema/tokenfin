import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { parseAnthropicCostReport, parseAnthropicUsageReport, fetchAnthropicCosts, verifyAnthropicKey, ANTHROPIC_ADMIN_KEY_RE } from './anthropic'
import { parseOpenAICosts, fetchOpenAICosts, verifyOpenAIKey, modelFromLineItem, OPENAI_ADMIN_KEY_RE } from './openai'
import { mergeRows, keyHint, ProviderApiError } from './types'
import { syncWindow } from './sync'
import { reconcile, variance, totals, toCsv, billingProviderFor } from './reconcile'
import { anthropicCostPage1, anthropicCostPage2, anthropicUsage, openaiPage1, openaiPage2 } from './__fixtures__/fixtures'
import { startMockProviders, GOOD_ANTHROPIC_KEY, GOOD_OPENAI_KEY, type MockServer } from './__fixtures__/mock-server'

describe('provider response parsing', () => {
  it('Anthropic cost_report: cents string → USD, description as line item', () => {
    const rows = parseAnthropicCostReport(anthropicCostPage1)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ day: '2026-09-01', workspace_or_project: 'wrkspc_A', model: 'claude-sonnet-4-6', line_item: 'Claude Sonnet 4.6 Usage - Input Tokens' })
    expect(rows[0].cost_usd).toBeCloseTo(1.2345, 6)
    expect(rows[1]).toMatchObject({ workspace_or_project: '', cost_usd: 2.5 })
    const p2 = parseAnthropicCostReport(anthropicCostPage2)
    expect(p2).toEqual([expect.objectContaining({ day: '2026-09-02', line_item: 'Web Search', model: '', cost_usd: 0.1 })])
  })

  it('Anthropic usage_report: token rows with cache writes counted as input', () => {
    const [r] = parseAnthropicUsageReport(anthropicUsage)
    expect(r).toMatchObject({ day: '2026-09-01', line_item: 'usage:tokens', cost_usd: 0, input_tokens: 1250, output_tokens: 400, cache_read_tokens: 3000 })
  })

  it('OpenAI costs: amount.value USD, model from line item, null project → ""', () => {
    const rows = parseOpenAICosts(openaiPage1)
    expect(rows.map(r => [r.day, r.model, r.workspace_or_project, r.cost_usd])).toEqual([
      ['2026-09-01', 'gpt-4o-2024-08-06', 'proj_1', 0.5],
      ['2026-09-01', 'gpt-4o-2024-08-06', 'proj_1', 1.25],
    ])
    expect(parseOpenAICosts(openaiPage2)[0]).toMatchObject({ model: '', workspace_or_project: '', line_item: 'web search tool calls' })
    expect(modelFromLineItem('o3-mini, cached input')).toBe('o3-mini')
    expect(modelFromLineItem('Code interpreter sessions')).toBe('')
  })

  it('tolerates junk input', () => {
    expect(parseAnthropicCostReport(null)).toEqual([])
    expect(parseOpenAICosts({ data: [{ results: [{}] }] })).toEqual([])
    expect(parseAnthropicCostReport({ data: [{ starting_at: '2026-09-01T00:00:00Z', results: [{ amount: 'abc' }] }] })[0].cost_usd).toBe(0)
  })

  it('mergeRows sums duplicate keys', () => {
    const m = mergeRows([...parseOpenAICosts(openaiPage1), ...parseOpenAICosts(openaiPage1)])
    expect(m).toHaveLength(2)
    expect(m.find(r => r.line_item.endsWith('output'))?.cost_usd).toBe(2.5)
  })

  it('key formats and hints', () => {
    expect(ANTHROPIC_ADMIN_KEY_RE.test(GOOD_ANTHROPIC_KEY)).toBe(true)
    expect(ANTHROPIC_ADMIN_KEY_RE.test('sk-ant-api03-' + 'x'.repeat(30))).toBe(false)
    expect(OPENAI_ADMIN_KEY_RE.test(GOOD_OPENAI_KEY)).toBe(true)
    expect(OPENAI_ADMIN_KEY_RE.test('not-a-key')).toBe(false)
    expect(keyHint(GOOD_ANTHROPIC_KEY)).toBe('sk-ant-admin…xxxx')
    expect(keyHint(GOOD_OPENAI_KEY)).toBe('sk-admin-…yyyy')
  })

  it('sync window covers N full UTC days plus today', () => {
    const w = syncWindow(35, new Date('2026-09-29T15:30:00Z'))
    expect(w.start.toISOString()).toBe('2026-08-25T00:00:00.000Z')
    expect(w.end.toISOString()).toBe('2026-09-30T00:00:00.000Z')
  })
})

describe('reconciliation math', () => {
  it('variance $ and % against provider-billed cost, flag > 10%', () => {
    expect(variance(100, 95)).toEqual({ variance: 5, variancePct: 5, flagged: false })
    expect(variance(100, 80)).toEqual({ variance: 20, variancePct: 20, flagged: true })
    expect(variance(100, 115)).toEqual({ variance: -15, variancePct: -15, flagged: true })
    expect(variance(100, 110)).toMatchObject({ flagged: false })       // exactly 10% is not > 10%
    expect(variance(0, 5)).toEqual({ variance: -5, variancePct: null, flagged: true })
    expect(variance(0, 0)).toEqual({ variance: 0, variancePct: null, flagged: false })
  })

  it('joins per day + provider, only for connected providers, newest first', () => {
    const rows = reconcile(
      [{ day: '2026-09-01', provider: 'anthropic', cost_usd: '10' }, { day: '2026-09-01', provider: 'anthropic', cost_usd: 5 }, { day: '2026-09-02', provider: 'openai', cost_usd: 2 }],
      [{ day: '2026-09-01', provider: 'anthropic', cost_usd: 14 }, { day: '2026-09-03', provider: 'anthropic', cost_usd: 1 }, { day: '2026-09-02', provider: 'openai', cost_usd: 9 }],
      ['anthropic'],
    )
    expect(rows.map(r => [r.day, r.provider, r.providerCost, r.tokenfinCost, r.flagged])).toEqual([
      ['2026-09-03', 'anthropic', 0, 1, true],    // $0 billed but $1 metered → flagged
      ['2026-09-01', 'anthropic', 15, 14, false], // 6.7% → within tolerance
    ])
    const t = totals(rows)
    expect(t.providerCost).toBe(15); expect(t.tokenfinCost).toBe(15); expect(t.flaggedDays).toBe(1)
    const csv = toCsv(rows)
    expect(csv.split('\n')[0]).toBe('day,provider,provider_cost_usd,tokenfin_metered_usd,variance_usd,variance_pct,flagged')
    expect(csv).toContain('2026-09-01,anthropic,15.0000,14.0000,1.0000,6.7,')
  })

  it('attributes usage to the billing provider like the SQL function', () => {
    expect(billingProviderFor('claude-sonnet-4-6')).toBe('anthropic')
    expect(billingProviderFor('anthropic/claude-haiku-4-5')).toBe('anthropic')
    expect(billingProviderFor('gpt-4o-mini')).toBe('openai')
    expect(billingProviderFor('o3')).toBe('openai')
    expect(billingProviderFor('claude-sonnet-4-6', 'bedrock')).toBeNull()
    expect(billingProviderFor('claude-sonnet-4-6', null, 'notional')).toBeNull()
    expect(billingProviderFor('gemini-2.5-pro')).toBeNull()
  })
})

describe('provider clients against a local mock server', () => {
  let mock: MockServer
  const w = { start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-09-04T00:00:00Z') }
  beforeAll(async () => {
    mock = await startMockProviders()
    process.env.ANTHROPIC_ADMIN_BASE_URL = mock.url
    process.env.OPENAI_ADMIN_BASE_URL = mock.url
  })
  afterAll(async () => {
    delete process.env.ANTHROPIC_ADMIN_BASE_URL; delete process.env.OPENAI_ADMIN_BASE_URL
    await mock.close()
  })

  it('Anthropic: follows next_page, sends documented headers/params, merges cost + usage', async () => {
    const rows = await fetchAnthropicCosts(GOOD_ANTHROPIC_KEY, w)
    const cost = mock.requests.filter(r => r.path === '/v1/organizations/cost_report')
    expect(cost).toHaveLength(2)
    expect(cost[1].query.get('page')).toBe('page_2')
    expect(cost[0].query.getAll('group_by[]')).toEqual(['workspace_id', 'description'])
    expect(cost[0].query.get('starting_at')).toBe('2026-09-01T00:00:00Z')
    expect(cost[0].query.get('bucket_width')).toBe('1d')
    const usage = mock.requests.find(r => r.path === '/v1/organizations/usage_report/messages')!
    expect(usage.query.get('bucket_width')).toBe('1d')
    expect(rows.reduce((s, r) => s + r.cost_usd, 0)).toBeCloseTo(1.2345 + 2.5 + 0.1, 6)
    expect(rows.find(r => r.line_item === 'usage:tokens')?.output_tokens).toBe(400)
  })

  it('OpenAI: unix start/end, group_by, pagination', async () => {
    mock.requests.length = 0
    const rows = await fetchOpenAICosts(GOOD_OPENAI_KEY, w)
    expect(mock.requests).toHaveLength(2)
    expect(mock.requests[0].query.get('start_time')).toBe(String(Date.parse('2026-09-01T00:00:00Z') / 1000))
    expect(mock.requests[0].query.getAll('group_by')).toEqual(['project_id', 'line_item'])
    expect(mock.requests[1].query.get('page')).toBe('page_AAA')
    expect(rows.reduce((s, r) => s + r.cost_usd, 0)).toBeCloseTo(1.77, 6)
  })

  it('verify rejects bad keys with a ProviderApiError (key never in message)', async () => {
    await expect(verifyAnthropicKey(GOOD_ANTHROPIC_KEY)).resolves.toBeUndefined()
    await expect(verifyOpenAIKey(GOOD_OPENAI_KEY)).resolves.toBeUndefined()
    const bad = 'sk-ant-admin01-WRONG' + 'z'.repeat(20)
    const err = await verifyAnthropicKey(bad).catch(e => e)
    expect(err).toBeInstanceOf(ProviderApiError)
    expect(err.status).toBe(401)
    expect(err.message).not.toContain(bad)
    await expect(verifyOpenAIKey('sk-admin-nope' + 'q'.repeat(20))).rejects.toMatchObject({ status: 401 })
  })
})
