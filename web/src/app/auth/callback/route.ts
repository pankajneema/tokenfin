/**
 * /auth/callback
 *
 * Handles two flows:
 *  A. OAuth sign-in (GitHub / Google) — Supabase redirects here with ?code=
 *  B. Password reset email link       — redirectTo includes ?next=/reset-password
 *
 * After exchanging the code for a session, the user is sent to `next`
 * (defaults to /dashboard). The dashboard layout then handles org/onboarding
 * guards if this is a brand-new user.
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies }                               from 'next/headers'
import { NextResponse }                          from 'next/server'
import type { NextRequest }                      from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)

  const code        = searchParams.get('code')
  const errorParam  = searchParams.get('error')
  const errorDesc   = searchParams.get('error_description')

  // ── OAuth/SSO error from provider ────────────────────────────────────────
  if (errorParam) {
    const url = new URL(`${origin}/login`)
    url.searchParams.set('error', errorDesc ?? errorParam)
    return NextResponse.redirect(url.toString())
  }

  // ── No code → something went wrong ───────────────────────────────────────
  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
  }

  // Validate the `next` param — only allow relative paths to prevent open redirects.
  const rawNext = searchParams.get('next') ?? '/dashboard'
  const next    = rawNext.startsWith('/') ? rawNext : '/dashboard'

  const cookieStore = cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet: { name: string; value: string; options: CookieOptions }[]) =>
          toSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          ),
      },
    }
  )

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] exchangeCodeForSession error:', error.message)
    const url = new URL(`${origin}/login`)
    url.searchParams.set('error', 'Session exchange failed. Please try again.')
    return NextResponse.redirect(url.toString())
  }

  // Session set — send the user on their way.
  return NextResponse.redirect(`${origin}${next}`)
}
