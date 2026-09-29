import { describe, it, expect } from 'vitest'
import {
  parseExploreParams, toSearchParams, resolveRange, toDashFilters, dimFilterKey,
  isDayLabel, cleanFilterValue, rowsToCsv, sortRows, sharePct, exploreHref, type ExploreRow,
} from './explore'

const UUID = '3f2b8c1e-1234-4abc-9def-0123456789ab'

describe('parseExploreParams', () => {
  it('defaults to model / 30 days with no params', () => {
    const { state, errors } = parseExploreParams({})
    expect(state).toEqual({ dim: 'model', range: 30, filters: {} })
    expect(errors).toEqual([])
  })

  it('accepts every valid dim and preset', () => {
    for (const dim of ['model', 'project', 'member', 'source', 'agent', 'skill', 'mcp_server', 'repo', 'cost_basis', 'day']) {
      expect(parseExploreParams({ dim }).state.dim).toBe(dim)
    }
    for (const r of ['7', '30', '90']) expect(parseExploreParams({ range: r }).state.range).toBe(Number(r))
  })

  it('rejects bad dims', () => {
    for (const dim of ['bogus', 'MODEL', 'project_id', 'user_key; drop table', '__proto__']) {
      const { state, errors } = parseExploreParams({ dim })
      expect(state.dim).toBe('model')
      expect(errors).toHaveLength(1)
    }
  })

  it('rejects bad presets', () => {
    for (const range of ['14', '0', '-7', '30.0', ' 30', 'abc', '1e2']) {
      const { state, errors } = parseExploreParams({ range })
      expect(state.range).toBe(30)
      expect(errors).toHaveLength(1)
    }
  })

  it('accepts a valid custom range (also implied by from/to alone)', () => {
    expect(parseExploreParams({ range: 'custom', from: '2026-01-01', to: '2026-01-31' }).state)
      .toMatchObject({ range: 'custom', from: '2026-01-01', to: '2026-01-31' })
    expect(parseExploreParams({ from: '2026-01-01', to: '2026-01-01' }).state.range).toBe('custom')
  })

  it('rejects bad custom ranges', () => {
    const bad = [
      { range: 'custom' },
      { range: 'custom', from: '2026-01-01' },
      { range: 'custom', from: '2026-02-30', to: '2026-03-01' },
      { range: 'custom', from: '2026-1-1', to: '2026-01-05' },
      { range: 'custom', from: '2026-03-01', to: '2026-02-01' },
      { range: 'custom', from: '2024-01-01', to: '2026-01-01' },
    ]
    for (const sp of bad) {
      const { state, errors } = parseExploreParams(sp)
      expect(state.range).toBe(30)
      expect(state.from).toBeUndefined()
      expect(errors).toHaveLength(1)
    }
  })

  it('parses filters and drops invalid ones', () => {
    const { state, errors } = parseExploreParams(new URLSearchParams({
      project: UUID, member: 'Alice@Example.COM', model: 'claude-sonnet-4', source: 'claude_code', repo: 'org/repo', agent: 'Explore',
    }))
    expect(state.filters).toEqual({
      project: UUID, member: 'alice@example.com', model: 'claude-sonnet-4', source: 'claude_code', repo: 'org/repo', agent: 'Explore',
    })
    expect(errors).toEqual([])
    const bad = parseExploreParams({ project: 'not-a-uuid', model: 'x'.repeat(400), unknown: 'y' })
    expect(bad.state.filters).toEqual({})
    expect(bad.errors).toHaveLength(2)
  })

  it('uses the first value of repeated params', () => {
    expect(parseExploreParams({ dim: ['repo', 'model'] }).state.dim).toBe('repo')
  })
})

describe('serialization', () => {
  it('round-trips and omits defaults', () => {
    expect(toSearchParams({ dim: 'model', range: 30, filters: {} }).toString()).toBe('')
    const s = { dim: 'agent' as const, range: 'custom' as const, from: '2026-01-01', to: '2026-01-10', filters: { model: 'gpt-5', project: UUID } }
    const back = parseExploreParams(toSearchParams(s)).state
    expect(back).toEqual(s)
    expect(exploreHref({ dim: 'day', range: 7, filters: {} })).toBe('/dashboard/explore?dim=day&range=7')
  })
})

describe('resolveRange', () => {
  const now = Date.parse('2026-09-29T20:00:00Z') // 2026-09-30 01:30 in Asia/Kolkata
  it('ends today in the org zone and is inclusive', () => {
    expect(resolveRange({ dim: 'model', range: 7, filters: {} }, 'Asia/Kolkata', now)).toEqual({ from: '2026-09-24', to: '2026-09-30' })
    expect(resolveRange({ dim: 'model', range: 30, filters: {} }, 'UTC', now)).toEqual({ from: '2026-08-31', to: '2026-09-29' })
  })
  it('passes a custom range through', () => {
    expect(resolveRange({ dim: 'model', range: 'custom', from: '2026-01-01', to: '2026-01-02', filters: {} }, 'UTC', now))
      .toEqual({ from: '2026-01-01', to: '2026-01-02' })
  })
})

describe('helpers', () => {
  it('maps filters to DashFilters and dims to filter keys', () => {
    expect(toDashFilters({ project: UUID, member: 'a@b.c', agent: 'x' })).toEqual({ project_id: UUID, user_key: 'a@b.c', agent: 'x' })
    expect(dimFilterKey('member')).toBe('member')
    expect(dimFilterKey('skill')).toBeNull()
    expect(dimFilterKey('day')).toBeNull()
  })
  it('validates day labels and filter values', () => {
    expect(isDayLabel('2028-02-29')).toBe(true)
    expect(isDayLabel('2026-02-29')).toBe(false)
    expect(cleanFilterValue('project', UUID.toUpperCase())).toBe(UUID.toUpperCase())
    expect(cleanFilterValue('model', '  a\nb ')).toBeNull()
  })
  it('builds a CSV with escaping and formula neutralization', () => {
    const rows: ExploreRow[] = [
      { key: 'k1', label: 'a,"b"', metered_cost_usd: 1, notional_cost_usd: 0.5, cost_usd: 1.5, total_tokens: 10, requests: 2, prompts: null, share_pct: 60 },
      { key: 'k2', label: '=HYPERLINK(1)', metered_cost_usd: 0, notional_cost_usd: 1, cost_usd: 1, total_tokens: 5, requests: 1, prompts: 1, share_pct: 40 },
    ]
    const csv = rowsToCsv('mcp_server', rows).trim().split('\n')
    expect(csv[0]).toBe('mcp_server,key,metered_cost_usd,notional_cost_usd,total_tokens,requests,prompts,share_pct')
    expect(csv[1]).toBe('"a,""b""",k1,1.000000,0.500000,10,2,,60')
    expect(csv[2].startsWith("'=HYPERLINK(1),k2")).toBe(true)
  })
  it('sorts rows with nulls last on desc and stable ties', () => {
    const r = (key: string, prompts: number | null, cost = 1): ExploreRow =>
      ({ key, label: key, metered_cost_usd: cost, notional_cost_usd: 0, cost_usd: cost, total_tokens: 0, requests: 0, prompts, share_pct: 0 })
    expect(sortRows([r('a', null), r('b', 3), r('c', 1)], 'prompts', false).map(x => x.key)).toEqual(['b', 'c', 'a'])
    expect(sortRows([r('b', 1), r('a', 1)], 'label', true).map(x => x.key)).toEqual(['a', 'b'])
    expect(sharePct(1, 3)).toBe(33.3)
    expect(sharePct(1, 0)).toBe(0)
  })
})
