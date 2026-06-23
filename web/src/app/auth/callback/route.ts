/**
 * /auth/callback
 *
 * Handles two flows:
 *  A. OAuth sign-in (GitHub / Google) — Supabase redirects here with ?code=
 *  B. Password reset email link       — redirectTo includes ?next=/reset-password
 *
 * After exchanging the code for a session:
 *  - Password reset → send to /reset-password
 *  - New user (no org membership) → send to /plans
 *  - Existing user → send to `next` (default /dashboard)
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies }                               from 'next/headers'
import { NextResponse }                          from 'next/server'
import type { NextRequest }                      from 'next/server'
import { createAdminClient }                     from '@/lib/supabase/server'

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

  const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] exchangeCodeForSession error:', error.message)
    const url = new URL(`${origin}/login`)
    url.searchParams.set('error', 'Session exchange failed. Please try again.')
    return NextResponse.redirect(url.toString())
  }

  // Password-reset flow — always send to reset page, skip membership check.
  if (next === '/reset-password') {
    return NextResponse.redirect(`${origin}${next}`)
  }

  // For new users (OAuth signup or email confirm), check if they have an org.
  // If not, send them to /plans. Existing users go to `next` (/dashboard).
  const userId = sessionData?.user?.id
  if (userId) {
    const admin = createAdminClient()
    const { data: members } = await admin
      .from('members')
      .select('id')
      .eq('user_id', userId)
      .limit(1)

    if (!members || members.length === 0) {
      console.log('[auth/callback] new user — no membership, redirecting to /plans')
      return NextResponse.redirect(`${origin}/plans`)
    }
  }

  // Existing user — send to their intended destination.
  return NextResponse.redirect(`${origin}${next}`)
}
