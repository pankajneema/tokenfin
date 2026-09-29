/**
 * Pure helpers for the app shell: most-specific active-route matching and a
 * small fuzzy scorer for the ⌘K palette. No React / icons, so unit-testable.
 */

/** Strip query/hash and a trailing slash. */
function clean(p: string): string {
  const s = p.split(/[?#]/)[0]
  return s.length > 1 ? s.replace(/\/+$/, '') : s
}

/** True if `href` is `pathname` or a path-segment prefix of it. */
export function hrefMatches(pathname: string, href: string): boolean {
  const p = clean(pathname), h = clean(href)
  return p === h || p.startsWith(h + '/')
}

/**
 * The single most specific href that matches `pathname` (longest match wins),
 * so /dashboard/analytics/models activates "By model", not "Usage", and
 * /dashboard never lights up for every child page.
 */
export function activeHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null
  for (const h of hrefs) {
    if (!hrefMatches(pathname, h)) continue
    if (!best || clean(h).length > clean(best).length) best = h
  }
  return best
}

/**
 * Fuzzy score of `query` against `text` (higher is better, null = no match).
 * Prefers exact/prefix/word-start/substring matches, then in-order subsequence.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 0
  if (t === q) return 1000
  if (t.startsWith(q)) return 800 - t.length
  const idx = t.indexOf(q)
  if (idx >= 0) {
    const wordStart = idx === 0 || /[\s/·\-_(]/.test(t[idx - 1])
    return (wordStart ? 600 : 400) - idx
  }
  // All query words present somewhere (any order).
  const words = q.split(/\s+/).filter(Boolean)
  if (words.length > 1 && words.every(w => t.includes(w))) return 300
  // In-order subsequence; reward consecutive runs and word starts.
  let ti = 0, score = 0, run = 0
  for (const ch of q.replace(/\s+/g, '')) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return null
    run = found === ti ? run + 1 : 0
    score += 1 + run * 2 + (found === 0 || /[\s/·\-_(]/.test(t[found - 1]) ? 3 : 0)
    ti = found + 1
  }
  return Math.min(250, score * 4 - (t.length - q.length))
}

export interface Searchable { label: string; keywords?: string; section?: string }

/** Best score across the label (weighted) and keywords/section. */
export function scoreItem(query: string, item: Searchable): number | null {
  const a = fuzzyScore(query, item.label)
  const b = item.keywords ? fuzzyScore(query, item.keywords) : null
  const c = item.section ? fuzzyScore(query, `${item.section} ${item.label}`) : null
  const best = Math.max(a ?? -Infinity, b != null ? b - 50 : -Infinity, c != null ? c - 80 : -Infinity)
  return Number.isFinite(best) ? best : null
}

export function fuzzyFilter<T extends Searchable>(query: string, items: readonly T[], limit = 12): T[] {
  if (!query.trim()) return items.slice(0, limit)
  return items
    .map((it, i) => ({ it, i, s: scoreItem(query, it) }))
    .filter(x => x.s != null && x.s > 0)
    .sort((a, b) => (b.s! - a.s!) || (a.i - b.i))
    .slice(0, limit)
    .map(x => x.it)
}
