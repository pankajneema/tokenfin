import { describe, expect, it } from 'vitest'
import { fetchAllPages, selectAll, selectAllKeyset, keysetColumnsFor } from './paginate'

describe('fetchAllPages', () => {
  it('walks past the Supabase 1,000-row response boundary', async () => {
    const rows = Array.from({ length: 2_001 }, (_, id) => ({ id }))
    const result = await fetchAllPages(async (from, to) => ({
      data: rows.slice(from, to + 1),
      error: null,
    }))
    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(2_001)
    expect(result.data.at(-1)?.id).toBe(2_000)
  })

  it('returns a database error without hiding rows already fetched', async () => {
    const result = await fetchAllPages(async (from, to) =>
      from === 0
        ? { data: Array.from({ length: to - from + 1 }, (_, id) => ({ id })), error: null }
        : { data: [], error: new Error('database unavailable') },
    )
    expect(result.data).toHaveLength(1_000)
    expect(result.error).toBeInstanceOf(Error)
  })
})

// ── keyset pagination ────────────────────────────────────────────────────────

type Row = { id: string; created_at: string; v: number }

/** Minimal PostgREST-like builder over an in-memory table; records calls. */
function fakeTable(rows: Row[], select = 'id, created_at, v', extra: Record<string, string> = {}) {
  const calls: string[] = []
  const build = () => {
    const url = new URL('http://db/rest/v1/usage_events')
    url.searchParams.set('select', select)
    for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v)
    let filtered = rows.slice()
    const orders: string[] = []
    let from = 0
    let to = Infinity
    const unq = (s: string) => s.replace(/^"|"$/g, '')
    const q: any = {
      url,
      gt(col: string, val: any) { calls.push(`gt:${col}`); filtered = filtered.filter(r => (r as any)[col] > val); return q },
      or(expr: string) {
        calls.push('or')
        const m = expr.match(/^(\w+)\.gt\.("[^"]*"),and\(\w+\.eq\.("[^"]*"),(\w+)\.gt\.("[^"]*")\)$/)!
        const [, a, av, , b, bv] = m
        filtered = filtered.filter(r => (r as any)[a] > unq(av) || ((r as any)[a] === unq(av) && (r as any)[b] > unq(bv)))
        return q
      },
      order(col: string) { orders.push(col); return q },
      range(f: number, t: number) { calls.push(`range:${f}`); from = f; to = t; return q },
      limit(n: number) { calls.push('limit'); to = from + n - 1; return q },
      then(res: any) {
        const sorted = filtered.slice().sort((x: any, y: any) => {
          for (const c of orders) { if (x[c] < y[c]) return -1; if (x[c] > y[c]) return 1 }
          return 0
        })
        res({ data: sorted.slice(from, to + 1), error: null })
      },
    }
    return q
  }
  return { build, calls }
}

const mkRows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({
  // many rows share a timestamp, so the id tiebreak matters
  id: String(i).padStart(6, '0'), created_at: `2026-09-${String(1 + Math.floor(i / 700)).padStart(2, '0')}T00:00:00+00:00`, v: i,
}))

describe('keyset pagination', () => {
  it('selectAllKeyset returns every row exactly once across pages with tied timestamps', async () => {
    const rows = mkRows(2_500)
    const t = fakeTable(rows)
    const { data } = await selectAllKeyset<Row>(t.build)
    expect(data).toHaveLength(2_500)
    expect(new Set(data.map(r => r.id)).size).toBe(2_500)
    expect(t.calls.filter(c => c === 'or')).toHaveLength(2)   // pages 2 and 3 seek past the last row
    expect(t.calls.some(c => c.startsWith('range'))).toBe(false)
  })

  it('selectAll uses keyset when the select has created_at + id', async () => {
    const t = fakeTable(mkRows(1_200))
    const { data } = await selectAll<Row>(t.build)
    expect(data).toHaveLength(1_200)
    expect(t.calls).toContain('or')
  })

  it('selectAll falls back to offset paging without id / created_at, or with a caller order', async () => {
    expect(keysetColumnsFor(fakeTable([], 'cost_usd, model').build())).toBeNull()
    expect(keysetColumnsFor(fakeTable([], 'id, cost_usd').build())).toEqual(['id'])
    expect(keysetColumnsFor(fakeTable([], '*').build())).toEqual(['created_at', 'id'])
    expect(keysetColumnsFor(fakeTable([], 'id, created_at', { order: 'created_at.desc' }).build())).toBeNull()
    expect(keysetColumnsFor(fakeTable([], 'id, created_at, projects(id, created_at)').build())).toEqual(['created_at', 'id'])
    const t = fakeTable(mkRows(1_500), 'v')
    const { data } = await selectAll<Row>(t.build)
    expect(data).toHaveLength(1_500)
    expect(t.calls.filter(c => c.startsWith('range'))).toEqual(['range:0', 'range:1000'])
  })
})
