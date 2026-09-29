import { describe, it, expect } from 'vitest'
import { isoWeekKey, digestWindow, buildDigest, digestText, isEmptyDigest, type DigestEvent } from './build'

const NOW = new Date('2026-09-28T05:00:00Z') // Monday → covers Mon 21 – Sun 27 Sep (2026-W39)

describe('ISO week window', () => {
  it('keys weeks per ISO-8601', () => {
    expect(isoWeekKey(new Date('2026-09-21T00:00:00Z'))).toBe('2026-W39')
    expect(isoWeekKey(new Date('2021-01-03T00:00:00Z'))).toBe('2020-W53')
    expect(isoWeekKey(new Date('2024-12-30T00:00:00Z'))).toBe('2025-W01')
  })
  it('covers the last complete week whatever weekday it runs', () => {
    const w = digestWindow(NOW)
    expect(w).toMatchObject({ weekKey: '2026-W39', from: '2026-09-21', to: '2026-09-27' })
    expect(digestWindow(new Date('2026-10-04T23:00:00Z')).weekKey).toBe('2026-W39') // Sunday of next week
    expect(digestWindow(new Date('2026-09-28T00:00:00Z')).prevStartTs).toBe('2026-09-14T00:00:00.000Z')
  })
})

let n = 0
const ev = (day: string, cost: number, x: Partial<DigestEvent> = {}): DigestEvent =>
  ({ id: `e${n++}`, project_id: 'p1', model: 'sonnet', cost_usd: cost, created_at: `${day}T10:00:00Z`, ...x })

describe('buildDigest', () => {
  const events: DigestEvent[] = [
    // previous week
    ev('2026-09-15', 10, { user_email: 'a@x.io' }),
    ev('2026-09-16', 5,  { user_email: 'b@x.io', model: 'opus' }),
    // covered week
    ev('2026-09-22', 30, { user_email: 'A@x.io', cost_basis: 'notional', correlation_id: 'c1' }),
    ev('2026-09-22', 2,  { user_email: 'a@x.io', cost_basis: 'notional', correlation_id: 'c1' }),
    ev('2026-09-23', 8,  { user_id: 'u9', project_id: 'p2', model: 'haiku', cost_basis: 'metered' }),
    // this week (excluded)
    ev('2026-09-28', 999),
  ]
  const s = buildDigest(events, { now: NOW, projectName: new Map([['p1', 'Web'], ['p2', 'Batch']]), emailByUser: new Map([['u9', 'c@x.io']]) })

  it('totals, metered vs notional, prompts vs calls', () => {
    expect(s.cost).toBe(40); expect(s.notional).toBe(32); expect(s.metered).toBe(8)
    expect(s.prevCost).toBe(15); expect(s.costPct).toBeCloseTo(166.7)
    expect(s.calls).toBe(3); expect(s.prompts).toBe(2)
    expect(s.prevCalls).toBe(2)
  })
  it('ranks members (email-normalised, user_id resolved), models, projects', () => {
    expect(s.topMembers.map(m => m.label)).toEqual(['a@x.io', 'c@x.io'])
    expect(s.topMembers[0]).toMatchObject({ cost: 32, prevCost: 10 })
    expect(s.topModels[0]).toMatchObject({ label: 'sonnet', cost: 32 })
    expect(s.topProjects.map(p => p.label)).toEqual(['Web', 'Batch'])
  })
  it('movers sorted by absolute change, including drops', () => {
    expect(s.movers).toHaveLength(5)
    expect(s.movers[0]).toMatchObject({ delta: 22 })
    const all = buildDigest(events, { now: NOW, projectName: new Map([['p2', 'Batch']]), top: 20 })
    const opus = all.movers.find(m => m.kind === 'model' && m.label === 'opus')!
    expect(opus.delta).toBe(-5); expect(opus.pct).toBe(-100)
    expect(all.movers.find(m => m.label === 'Batch')!.pct).toBeNull() // new
  })
  it('formats text and detects empty weeks', () => {
    const t = digestText(s, 'https://app.example')
    expect(t).toContain('Spend: $40.00 (+167% vs $15.00)')
    expect(t).toContain('metered $8.00 · notional $32.00')
    expect(t).toContain('https://app.example/dashboard/analytics')
    expect(isEmptyDigest(s)).toBe(false)
    expect(isEmptyDigest(buildDigest([], { now: NOW }))).toBe(true)
  })
})
