/**
 * Team invitations — server-only.
 *
 * Link flow (works without any Supabase redirect-URL or email-template setup):
 *   admin.generateLink(invite | magiclink) → hashed token
 *   → our email links to  /auth/confirm?token_hash=…&type=…&next=/accept-invitation
 *   → /auth/confirm verifies it server-side (verifyOtp) and sets the session cookie
 *   → /accept-invitation joins the org.
 *
 * New emails get an `invite` link (account created, password set on the accept
 * page). Emails that already have an account get a `magiclink` sign-in link
 * (Supabase's inviteUserByEmail refuses those).
 *
 * When RESEND_API_KEY is not configured we fall back to Supabase's own mailer
 * (inviteUserByEmail / signInWithOtp). Customise that template with
 * docs/email-templates/invite.html so its link also uses /auth/confirm.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/notify/send'

export const ACCEPT_PATH = '/accept-invitation'

export interface PendingInvite {
  id: string
  org_id: string
  role: string
  expires_at: string | null
  org_name: string
}

/** The newest pending, unexpired invitation for an email (with the org name). */
export async function findPendingInvite(admin: SupabaseClient, email: string | null | undefined): Promise<PendingInvite | null> {
  const e = (email ?? '').trim().toLowerCase()
  if (!e) return null
  const { data } = await admin
    .from('invitations')
    .select('id, org_id, role, expires_at, organizations(name)')
    .eq('email', e)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(5)
  const now = Date.now()
  const row = (data ?? []).find(r => !r.expires_at || Date.parse(r.expires_at as string) > now)
  if (!row) return null
  const org = row.organizations as unknown as { name?: string } | { name?: string }[] | null
  const orgName = (Array.isArray(org) ? org[0]?.name : org?.name) ?? 'your team'
  return { id: row.id as string, org_id: row.org_id as string, role: (row.role as string) ?? 'member', expires_at: (row.expires_at as string) ?? null, org_name: orgName }
}

/** Absolute confirm URL for a hashed token. `type` is what verifyOtp expects. */
export function confirmUrl(appUrl: string, tokenHash: string, type: 'invite' | 'magiclink'): string {
  const u = new URL('/auth/confirm', appUrl)
  u.searchParams.set('token_hash', tokenHash)
  u.searchParams.set('type', type)
  u.searchParams.set('next', ACCEPT_PATH)
  return u.toString()
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

/** Subject + plain text + HTML for an invite email. Pure (unit-tested). */
export function inviteEmail(p: { orgName: string; inviter: string | null; link: string; existingAccount: boolean; appUrl: string }) {
  const who = p.inviter ? `${p.inviter} invited you` : 'You have been invited'
  const subject = `${p.inviter ?? 'Your team'} invited you to ${p.orgName} on TokenFin`
  const action = p.existingAccount ? 'Sign in and join' : 'Accept invitation'
  const expiry = 'For security this link works once and expires soon. If it has expired, ask for a new invite'
    + (p.existingAccount ? ', or sign in at ' + p.appUrl + ACCEPT_PATH + '.' : '.')
  const text = [
    `${who} to join ${p.orgName} on TokenFin — LLM cost tracking for your team.`,
    '',
    `${action}: ${p.link}`,
    '',
    expiry,
    '',
    "If you weren't expecting this, you can ignore this email.",
  ].join('\n')
  const html = `<!doctype html><html><body style="margin:0;background:#f6f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a2e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e7e5e0;border-radius:16px;padding:32px">
<tr><td style="font-size:15px;font-weight:700;color:#E8533A;padding-bottom:20px">TokenFin</td></tr>
<tr><td style="font-size:20px;font-weight:700;line-height:1.3;padding-bottom:8px">Join ${esc(p.orgName)}</td></tr>
<tr><td style="font-size:14px;line-height:1.6;color:#4a4a5e;padding-bottom:24px">${esc(who)} to join <strong>${esc(p.orgName)}</strong> on TokenFin — LLM cost tracking for your team.</td></tr>
<tr><td style="padding-bottom:24px"><a href="${esc(p.link)}" style="display:inline-block;background:#E8533A;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px">${esc(action)} →</a></td></tr>
<tr><td style="font-size:12px;line-height:1.6;color:#8a8a9a">${esc(expiry)}<br>Button not working? Paste this link into your browser:<br><span style="word-break:break-all;color:#4a4a5e">${esc(p.link)}</span></td></tr>
</table>
<p style="font-size:11px;color:#8a8a9a;margin-top:16px">If you weren't expecting this, you can ignore this email.</p>
</td></tr></table></body></html>`
  return { subject, text, html }
}

export type InviteSendResult = { status: 'sent'; via: 'email' | 'supabase' } | { status: 'failed'; error: string }

const isAlreadyRegistered = (msg: string | undefined) => /already (been )?registered|already exists|email_exists/i.test(msg ?? '')

/** Send one invitation email. The invitations row is written by the caller. */
export async function sendInvite(admin: SupabaseClient, p: {
  email: string; orgId: string; orgName: string; inviterId: string; inviter: string | null; appUrl: string
}): Promise<InviteSendResult> {
  // Flag read by the accept page: brand-new accounts must set a password there.
  const data = { org_id: p.orgId, invited_by: p.inviterId, tf_needs_password: true }

  if (process.env.RESEND_API_KEY) {
    let type: 'invite' | 'magiclink' = 'invite'
    let res = await admin.auth.admin.generateLink({ type: 'invite', email: p.email, options: { data } })
    if (res.error && isAlreadyRegistered(res.error.message)) {
      type = 'magiclink'
      res = await admin.auth.admin.generateLink({ type: 'magiclink', email: p.email })
    }
    const hashed = res.data?.properties?.hashed_token
    if (res.error || !hashed) return { status: 'failed', error: res.error?.message ?? 'could not create the invite link' }
    const mail = inviteEmail({ orgName: p.orgName, inviter: p.inviter, link: confirmUrl(p.appUrl, hashed, type), existingAccount: type === 'magiclink', appUrl: p.appUrl })
    const sent = await sendEmail([p.email], mail.subject, mail.text, mail.html)
    return sent.sent ? { status: 'sent', via: 'email' } : { status: 'failed', error: `email not sent (${sent.reason})` }
  }

  // Fallback: Supabase's mailer. /auth/callback + the login page's hash handler
  // finish the sign-in and route to the accept page.
  const redirectTo = `${p.appUrl}/auth/callback?next=${ACCEPT_PATH}`
  const inv = await admin.auth.admin.inviteUserByEmail(p.email, { redirectTo, data })
  if (!inv.error) return { status: 'sent', via: 'supabase' }
  if (!isAlreadyRegistered(inv.error.message)) return { status: 'failed', error: inv.error.message }
  const otp = await admin.auth.signInWithOtp({ email: p.email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } })
  return otp.error ? { status: 'failed', error: otp.error.message } : { status: 'sent', via: 'supabase' }
}
