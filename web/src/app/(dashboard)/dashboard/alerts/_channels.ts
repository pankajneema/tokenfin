/**
 * Server-only: the real delivery status of each alert channel, derived from
 * exactly what lib/alerts/engine + lib/notify/send use to deliver:
 *   in-app  — always
 *   email   — only when the server has a mail provider (RESEND_API_KEY)
 *   slack / webhook — only when org_integrations holds a usable URL
 */
import { integrationUrl, publicConfig } from '@/lib/integrations/config'
import type { ChannelStatus } from './_types'

export type IntegRow = { provider: string; config: Record<string, unknown> | null; last_synced_at: string | null; sync_ok: boolean | null; detail: string | null }

/** Columns to select from org_integrations (filter is_active = true). */
export const INTEG_COLS = 'provider, config, last_synced_at, sync_ok, detail'

export function channelStatus(rows: IntegRow[] | null | undefined, env: Record<string, string | undefined> = process.env): ChannelStatus[] {
  const integRows = rows ?? []
  const urlChannel = (id: 'slack' | 'webhook'): ChannelStatus => {
    const row = integRows.find(i => i.provider === id)
    const url = integrationUrl(integRows, id)
    const cfg = publicConfig(row?.config ?? null)
    const masked = (cfg.webhook_url ?? cfg.url ?? cfg.endpoint ?? null) as string | null
    return {
      id,
      deliverable: !!url,
      detail: url ? (masked ?? 'Configured') : row ? 'Saved, but no usable URL — re-enter it in Integrations' : 'Not set up — add a URL in Integrations',
      lastAt: row?.last_synced_at ?? null,
      lastOk: row?.last_synced_at ? row.sync_ok : null,
      lastDetail: row?.detail ?? null,
    }
  }
  const emailReady = !!env.RESEND_API_KEY
  return [
    { id: 'inapp', deliverable: true, detail: 'Bell in the dashboard for owners and admins', lastAt: null, lastOk: null, lastDetail: null },
    { id: 'email', deliverable: emailReady,
      detail: emailReady ? 'Sent to the org’s owners and admins' : 'Email sending is not configured on this server (RESEND_API_KEY) — email alerts are skipped',
      lastAt: null, lastOk: null, lastDetail: null },
    urlChannel('slack'),
    urlChannel('webhook'),
  ]
}
