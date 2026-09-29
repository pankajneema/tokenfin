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

type RangeableQuery<T> = {
  order: (column: string, opts?: { ascending?: boolean }) => RangeableQuery<T>
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
}

/** Drop-in replacement for an awaited select that must return EVERY row.
 * `build` must return a fresh query each call; a stable `id` order is added so
 * pages never overlap or skip rows. Resolves to `{ data }` like a normal query.
 */
export async function selectAll<T>(build: () => unknown): Promise<{ data: T[] }> {
  const data = await fetchAllRows<T>((from, to) =>
    (build() as RangeableQuery<T>).order('id', { ascending: true }).range(from, to))
  return { data }
}
