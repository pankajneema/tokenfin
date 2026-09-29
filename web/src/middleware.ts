import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Auth middleware — runs on every non-static request.
 *
 * Rules:
 *  1. Always refresh the Supabase session cookie (so tokens don't expire mid-session).
 *  2. Unauthenticated user hitting a protected route  → /login?next=<intended-path>
 *  3. Authenticated user hitting an auth page         → /dashboard
 *
 * Deeper guards (org membership, onboarding) live in the
 * (dashboard) layout server component so we avoid a DB round-trip on every
 * middleware invocation.
 */
// Machine-to-machine endpoints authenticate with API keys / CRON_SECRET.
// They never carry a session cookie, so skip the Supabase round-trip entirely.
// /.well-known/* is public discovery metadata — no session needed either.
const KEY_AUTH_API = ['/api/v1/ingest', '/api/otel/', '/api/mcp', '/api/v1/cron/', '/.well-known/', '/api/health']

export async function middleware(request: NextRequest) {
  if (KEY_AUTH_API.some(p => request.nextUrl.pathname.startsWith(p))) return NextResponse.next()

  // Start with a pass-through response; may be replaced inside setAll.
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet: { name: string; value: string; options: CookieOptions }[]) => {
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
  // Public, token-secured key reveal (used by provisioning links AND the CLI
  // login handoff — both authenticate via an unguessable single-use token, not
  // a session cookie).
  const isReveal    = pathname.startsWith('/keys/reveal')
                   || pathname.startsWith('/api/v1/keys/reveal')
  // API routes do their own auth and return 401 JSON; never redirect them.
  const isApi       = pathname.startsWith('/api/')
  const isLegal     = pathname.startsWith('/privacy') || pathname.startsWith('/terms')
  const isWellKnown = pathname.startsWith('/.well-known/')
  const isPublic    = isAuthPage || isCallback || isReveal || isApi || isLegal || isWellKnown

  // ── Rule 1: unauthenticated → login ───────────────────────────────────────
  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    // Preserve the FULL intended destination (path + query) so flows like
    // /cli/authorize?port=…&state=… survive the login round-trip.
    const dest = pathname + request.nextUrl.search
    url.pathname = '/login'
    url.search   = ''
    if (pathname !== '/') url.searchParams.set('next', dest)
    return NextResponse.redirect(url)
  }

  // ── Rule 2: authenticated → bounce off auth pages ─────────────────────────
  // (reset-password is reached WITH a recovery session, so it must not bounce.)
  if (user && isAuthPage && !pathname.startsWith('/reset-password')) {
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
