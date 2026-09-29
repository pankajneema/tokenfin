import { describe, it, expect } from 'vitest'
import { FOCUS_COLUMNS, focusCsvHeader, focusCsvLine, providerName, toFocusRow, type FocusInput } from './map'
import { focusInputsForDay, type DimsRow } from './aggregate'
import { localMidnightUtc, monthBounds, daysBetween } from './time'

const base: FocusInput = {
  day: '2026-09-10', chargePeriodStart: '2026-09-09T18:30:00Z', chargePeriodEnd: '2026-09-10T18:30:00Z',
  billingPeriodStart: '2026-08-31T18:30:00Z', billingPeriodEnd: '2026-09-30T18:30:00Z',
  orgId: 'org1', orgName: 'Acme', provider: 'anthropic', model: 'claude-opus-4-7',
  projectId: 'p1', projectName: 'Payments', source: 'claude_code', costBasis: 'notional',
  team: 'Payments', costCenter: 'cc-42', allocationMethod: 'rule',
  events: 3, inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200, cacheWriteTokens: 0,
  reasoningTokens: 0, totalTokens: 2_000_000, cost: 12.5, vendorCost: null,
}

describe('toFocusRow', () => {
  it('notional usage is never billed: BilledCost = EffectiveCost = 0, ListCost = notional', () => {
    const r = toFocusRow(base)
    expect(r.BilledCost).toBe(0)
    expect(r.EffectiveCost).toBe(0)
    expect(r.ContractedCost).toBe(0)
    expect(r.ListCost).toBe(12.5)
    expect(r.x_TokenFinCostBasis).toBe('notional')
    expect(r.ServiceName).toBe('Claude Code')
    expect(r.ChargeDescription).toMatch(/not billed/)
  })
  it('metered usage bills the cost; vendor-reported cost wins', () => {
    const m = toFocusRow({ ...base, costBasis: 'metered', source: 'sdk' })
    expect(m.BilledCost).toBe(12.5)
    expect(m.EffectiveCost).toBe(12.5)
    expect(m.ListCost).toBe(12.5)
    expect(m.ServiceName).toBe('Anthropic API')
    const v = toFocusRow({ ...base, costBasis: 'vendor_reported', vendorCost: 11 })
    expect(v.BilledCost).toBe(11)
    expect(v.ListCost).toBe(12.5)
  })
  it('mandatory FOCUS values and invariants', () => {
    const r = toFocusRow({ ...base, costBasis: 'metered' })
    expect(r.ServiceCategory).toBe('AI and Machine Learning')
    expect(r.ChargeCategory).toBe('Usage')
    expect(r.ChargeClass).toBeNull()
    expect(r.BillingCurrency).toBe('USD')
    expect(r.SkuId).toBe('claude-opus-4-7')
    expect(r.ConsumedUnit).toBe('Tokens')
    expect(r.ConsumedQuantity).toBe(2_000_000)
    expect(r.PricingQuantity).toBe(2)
    expect(Number(r.ListUnitPrice) * Number(r.PricingQuantity)).toBeCloseTo(Number(r.ListCost), 8)
    expect(Number(r.ContractedUnitPrice) * Number(r.PricingQuantity)).toBeCloseTo(Number(r.ContractedCost), 8)
    expect(JSON.parse(String(r.Tags))).toEqual({ team: 'Payments', cost_center: 'cc-42', project: 'Payments', source: 'claude_code' })
    expect(r.x_InputTokens).toBe(1000)
    expect(r.x_CacheReadTokens).toBe(200)
    for (const c of ['BilledCost', 'BillingAccountId', 'BillingCurrency', 'ChargePeriodStart', 'ChargePeriodEnd',
      'InvoiceIssuerName', 'ProviderName', 'PublisherName', 'ServiceName', 'ServiceCategory', 'EffectiveCost', 'ListCost'] as const) {
      expect(r[c]).not.toBeNull()
    }
  })
  it('zero tokens → unit prices 0 (no NaN)', () => {
    const r = toFocusRow({ ...base, totalTokens: 0, costBasis: 'metered' })
    expect(r.ListUnitPrice).toBe(0)
  })
  it('provider inference', () => {
    expect(providerName(null, 'gpt-4o')).toBe('OpenAI')
    expect(providerName(null, 'gemini-2.5-pro')).toBe('Google')
    expect(providerName('bedrock', 'x')).toBe('Amazon Web Services')
    expect(providerName(null, 'llama')).toBe('Unknown')
  })
})

describe('CSV', () => {
  it('header lists all columns; lines quote and neutralise formulas', () => {
    expect(focusCsvHeader().trim().split(',')).toEqual([...FOCUS_COLUMNS])
    const line = focusCsvLine(toFocusRow({ ...base, projectName: '=HYPERLINK("x")', orgName: 'A, B' }))
    expect(line).toContain(`"'=HYPERLINK(""x"")"`)
    expect(line).toContain('"A, B"')
    expect(line.split(',').length).toBeGreaterThanOrEqual(FOCUS_COLUMNS.length)
  })
})

describe('time', () => {
  it('local midnight in UTC for IST and a DST zone', () => {
    expect(localMidnightUtc('2026-09-10', 'Asia/Kolkata')).toBe('2026-09-09T18:30:00Z')
    expect(localMidnightUtc('2026-07-01', 'America/New_York')).toBe('2026-07-01T04:00:00Z')
    expect(localMidnightUtc('2026-01-01', 'America/New_York')).toBe('2026-01-01T05:00:00Z')
    expect(localMidnightUtc('2026-03-08', 'America/New_York')).toBe('2026-03-08T05:00:00Z')
    expect(localMidnightUtc('2026-03-09', 'America/New_York')).toBe('2026-03-09T04:00:00Z')
    expect(localMidnightUtc('2026-09-10', 'UTC')).toBe('2026-09-10T00:00:00Z')
  })
  it('month bounds and day ranges', () => {
    expect(monthBounds('2026-12-15')).toEqual({ start: '2026-12-01', end: '2027-01-01' })
    expect(daysBetween('2026-02-27', '2026-03-01')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01'])
  })
})

describe('focusInputsForDay', () => {
  const dims = (p: Partial<DimsRow>): DimsRow => ({
    day: '2026-09-10', provider: 'anthropic', model: 'claude-opus-4-7', project_id: 'p1', source: 'claude_code',
    cost_basis: 'notional', user_id: null, user_email: null, repo: null, tag_values: {},
    events: 1, input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 0,
    reasoning_tokens: 0, total_tokens: 150, cost_usd: 1, vendor_cost_usd: null, ...p,
  })
  const ctx = {
    orgId: 'o', orgName: 'Acme', tz: 'UTC', projectName: new Map([['p1', 'Payments']]),
    memberTeam: new Map([['u1', 'Core']]),
    rules: [
      { id: 'r1', kind: 'assign' as const, priority: 1, match: { repo_prefix: 'payments-' }, assign: { team: 'Payments', cost_center: 'cc-42' } },
      { id: 's', kind: 'shared_split' as const, priority: 9, match: {}, assign: {} },
    ],
  }
  it('collapses users into team/cost-center groups and splits the unattributed rest', () => {
    const out = focusInputsForDay('2026-09-10', [
      dims({ user_id: 'u9', repo: 'payments-api', cost_usd: 3 }),
      dims({ user_id: 'u8', repo: 'payments-web', cost_usd: 1 }),
      dims({ user_id: 'u1', cost_usd: 4 }),
      dims({ user_id: null, cost_usd: 2, total_tokens: 100 }),
    ], ctx)
    const pay = out.find(o => o.team === 'Payments' && o.allocationMethod === 'rule')!
    expect(pay.cost).toBeCloseTo(4)
    expect(pay.events).toBe(2)
    const splits = out.filter(o => o.allocationMethod === 'shared_split')
    expect(splits.map(s => s.team).sort()).toEqual(['Core', 'Payments'])
    expect(splits.reduce((s, x) => s + x.cost, 0)).toBeCloseTo(2)
    expect(out.reduce((s, x) => s + x.cost, 0)).toBeCloseTo(10)
    expect(out[0].chargePeriodStart).toBe('2026-09-10T00:00:00Z')
    expect(out[0].billingPeriodStart).toBe('2026-09-01T00:00:00Z')
  })
  it('keeps notional and metered in separate rows and sums vendor cost', () => {
    const out = focusInputsForDay('2026-09-10', [
      dims({ cost_basis: 'metered', cost_usd: 2, vendor_cost_usd: 1.5 }),
      dims({ cost_basis: 'metered', cost_usd: 1 }),
      dims({ cost_basis: 'notional', cost_usd: 5 }),
    ], { ...ctx, rules: [] })
    expect(out).toHaveLength(2)
    const metered = out.find(o => o.costBasis === 'metered')!
    expect(metered.cost).toBe(3)
    expect(metered.vendorCost).toBeCloseTo(2.5)
  })
})
