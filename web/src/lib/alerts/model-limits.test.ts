import { describe, it, expect } from 'vitest'
import {
  normalizeLimit, modelMatches, normModel, limitUsage, evaluateLimit, limitAmount, rpcPrefixes, earliestDay,
  type UsageRow, type ScopeResolver,
} from './model-limits'
import { periodWindow, zonedMidnightUtc, isoWeekStart } from './period'
import { limitMessage } from './limits-runner'

const NOW = new Date('2026-09-30T12:00:00Z')   // Wednesday; 17:30 in Asia/Kolkata
const row = (x: Partial<UsageRow>): UsageRow => ({
  day: '2026-09-30', model: 'claude-opus-4-8', project_id: 'p1', user_key: 'u1', cost_basis: 'metered',
  requests: 1, total_tokens: 1000, cost_usd: 1, ...x,
})
const scope: ScopeResolver = {
  teamKeys: (t) => new Set(t === 't1' ? ['u1', 'a@x.com'] : []),
  memberKeys: (u) => new Set([u, u === 'u2' ? 'b@x.com' : '']),
}
const lim = (x: Record<string, unknown>) => normalizeLimit({
  id: 'l1', org_id: 'o', scope: 'org', period: 'monthly', metric: 'cost_usd', value: 10, budget_usd: 0,
  model: 'claude-opus', is_active: true, ...x,
})

describe('model matching', () => {
  it('prefix, case-insensitive, provider prefixes ignored', () => {
    expect(modelMatches('claude-opus', 'claude-opus-4-8')).toBe(true)
    expect(modelMatches('Claude-Opus', 'claude-opus-4-1-20250805')).toBe(true)
    expect(modelMatches('claude-opus', 'anthropic/claude-opus-4')).toBe(true)
    expect(modelMatches('claude-opus', 'us.anthropic.claude-opus-4-1-v1:0')).toBe(true)
    expect(modelMatches('claude-opus', 'claude-sonnet-4-6')).toBe(false)
    expect(modelMatches('claude-opus-4-8', 'claude-opus-4-1')).toBe(false)
    expect(modelMatches(null, 'anything')).toBe(true)
    expect(normModel('openai/GPT-4o')).toBe('gpt-4o')
  })
})

describe('limit usage', () => {
  const rows = [
    row({}),                                                              // opus, metered, today
    row({ model: 'claude-opus-4-1', cost_basis: 'notional', cost_usd: 3, total_tokens: 5000, requests: 4 }),
    row({ model: 'claude-sonnet-4-6', cost_usd: 50 }),                    // other model
    row({ day: '2026-08-31', cost_usd: 99 }),                             // last month
    row({ project_id: 'p2', user_key: 'b@x.com', cost_usd: 2 }),
  ]
  const win = periodWindow('monthly', NOW, 'UTC')
  it('sums the metric for matching models in the period', () => {
    expect(limitUsage(lim({}), rows, win, scope)).toBe(6)
    expect(limitUsage(lim({ metric: 'tokens', value: 1e6 }), rows, win, scope)).toBe(7000)
    expect(limitUsage(lim({ metric: 'requests', value: 100 }), rows, win, scope)).toBe(6)
  })
  it('basis filters metered vs notional', () => {
    expect(limitUsage(lim({ basis: 'metered' }), rows, win, scope)).toBe(3)
    expect(limitUsage(lim({ basis: 'notional' }), rows, win, scope)).toBe(3)
  })
  it('scopes: project, team, member; member without user_id is not measurable', () => {
    expect(limitUsage(lim({ scope: 'project', project_id: 'p2' }), rows, win, scope)).toBe(2)
    expect(limitUsage(lim({ scope: 'team', team_id: 't1' }), rows, win, scope)).toBe(4)
    expect(limitUsage(lim({ scope: 'member', user_id: 'u2' }), rows, win, scope)).toBe(2)
    expect(limitUsage(lim({ scope: 'member', user_id: null }), rows, win, scope)).toBeNull()
  })
  it('no model filter counts every model', () => {
    expect(limitUsage(lim({ model: null }), rows, win, scope)).toBe(56)
  })
})

describe('thresholds', () => {
  const rows = [row({ cost_usd: 9.2 })]
  it('notify at 90% and act at auto_action_at only when an action is set', () => {
    const s = evaluateLimit(lim({ notify_at: 90 }), rows, scope, NOW, 'UTC')
    expect(s.pct).toBeCloseTo(92)
    expect(s.notify).toBe(true)
    expect(s.action).toBe(false)
    const a = evaluateLimit(lim({ auto_action: 'switch_model', switch_to: 'claude-sonnet-4-6', auto_action_at: 90 }), rows, scope, NOW, 'UTC')
    expect(a.action).toBe(true)
    expect(evaluateLimit(lim({ notify_at: null }), rows, scope, NOW, 'UTC').notify).toBe(false)
    expect(evaluateLimit(lim({ is_active: false }), rows, scope, NOW, 'UTC').notify).toBe(false)
  })
  it('legacy rows: amount falls back to budget_usd, notify defaults to 90', () => {
    const l = normalizeLimit({ id: 'x', org_id: 'o', scope: 'org', period: 'monthly', budget_usd: 50 })
    expect(l.amount).toBe(50)
    expect(l.notify_at).toBe(90)
    expect(l.metric).toBe('cost_usd')
    expect(limitAmount({ metric: 'tokens', budget_usd: 5 })).toBe(0)
  })
  it('RPC prefix narrowing only when every limit has a model', () => {
    expect(rpcPrefixes([lim({}), lim({ model: 'GPT-4o' })])).toEqual(['claude-opus', 'gpt-4o'])
    expect(rpcPrefixes([lim({}), lim({ model: null })])).toBeNull()
    expect(earliestDay([lim({ period: 'daily' }), lim({ period: 'monthly' })], NOW, 'UTC')).toBe('2026-09-01')
  })
})

describe('periods in the org time zone', () => {
  it('daily / weekly / monthly keys and windows', () => {
    const d = periodWindow('daily', NOW, 'Asia/Kolkata')
    expect(d.key).toBe('d2026-09-30')
    expect(d.resetsAt).toBe('2026-09-30T18:30:00.000Z')        // local midnight IST
    const w = periodWindow('weekly', NOW, 'UTC')
    expect(w.fromDay).toBe('2026-09-28')                          // Monday
    expect(w.nextDay).toBe('2026-10-05')
    const m = periodWindow('monthly', NOW, 'America/Los_Angeles')
    expect(m.key).toBe('m2026-09')
    expect(m.resetsAt).toBe('2026-10-01T07:00:00.000Z')         // PDT
  })
  it('the org day decides the period, not UTC', () => {
    // 2026-09-30 20:00 UTC is already Oct 1 in Kolkata → a new month and a new daily key.
    const late = new Date('2026-09-30T20:00:00Z')
    expect(periodWindow('monthly', late, 'Asia/Kolkata').key).toBe('m2026-10')
    expect(periodWindow('monthly', late, 'UTC').key).toBe('m2026-09')
    const rows = [row({ day: '2026-10-01', cost_usd: 5 }), row({ day: '2026-09-30', cost_usd: 7 })]
    expect(limitUsage(lim({ period: 'daily' }), rows, periodWindow('daily', late, 'Asia/Kolkata'), scope)).toBe(5)
  })
  it('DST-safe local midnight and ISO week start', () => {
    expect(zonedMidnightUtc('2026-11-01', 'America/New_York').toISOString()).toBe('2026-11-01T04:00:00.000Z')
    expect(zonedMidnightUtc('2026-11-02', 'America/New_York').toISOString()).toBe('2026-11-02T05:00:00.000Z')
    expect(isoWeekStart('2026-10-04')).toBe('2026-09-28')          // Sunday → previous Monday
  })
})

describe('messages', () => {
  it('subject names model, percent and period; body has usage, reset and link', () => {
    const s = evaluateLimit(lim({ period: 'weekly', metric: 'tokens', value: 20_000_000 }), [row({ total_tokens: 18_400_000 })], scope, NOW, 'UTC')
    const m = limitMessage(s, {}, 'UTC', 'notify')
    expect(m.subject).toBe("TokenFin: claude-opus usage at 92% of this week's limit")
    expect(m.text).toContain('18.4M tokens of 20M tokens')
    expect(m.text).toContain('resets Mon, Oct 5')
    expect(m.text).toContain('/dashboard/limits#limit-l1')
    const sw = limitMessage(evaluateLimit(lim({ auto_action: 'switch_model', switch_to: 'claude-sonnet-4-6' }), [row({ cost_usd: 11 })], scope, NOW, 'UTC'), {}, 'UTC', 'switch_model')
    expect(sw.subject).toBe("TokenFin: claude-opus auto-switched to claude-sonnet-4-6 (110% of this month's limit)")
  })
})
