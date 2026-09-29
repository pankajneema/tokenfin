/**
 * Supabase server-side clients
 *
 * createClient()       — anon/user client (respects RLS via session cookie)
 * createAdminClient()  — service-role client (bypasses RLS, server-only)
 *
 * Compatible with: Next.js 14 + @supabase/ssr ^0.5.x
 * Upgrade note for Next.js 15: wrap cookies() with await.
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient as createSupabaseClient }   from '@supabase/supabase-js'
import { cookies }                                from 'next/headers'

export function createClient() {
  // Next 15: cookies() is async. Call it now (so Next marks the route dynamic,
  // as before) and await it inside the async cookie callbacks @supabase/ssr
  // supports, which keeps createClient() synchronous for every caller.
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: async () => (await cookieStore).getAll(),
        setAll: async (toSet: { name: string; value: string; options: CookieOptions }[]) => {
          try {
            const store = await cookieStore
            toSet.forEach(({ name, value, options }) =>
              store.set(name, value, options)
            )
          } catch {
            // Server Component context — writes are silently ignored.
            // Middleware handles session refresh via supabaseResponse.
          }
        },
      },
    }
  )
}

/**
 * Service-role client — bypasses all RLS.
 * Use only in server-side code (API routes, Server Actions).
 * Never expose to the browser.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      // Next.js caches GET fetches by default; a service-role client must always
      // read fresh (stale privileged reads cause subtle bugs, e.g. alert cooldown
      // re-firing on a cached last_fired_at). Force no-store on every request.
      global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: 'no-store' }) },
    }
  )
}

/** @deprecated Use createAdminClient() */
export const createServiceRoleClient = createAdminClient
