'use client'
/**
 * URL-backed state: read the current searchParams, write with router.replace
 * (no history spam, no scroll jump). Any page can use it to make a view shareable.
 *
 *   const { params, update } = useUrlState()
 *   update({ model: 'gpt-5', dim: null })   // null / '' removes the key
 */
import { useCallback, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export type UrlUpdates = Record<string, string | number | null | undefined>

/** Pure: apply updates to a query string; null/undefined/'' delete the key. */
export function applyUpdates(current: string | URLSearchParams, updates: UrlUpdates): URLSearchParams {
  const p = new URLSearchParams(current)
  for (const [k, v] of Object.entries(updates)) {
    if (v == null || v === '') p.delete(k)
    else p.set(k, String(v))
  }
  return p
}

export function useUrlState() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  const replace = useCallback((next: URLSearchParams) => {
    const qs = next.toString()
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }, [router, pathname])

  const update = useCallback((updates: UrlUpdates) => {
    replace(applyUpdates(params?.toString() ?? '', updates))
  }, [params, replace])

  /** Remove the given keys (e.g. all filters) in one navigation. */
  const clear = useCallback((keys: readonly string[]) => {
    update(Object.fromEntries(keys.map(k => [k, null])))
  }, [update])

  return { params: params ?? new URLSearchParams(), update, clear, replace, pending }
}
