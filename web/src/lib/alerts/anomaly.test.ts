import { describe, it, expect } from 'vitest'
import { median, mad, robustScore, detectAnomalies, parseAnomalyScope, type AnomalyEvent } from './anomaly'

const TODAY = '2026-09-29'
const day = (n: number) => new Date(Date.parse(TODAY + 'T12:00:00Z') - n * 86400_000).toISOString()

// 28 days of history with mild noise around `base`, then today's value.
function series(base: number, today: number, extra: Partial<AnomalyEvent> = {}, noise = 0.1): AnomalyEvent[] {
  const out: AnomalyEvent[] = []
  for (let i = 1; i <= 28; i++) out.push({ cost_usd: base * (1 + noise * Math.sin(i * 1.7)), created_at: day(i), ...extra })
  if (today > 0) out.push({ cost_usd: today, created_at: day(0), ...extra })
  return out
}

describe('median / MAD', () => {
  it('computes odd/even medians and MAD', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1)
    expect(median([])).toBe(0)
  })
})

describe('robustScore', () => {
  it('needs at least 7 data days', () => {
    expect(robustScore([5, 5, 5, 5, 5, 5], 100)).toBeNull()
    expect(robustScore([5, 5, 5, 5, 5, 5, 5], 100)).not.toBeNull()
  })
  it('ignores zero (no-data) days in the baseline', () => {
    expect(robustScore([0, 0, 0, 0, 5, 5, 5, 5, 5, 5], 100)).toBeNull()
  })
  it('flags a spike, not normal days', () => {
    const base = [10, 11, 9, 10, 12, 8, 10, 11, 9, 10]
    expect(robustScore(base, 60)!.flagged).toBe(true)
    expect(robustScore(base, 12)!.flagged).toBe(false)
  })
  it('floors the scale on a perfectly flat series', () => {
    const flat = Array(10).fill(2)
    expect(robustScore(flat, 2.1)!.flagged).toBe(false)
    expect(robustScore(flat, 20)!.flagged).toBe(true)
  })
  it('requires today > $1 even with a huge z', () => {
    const tiny = Array(10).fill(0.01)
    const r = robustScore(tiny, 0.9)!
    expect(r.z).toBeGreaterThan(3.5)
    expect(r.flagged).toBe(false)
  })
  it('is robust to a single past outlier (unlike a mean)', () => {
    const base = [10, 10, 11, 9, 10, 10, 500, 10, 11, 9]
    expect(robustScore(base, 40)!.flagged).toBe(true)
  })
})

describe('detectAnomalies', () => {
  it('org scope flags a spike day', () => {
    const r = detectAnomalies(series(10, 80), 'org', TODAY)
    expect(r).toHaveLength(1)
    expect(r[0].flagged).toBe(true)
    expect(r[0].dataDays).toBe(28)
  })
  it('project scope isolates the offending project', () => {
    const evs = [...series(10, 11, { project_id: 'p1' }), ...series(5, 60, { project_id: 'p2' })]
    const r = detectAnomalies(evs, 'project', TODAY)
    expect(r[0].key).toBe('p2')
    expect(r[0].flagged).toBe(true)
    expect(r.find(x => x.key === 'p1')!.flagged).toBe(false)
  })
  it('member scope keys by email, falling back to user_id', () => {
    const evs = [...series(3, 40, { user_email: 'A@x.io' }), ...series(3, 3, { user_id: 'u2' })]
    const r = detectAnomalies(evs, 'member', TODAY)
    expect(r[0].key).toBe('a@x.io')
    expect(r[0].flagged).toBe(true)
    expect(r.find(x => x.key === 'u2')!.flagged).toBe(false)
  })
  it('model scope + filter', () => {
    const evs = [...series(4, 50, { model: 'opus', project_id: 'p1' }), ...series(4, 50, { model: 'haiku', project_id: 'p2' })]
    const r = detectAnomalies(evs, 'model', TODAY, e => e.project_id === 'p2')
    expect(r.map(x => x.key)).toEqual(['haiku'])
  })
  it('does not use data older than 28 days, and skips new scopes', () => {
    const old: AnomalyEvent[] = Array.from({ length: 10 }, (_, i) => ({ cost_usd: 5, created_at: day(30 + i) }))
    expect(detectAnomalies([...old, { cost_usd: 100, created_at: day(0) }], 'org', TODAY)).toHaveLength(0)
  })
  it('parseAnomalyScope defaults old rules to org', () => {
    expect(parseAnomalyScope(undefined)).toBe('org')
    expect(parseAnomalyScope('bogus')).toBe('org')
    expect(parseAnomalyScope('model')).toBe('model')
  })
})
