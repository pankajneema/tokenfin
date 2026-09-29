/**
 * Weekly digest delivery for one org. Server-only.
 *
 * Idempotent per org per ISO week: a digest_runs row (migration 009) is
 * claimed with INSERT … ON CONFLICT DO NOTHING before anything is sent, so a
 * second run for the same week (overlapping crons, manual re-run) is a no-op.
 *
 * Recipients, per Settings → Notifications (lib/alerts/prefs):
 *   in-app  → owners/admins with weekly_digest_inapp
 *   email   → any member with weekly_digest_email (one email per person, so
 *             addresses are never exposed to each other)
 *   Slack / webhook → the org's active integration, only if at least one
 *             owner/admin turned on weekly_digest_slack
 * Delivery is fail-open (see notify/send).
 */
import { sendEmail, sendSlack, sendWebhook } from '@/lib/notify/send'
import { buildOrgCtx, limitSnapshots } from '@/lib/alerts/engine'
import { resolvePrefs } from '@/lib/alerts/prefs'
import { digestInsightLines } from './insights'
import { getOrgTimezone } from '@/lib/org-timezone'
import { buildDigest, digestText, digestTitle, isEmptyDigest, type DigestBudget, type DigestEvent, type DigestSummary } from './build'

type Admin = ReturnType<typeof import('@/lib/supabase/server')['createAdminClient']>

export interface DigestResult {
  org_id: string
  week: string
  status: 'sent' | 'already_sent' | 'empty' | 'error'
  inapp?: number
  email?: { sent: number; skipped: number; reason?: string }
  slack?: unknown
  webhook?: unknown
  error?: string
}

export async function runDigestForOrg(admin: Admin, orgId: string, emailByUser: Map<string, string>, now: Date = new Date()): Promise<DigestResult> {
  const ctx = await buildOrgCtx(admin, orgId, emailByUser)

  const budgets: DigestBudget[] = limitSnapshots(ctx, now)
    .filter(b => b.pct >= b.warnAt || !b.forecast.onTrack)
    .sort((a, b) => b.forecast.projectedPct - a.forecast.projectedPct)
    .map(b => ({
      label: b.label, period: b.period, spent: b.spent, budget: b.budget, pct: +b.pct.toFixed(1),
      projectedPct: b.forecast.projectedPct, exceedDate: b.forecast.exceedDate,
    }))

  const summary: DigestSummary = buildDigest(ctx.events as DigestEvent[], {
    now, projectName: ctx.projectName, emailByUser, budgets,
  })
  const week = summary.weekKey
  if (isEmptyDigest(summary)) return { org_id: orgId, week, status: 'empty' }

  // Claim the week. Zero rows back = another run already owns it.
  const { data: claimed, error: claimErr } = await admin
    .from('digest_runs')
    .upsert({ org_id: orgId, week_key: week, summary }, { onConflict: 'org_id,week_key', ignoreDuplicates: true })
    .select('org_id')
  if (claimErr) return { org_id: orgId, week, status: 'error', error: claimErr.message }
  if (!claimed || claimed.length === 0) return { org_id: orgId, week, status: 'already_sent' }

  const title = digestTitle(summary)
  // Insights section (top waste findings + latest spike); fail-open.
  const insightLines = await digestInsightLines(admin, orgId, await getOrgTimezone(orgId))
  const body = digestText(summary, process.env.NEXT_PUBLIC_APP_URL)
    + (insightLines.length ? `\n\nInsights\n${insightLines.join('\n')}` : '')
  const members = ctx.members ?? []
  const prefs = (uid: string) => ctx.prefsByUser?.get(uid) ?? resolvePrefs(null)
  const admins = members.filter(m => m.role === 'owner' || m.role === 'admin')
  const result: DigestResult = { org_id: orgId, week, status: 'sent' }

  // In-app (owners/admins)
  const inappRows = admins.filter(m => prefs(m.user_id).weekly_digest_inapp)
    .map(m => ({ org_id: orgId, user_id: m.user_id, type: 'digest', title, body, is_read: false }))
  if (inappRows.length) {
    const { error } = await admin.from('notifications').insert(inappRows)
    result.inapp = error ? 0 : inappRows.length
  } else result.inapp = 0

  // Email (any member who opted in)
  const emails = Array.from(new Set(members
    .filter(m => prefs(m.user_id).weekly_digest_email)
    .map(m => emailByUser.get(m.user_id))
    .filter((e): e is string => !!e)))
  let sent = 0, skipped = 0, reason: string | undefined
  for (const to of emails) {
    const r = await sendEmail([to], `TokenFin ${title}`, body)
    if (r.sent) sent++; else { skipped++; reason = r.reason }
  }
  result.email = { sent, skipped, reason }

  // Slack / webhook (org channel, admin opt-in)
  if (admins.some(m => prefs(m.user_id).weekly_digest_slack)) {
    if (ctx.slackUrl) result.slack = await sendSlack(ctx.slackUrl, `:bar_chart: *${title}*\n\`\`\`${body}\`\`\``)
    if (ctx.webhookUrl) result.webhook = await sendWebhook(ctx.webhookUrl, { type: 'weekly_digest', org_id: orgId, week, summary, at: now.toISOString() })
  }

  await admin.from('digest_runs')
    .update({ delivered: { inapp: result.inapp, email: result.email, slack: result.slack ?? null, webhook: result.webhook ?? null } })
    .eq('org_id', orgId).eq('week_key', week)

  return result
}
