import { describe, it, expect } from 'vitest'
import { buildWaterfall, cursorFilter, decodeCursor, encodeCursor, rangeStartIso, zonedMidnightIso, asRange } from './_lib'

describe('time ranges', () => {
  it('org-local midnight', () => {
    expect(zonedMidnightIso('2026-09-29', 'Asia/Kolkata')).toBe('2026-09-28T18:30:00.000Z')
    expect(zonedMidnightIso('2026-09-29', 'UTC')).toBe('2026-09-29T00:00:00.000Z')
    expect(zonedMidnightIso('2026-03-08', 'America/New_York')).toBe('2026-03-08T05:00:00.000Z') // DST day starts EST
    expect(zonedMidnightIso('2026-07-01', 'America/New_York')).toBe('2026-07-01T04:00:00.000Z')
  })
  it('range bounds', () => {
    const now = Date.parse('2026-09-29T12:00:00Z')
    expect(rangeStartIso('24h', 'UTC', now)).toBe('2026-09-28T12:00:00.000Z')
    expect(asRange('bogus')).toBe('7d')
  })
})

describe('keyset cursor', () => {
  it('round-trips and rejects junk', () => {
    const c = { t: '2026-09-29T08:00:00.010Z', id: '5b8efff798038103d269b633813fc60c' }
    expect(decodeCursor(encodeCursor(c))).toEqual(c)
    expect(decodeCursor('not-base64-json')).toBeNull()
    expect(decodeCursor(encodeCursor({ t: 'x', id: 'y' }))).toBeNull()
    expect(decodeCursor(encodeCursor({ t: c.t, id: 'a,b)' }))).toBeNull()
  })
  it('builds a DESC seek filter', () => {
    expect(cursorFilter({ t: '2026-09-29T08:00:00.01+00:00', id: 'abc' }))
      .toBe('start_time.lt."2026-09-29T08:00:00.010Z",and(start_time.eq."2026-09-29T08:00:00.010Z",trace_id.lt.abc)')
  })
})

describe('buildWaterfall', () => {
  const s = (span_id: string, parent_span_id: string | null, a: number, b: number, total_tokens = 0) => ({
    span_id, parent_span_id, total_tokens, duration_ms: b - a,
    start_time: new Date(1_000_000 + a).toISOString(), end_time: new Date(1_000_000 + b).toISOString(),
  })
  it('nests by parent, orders by start, scales bars, marks aggregates', () => {
    const { rows, totalMs } = buildWaterfall([
      s('c2', 'root', 500, 1000, 10), s('root', null, 0, 1000, 30), s('c1', 'root', 0, 400, 20), s('g1', 'c1', 100, 200), s('orphan', 'missing', 900, 950),
    ])
    expect(totalMs).toBe(1000)
    expect(rows.map(r => `${r.span.span_id}:${r.depth}`)).toEqual(['root:0', 'c1:1', 'g1:2', 'c2:1', 'orphan:0'])
    const c2 = rows.find(r => r.span.span_id === 'c2')!
    expect(c2.offsetPct).toBe(50)
    expect(c2.widthPct).toBe(50)
    expect(rows.find(r => r.span.span_id === 'root')!.aggregate).toBe(true)
    expect(rows.find(r => r.span.span_id === 'c1')!.aggregate).toBe(false)
  })
  it('survives cycles and missing times', () => {
    const { rows } = buildWaterfall([
      { span_id: 'a', parent_span_id: 'b', start_time: null, end_time: null, duration_ms: null, total_tokens: 0 },
      { span_id: 'b', parent_span_id: 'a', start_time: null, end_time: null, duration_ms: null, total_tokens: 0 },
    ])
    expect(rows).toHaveLength(2)
  })
})
