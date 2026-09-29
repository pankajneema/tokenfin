import { describe, it, expect, vi, afterEach } from 'vitest'
import { TtlCache } from './cache'

afterEach(() => vi.useRealTimers())

describe('TtlCache', () => {
  it('expires entries after their TTL', () => {
    vi.useFakeTimers()
    const c = new TtlCache<string, number>(10, 1000)
    c.set('a', 1)
    expect(c.get('a')).toBe(1)
    vi.advanceTimersByTime(1001)
    expect(c.get('a')).toBeUndefined()
  })

  it('evicts the least recently used entry beyond max', () => {
    const c = new TtlCache<string, number>(2, 60_000)
    c.set('a', 1); c.set('b', 2)
    c.get('a')          // a is now most recent
    c.set('c', 3)       // evicts b
    expect(c.get('b')).toBeUndefined()
    expect(c.get('a')).toBe(1)
    expect(c.get('c')).toBe(3)
  })

  it('getOrLoad coalesces concurrent misses into one load', async () => {
    const c = new TtlCache<string, number>(10, 60_000)
    const load = vi.fn(async () => 42)
    const [x, y] = await Promise.all([c.getOrLoad('k', load), c.getOrLoad('k', load)])
    expect([x, y]).toEqual([42, 42])
    expect(load).toHaveBeenCalledTimes(1)
    await c.getOrLoad('k', load)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not cache rejected loads, and honours per-value TTL (0 = skip)', async () => {
    const c = new TtlCache<string, number | null>(10, 60_000)
    await expect(c.getOrLoad('k', async () => { throw new Error('db down') })).rejects.toThrow('db down')
    expect(c.has('k')).toBe(false)
    await c.getOrLoad('k', async () => null, v => (v == null ? 0 : 60_000))
    expect(c.get('k')).toBeUndefined()
  })
})
