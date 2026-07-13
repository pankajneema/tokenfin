/**
 * Outbound alert delivery — email (Resend), Slack (incoming webhook), and generic
 * webhook. All senders are FAIL-OPEN: they never throw, and return { sent } so the
 * caller can record what happened. Missing config (no API key / no URL) → skipped,
 * not an error. Server-only.
 */

export async function sendEmail(to: string[], subject: string, text: string): Promise<{ sent: boolean; reason?: string }> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.ALERT_EMAIL_FROM || 'TokenFin <alerts@tokenfin.curiousdevs.com>'
  const recipients = to.filter(Boolean)
  if (!key) return { sent: false, reason: 'RESEND_API_KEY not set' }
  if (recipients.length === 0) return { sent: false, reason: 'no recipients' }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: recipients, subject, text }),
    })
    return { sent: res.ok, reason: res.ok ? undefined : `resend ${res.status}` }
  } catch (e) { return { sent: false, reason: (e as Error).message } }
}

export async function sendSlack(webhookUrl: string | null | undefined, text: string): Promise<{ sent: boolean; reason?: string }> {
  if (!webhookUrl) return { sent: false, reason: 'no slack webhook' }
  try {
    const res = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
    return { sent: res.ok, reason: res.ok ? undefined : `slack ${res.status}` }
  } catch (e) { return { sent: false, reason: (e as Error).message } }
}

export async function sendWebhook(url: string | null | undefined, payload: unknown): Promise<{ sent: boolean; reason?: string }> {
  if (!url) return { sent: false, reason: 'no webhook url' }
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    return { sent: res.ok, reason: res.ok ? undefined : `webhook ${res.status}` }
  } catch (e) { return { sent: false, reason: (e as Error).message } }
}
