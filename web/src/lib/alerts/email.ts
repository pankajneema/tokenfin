/**
 * Alert email with a local-development fallback.
 *
 * Production sends through Resend (lib/notify/send.ts, RESEND_API_KEY). When
 * that key is absent the email used to be skipped silently. Now, outside
 * production only, it is delivered to Mailpit — the mail catcher the Supabase
 * CLI runs next to a local stack — through Mailpit's HTTP send API:
 *
 *   ALERT_EMAIL_MAILPIT_URL=http://127.0.0.1:54324   explicit, or
 *   NEXT_PUBLIC_SUPABASE_URL on localhost:<port>      → http://<host>:<port+3>
 *                                                      (Supabase CLI layout: API 54321 → Mailpit 54324)
 *
 * Never used when NODE_ENV === 'production' (a production box without Resend
 * reports "RESEND_API_KEY not set" exactly as before). Fail-open: never throws.
 */
import { sendEmail } from '@/lib/notify/send'

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]'])

export function mailpitUrl(env: Record<string, string | undefined> = process.env): string | null {
  if (env.NODE_ENV === 'production') return null
  const explicit = env.ALERT_EMAIL_MAILPIT_URL?.trim()
  const pick = (raw: string): string | null => {
    try { const u = new URL(raw); return LOCAL.has(u.hostname) && u.protocol === 'http:' ? u.origin : null } catch { return null }
  }
  if (explicit) return pick(explicit)
  const sb = env.NEXT_PUBLIC_SUPABASE_URL
  if (!sb) return null
  try {
    const u = new URL(sb)
    if (!LOCAL.has(u.hostname) || !u.port) return null
    return `http://${u.hostname}:${Number(u.port) + 3}`
  } catch { return null }
}

export type EmailResult = { sent: boolean; via?: 'resend' | 'mailpit'; reason?: string }

export async function sendAlertEmail(to: string[], subject: string, text: string, html?: string): Promise<EmailResult> {
  const r = await sendEmail(to, subject, text, html)
  if (r.sent) return { ...r, via: 'resend' }
  if (r.reason !== 'RESEND_API_KEY not set') return r
  const base = mailpitUrl()
  if (!base) return r
  const recipients = to.filter(Boolean)
  if (!recipients.length) return { sent: false, reason: 'no recipients' }
  const from = process.env.ALERT_EMAIL_FROM || 'TokenFin <alerts@tokenfin.local>'
  const m = /^(.*)<([^>]+)>\s*$/.exec(from)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5_000)
  try {
    const res = await fetch(`${base}/api/v1/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        From: m ? { Name: m[1].trim(), Email: m[2].trim() } : { Email: from },
        To: recipients.map(Email => ({ Email })),
        Subject: subject, Text: text, ...(html ? { HTML: html } : {}),
        Tags: ['tokenfin-alert'],
      }),
      signal: ctrl.signal,
    })
    return res.ok ? { sent: true, via: 'mailpit' } : { sent: false, reason: `mailpit ${res.status}` }
  } catch (e) {
    return { sent: false, reason: `RESEND_API_KEY not set; mailpit: ${(e as Error).message}` }
  } finally { clearTimeout(timer) }
}
