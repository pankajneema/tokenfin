/** Fetch every row from a Supabase query in bounded pages.
 * Supabase commonly caps a response at 1,000 rows; analytics must not treat
 * that transport cap as a business limit.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
  maxRows = 1_000_000,
): Promise<{ data: T[]; error: unknown | null }> {
  const all: T[] = []
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await fetchPage(from, Math.min(from + pageSize - 1, maxRows - 1))
    if (error) return { data: all, error }
    const page = data ?? []
    all.push(...page)
    if (page.length < pageSize) return { data: all, error: null }
  }
  return { data: all, error: new Error(`Analytics result exceeds ${maxRows.toLocaleString()} rows`) }
}

export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const result = await fetchAllPages(fetchPage)
  if (result.error) throw result.error
  return result.data
}

type PageResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>

/** The subset of a PostgREST filter builder the helpers below rely on. */
type KeysetQuery<T> = {
  order: (column: string, opts?: { ascending?: boolean }) => KeysetQuery<T>
  range: (from: number, to: number) => PageResult<T>
  limit: (n: number) => PageResult<T> & KeysetQuery<T>
  gt: (column: string, value: unknown) => KeysetQuery<T>
  or: (filters: string) => KeysetQuery<T>
  url?: URL
}

const PAGE = 1000
const MAX_ROWS = 1_000_000

/** A PostgREST `or=` literal value, quoted so ':' '+' ',' survive. */
const quote = (v: unknown) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/**
 * Keyset ("seek") pagination: each page filters past the last row of the
 * previous one instead of using OFFSET, so page N costs the same as page 1 and
 * rows inserted mid-scan can't shift pages. `orderCols` must be a unique
 * ordering (last column unique, e.g. `id`) and must be present in the select.
 * Supports one or two order columns.
 */
export async function selectAllKeyset<T extends Record<string, any>>(
  build: () => unknown,
  orderCols: string[] = ['created_at', 'id'],
  pageSize = PAGE,
): Promise<{ data: T[] }> {
  if (orderCols.length < 1 || orderCols.length > 2) throw new Error('selectAllKeyset supports 1 or 2 order columns')
  const all: T[] = []
  let last: T | null = null
  while (all.length < MAX_ROWS) {
    let q = build() as KeysetQuery<T>
    if (last) {
      if (orderCols.length === 1) {
        q = q.gt(orderCols[0], last[orderCols[0]])
      } else {
        const [a, b] = orderCols
        q = q.or(`${a}.gt.${quote(last[a])},and(${a}.eq.${quote(last[a])},${b}.gt.${quote(last[b])})`)
      }
    }
    for (const c of orderCols) q = q.order(c, { ascending: true })
    const { data, error } = await q.limit(pageSize)
    if (error) throw error
    const page = data ?? []
    all.push(...page)
    if (page.length < pageSize) return { data: all }
    last = page[page.length - 1]
    for (const c of orderCols) {
      if (last[c] === undefined) throw new Error(`selectAllKeyset: order column "${c}" missing from select`)
    }
  }
  throw new Error(`Analytics result exceeds ${MAX_ROWS.toLocaleString()} rows`)
}

// Tables known to carry both created_at and id, for `select=*` queries.
const KEYSET_TABLES = new Set(['usage_events', 'prompt_captures', 'notifications', 'audit_log', 'spans', 'api_keys'])

/** Pick a pagination strategy from the query's own URL (table + select list). */
export function keysetColumnsFor(query: unknown): string[] | null {
  const url = (query as { url?: URL } | null)?.url
  if (!url || typeof url.searchParams?.get !== 'function') return null
  // A caller-supplied order / limit / range defines its own paging semantics.
  for (const p of ['order', 'limit', 'offset']) if (url.searchParams.has(p)) return null
  const select = url.searchParams.get('select') ?? '*'
  const table = url.pathname.split('/').filter(Boolean).pop() ?? ''
  // Top-level column names only (embedded resources "x(...)" are ignored).
  let depth = 0, cur = ''
  const cols: string[] = []
  for (const ch of select) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) { cols.push(cur); cur = ''; continue }
    if (depth === 0 && ch !== ')') cur += ch
  }
  cols.push(cur)
  // "alias:column" selects the column under the alias; keyset needs the plain name.
  const names = new Set(cols.map(c => c.trim()).filter(c => c && !c.includes(':')))
  const star = names.has('*')
  const hasId = names.has('id') || (star && KEYSET_TABLES.has(table))
  const hasCreated = names.has('created_at') || (star && KEYSET_TABLES.has(table))
  if (hasId && hasCreated) return ['created_at', 'id']
  if (hasId) return ['id']
  return null
}

/** Drop-in replacement for an awaited select that must return EVERY row.
 * `build` must return a fresh query each call. When the select includes
 * `created_at` + `id` (or `id`), pages are walked by keyset; otherwise by a
 * stable `id` order + OFFSET (the original behaviour). Resolves to `{ data }`
 * like a normal query.
 */
export async function selectAll<T>(build: () => unknown): Promise<{ data: T[] }> {
  const cols = keysetColumnsFor(build())
  if (cols) return selectAllKeyset<T & Record<string, any>>(build, cols) as Promise<{ data: T[] }>
  const data = await fetchAllRows<T>((from, to) =>
    (build() as KeysetQuery<T>).order('id', { ascending: true }).range(from, to))
  return { data }
}
