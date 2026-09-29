/**
 * Tiny in-process TTL + LRU cache for hot-path lookups (API-key auth, org
 * prices, org settings, member emails). Per server instance only — every value
 * cached here must be safe to serve up to `ttlMs` stale.
 *
 * `getOrLoad` also coalesces concurrent misses for the same key into a single
 * loader call, so a burst of exporter requests costs one DB round trip.
 */
export class TtlCache<K, V> {
  private map = new Map<K, { v: V; exp: number }>()
  private inflight = new Map<K, Promise<V>>()

  constructor(private readonly max = 1000, private readonly ttlMs = 60_000) {}

  get size(): number { return this.map.size }

  get(key: K): V | undefined {
    const hit = this.map.get(key)
    if (!hit) return undefined
    if (hit.exp <= Date.now()) { this.map.delete(key); return undefined }
    // LRU: re-insert so the key becomes the most recently used.
    this.map.delete(key)
    this.map.set(key, hit)
    return hit.v
  }

  has(key: K): boolean { return this.get(key) !== undefined }

  set(key: K, v: V, ttlMs = this.ttlMs): void {
    this.map.delete(key)
    this.map.set(key, { v, exp: Date.now() + ttlMs })
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as K
      this.map.delete(oldest)
    }
  }

  delete(key: K): void { this.map.delete(key); this.inflight.delete(key) }

  clear(): void { this.map.clear(); this.inflight.clear() }

  /**
   * Cached value, or run `load` once (concurrent callers share the promise).
   * `ttlFor` may shorten the TTL per value (e.g. negative results); returning
   * 0 skips caching that value. A rejected load is not cached.
   */
  async getOrLoad(key: K, load: () => Promise<V>, ttlFor?: (v: V) => number): Promise<V> {
    const hit = this.get(key)
    if (hit !== undefined) return hit
    const pending = this.inflight.get(key)
    if (pending) return pending
    const p = (async () => {
      try {
        const v = await load()
        const ttl = ttlFor ? ttlFor(v) : this.ttlMs
        if (ttl > 0) this.set(key, v, ttl)
        return v
      } finally {
        this.inflight.delete(key)
      }
    })()
    this.inflight.set(key, p)
    return p
  }
}
