import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Auth middleware — runs on every non-static request.
 *
 * Rules:
 *  1. Always refresh the Supabase session cookie (so tokens don't expire mid-session).
 *  2. Unauthenticated user hitting a protected route  → /login?next=<intended-path>
 *  3. Authenticated user hitting an auth page         → /dashboard
 *
 * Deeper guards (org membership, onboarding, plan selection) live in the
 * (dashboard) layout server component so we avoid a DB round-trip on every
 * middleware invocation.
 */
export async function middleware(request: NextRequest) {
  // Start with a pass-through response; may be replaced inside setAll.
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          // Propagate refreshed cookies onto both the forwarded request
          // and the outgoing response so the next render picks them up.
          toSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Use getUser() — not getSession() — to re-validate against the Auth server.
  // This prevents stale / forged local JWTs from granting access.
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Paths that are accessible without authentication
  const isAuthPage  = pathname.startsWith('/login')
                   || pathname.startsWith('/signup')
                   || pathname.startsWith('/forgot-password')
                   || pathname.startsWith('/reset-password')
  const isCallback  = pathname.startsWith('/auth')
  const isPublicApi = pathname.startsWith('/api/orgs')
                   || pathname.startsWith('/api/invites')
                   || pathname.startsWith('/api/v1/invites')
  const isPublic    = isAuthPage || isCallback || isPublicApi

  // ── Rule 1: unauthenticated → login ───────────────────────────────────────
  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    // Preserve the intended destination for post-login redirect
    if (pathname !== '/') url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  // ── Rule 2: authenticated → bounce off auth pages ─────────────────────────
  if (user && isAuthPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.search   = ''
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    // Match everything except Next.js internals and static assets
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)',
  ],
}
