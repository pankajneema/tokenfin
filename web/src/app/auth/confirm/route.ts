/**
 * /auth/confirm?token_hash=…&type=invite|magiclink|recovery|email&next=/path
 *
 * Server-side email-link verification (the Supabase SSR pattern): verifyOtp
 * exchanges the one-time token for a session cookie, then redirects to `next`.
 * Unlike the default Supabase links this needs no redirect-URL allow-list and
 * never puts tokens in the URL hash. Used by team invites (lib/invites.ts) and
 * any customised Supabase email template (docs/email-templates).
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import type { EmailOtpType } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

const TYPES: EmailOtpType[] = ['invite', 'magiclink', 'recovery', 'email', 'signup', 'email_change']

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const tokenHash = searchParams.get('token_hash')
  const type      = searchParams.get('type') as EmailOtpType | null
  const rawNext   = searchParams.get('next') ?? '/dashboard'
  // Relative paths only (no //host) — prevents open redirects.
  const next      = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard'

  const fail = (msg: string) => {
    const url = new URL('/login', origin)
    url.searchParams.set('error', msg)
    if (next !== '/dashboard') url.searchParams.set('next', next)
    return NextResponse.redirect(url)
  }

  if (!tokenHash || !type || !TYPES.includes(type)) return fail('That link is incomplete. Open the latest email again.')

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet: { name: string; value: string; options: CookieOptions }[]) =>
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
      },
    },
  )

  // A signed-in session for another account would otherwise win — start clean.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {})

  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
  if (error) {
    console.warn('[auth/confirm] verifyOtp failed:', error.message)
    return fail(type === 'invite' || type === 'magiclink'
      ? 'This invite link has expired or was already used. Sign in (or use “Forgot password” with the invited email) to accept the invitation, or ask for a new invite.'
      : 'This link has expired or was already used. Please request a new one.')
  }

  const dest = type === 'recovery' ? '/reset-password' : next
  return NextResponse.redirect(new URL(dest, origin))
}
