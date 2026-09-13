import { describe, expect, it } from 'vitest'
import { fetchAllPages } from './paginate'

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
