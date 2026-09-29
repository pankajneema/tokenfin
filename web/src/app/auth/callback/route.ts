/**
 * /auth/callback
 *
 * Handles three flows:
 *  A. OAuth sign-in (GitHub / Google) — Supabase redirects here with ?code=
 *  B. Password reset email link       — redirectTo includes ?next=/reset-password
 *  C. Team invitation magic link      — redirectTo includes ?next=/accept-invitation
 *
 * After exchanging the code for a session:
 *  - Password reset     → /reset-password
 *  - Invite acceptance  → /accept-invitation  (skip membership check — they have none yet)
 *  - New user, no org   → /welcome
 *  - Existing user      → `next` (default /dashboard)
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies }                               from 'next/headers'
import { NextResponse }                          from 'next/server'
import type { NextRequest }                      from 'next/server'
import { createAdminClient }                     from '@/lib/supabase/server'
import { findPendingInvite, ACCEPT_PATH }        from '@/lib/invites'

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

  // ── No code ──────────────────────────────────────────────────────────────
  // Supabase-mailer invite / magic links arrive with the session in the URL
  // HASH (#access_token=…), which a server never sees. Hand off to /login with
  // no error: the browser keeps the hash across this redirect and the login
  // page finishes the sign-in, then continues to `next`.
  if (!code) {
    const rawNext = searchParams.get('next')
    const url = new URL(`${origin}/login`)
    if (rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//')) url.searchParams.set('next', rawNext)
    return NextResponse.redirect(url.toString())
  }

  // Validate the `next` param — only allow relative paths to prevent open redirects.
  const rawNext = searchParams.get('next') ?? '/dashboard'
  const next    = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard'

  const cookieStore = await cookies()

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

  // Password-reset flow — send to reset page, skip membership check.
  if (next === '/reset-password') {
    return NextResponse.redirect(`${origin}${next}`)
  }

  // Invite flow — user has no membership yet; send straight to accept page.
  if (next === '/accept-invitation') {
    return NextResponse.redirect(`${origin}/accept-invitation`)
  }

  // For new users (OAuth signup or email confirm), check if they have an org.
  // If not, send them to /welcome. Existing users go to `next` (/dashboard).
  const userId = sessionData?.user?.id
  if (userId) {
    const admin = createAdminClient()
    const { data: members } = await admin
      .from('members')
      .select('id')
      .eq('user_id', userId)
      .limit(1)

    if (!members || members.length === 0) {
      // Invited but not yet joined → accept page, never a brand-new workspace.
      const invite = await findPendingInvite(admin, sessionData?.user?.email)
      return NextResponse.redirect(`${origin}${invite ? ACCEPT_PATH : '/welcome'}`)
    }
  }

  // Existing user — send to their intended destination.
  return NextResponse.redirect(`${origin}${next}`)
}
