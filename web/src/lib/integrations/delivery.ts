/**
 * Record the real outcome of the last alert delivery on an integration row, so
 * the Integrations page shows "last delivered / failed: <reason>" instead of a
 * status that was faked at connect time. Server-only. Never throws.
 */
type Admin = ReturnType<typeof import('@/lib/supabase/server')['createAdminClient']>

export interface SendResult { sent: boolean; reason?: string }

function isSendResult(v: unknown): v is SendResult {
  return !!v && typeof v === 'object' && typeof (v as { sent?: unknown }).sent === 'boolean'
}

/** Human-readable detail for a send result (kept short; no secrets — notify/send reasons never contain URLs). */
export function deliveryDetail(r: SendResult, at: Date = new Date()): string {
  const when = at.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  return r.sent ? `Last delivery OK · ${when}` : `Last delivery failed: ${(r.reason ?? 'unknown error').slice(0, 160)} · ${when}`
}

export async function recordDelivery(admin: Admin, orgId: string, provider: string, result: SendResult): Promise<void> {
  try {
    const now = new Date()
    await admin
      .from('org_integrations')
      .update({ last_synced_at: now.toISOString(), sync_ok: result.sent, detail: deliveryDetail(result, now) })
      .eq('org_id', orgId)
      .eq('provider', provider)
  } catch (e) {
    console.error('[integrations] recordDelivery failed:', (e as Error).message)
  }
}

/** Record every channel result returned by deliverAlert() ({ email, slack, webhook, … }). */
export async function recordDeliveryResults(admin: Admin, orgId: string, results: Record<string, unknown>): Promise<void> {
  await Promise.all((['slack', 'webhook', 'email'] as const)
    .filter(ch => isSendResult(results[ch]))
    .map(ch => recordDelivery(admin, orgId, ch, results[ch] as SendResult)))
}
