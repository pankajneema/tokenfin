/**
 * Provider bill sync — pulls the last N days of provider-reported costs for each
 * connected admin key and upserts them into provider_costs. Server-only.
 * Called by /api/v1/cron/reconcile (all orgs) and "Sync now" (one org).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { openKey, type SealedKey } from '@/lib/crypto/key-reveal'
import { fetchAnthropicCosts, verifyAnthropicKey } from './anthropic'
import { fetchOpenAICosts, verifyOpenAIKey } from './openai'
import { ProviderApiError, BILLING_PROVIDERS, type BillingProvider, type FetchWindow, type ProviderCostRow } from './types'

export const DEFAULT_SYNC_DAYS = 35
const UPSERT_CHUNK = 500

export interface ConnectionRow { id: string; org_id: string; provider: BillingProvider; key_enc: SealedKey }
export interface SyncResult { connectionId: string; orgId: string; provider: BillingProvider; ok: boolean; rows: number; error?: string }

/** [UTC midnight N days ago, UTC midnight tomorrow) — includes today's partial day. */
export function syncWindow(days = DEFAULT_SYNC_DAYS, now = new Date()): FetchWindow {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return { start: new Date(today - days * 86400_000), end: new Date(today + 86400_000) }
}

export function fetchProviderCosts(provider: BillingProvider, key: string, w: FetchWindow): Promise<ProviderCostRow[]> {
  return provider === 'anthropic' ? fetchAnthropicCosts(key, w) : fetchOpenAICosts(key, w)
}

export function verifyProviderKey(provider: BillingProvider, key: string): Promise<void> {
  return provider === 'anthropic' ? verifyAnthropicKey(key) : verifyOpenAIKey(key)
}

function errMessage(e: unknown): string {
  if (e instanceof ProviderApiError) return e.message
  return (e as Error)?.message?.slice(0, 300) || 'unknown error'
}

export async function syncConnection(admin: SupabaseClient, conn: ConnectionRow, opts: { days?: number; now?: Date } = {}): Promise<SyncResult> {
  const base = { connectionId: conn.id, orgId: conn.org_id, provider: conn.provider }
  let rows: ProviderCostRow[]
  try {
    const key = openKey(conn.key_enc)
    rows = await fetchProviderCosts(conn.provider, key, syncWindow(opts.days, opts.now))
  } catch (e) {
    const error = errMessage(e)
    await admin.from('provider_connections').update({ status: 'error', last_error: error }).eq('id', conn.id)
    return { ...base, ok: false, rows: 0, error }
  }

  const syncedAt = new Date().toISOString()
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK).map(r => ({ ...r, org_id: conn.org_id, provider: conn.provider, synced_at: syncedAt }))
    const { error } = await admin.from('provider_costs')
      .upsert(chunk, { onConflict: 'org_id,provider,day,workspace_or_project,line_item,model' })
    if (error) {
      console.error('[billing-sync] upsert failed:', error.message)
      const msg = 'Could not save provider costs (database error)'
      await admin.from('provider_connections').update({ status: 'error', last_error: msg }).eq('id', conn.id)
      return { ...base, ok: false, rows: i, error: msg }
    }
  }

  await admin.from('provider_connections')
    .update({ status: 'ok', last_error: null, last_synced_at: syncedAt })
    .eq('id', conn.id)
  return { ...base, ok: true, rows: rows.length }
}

/** Sync every connection (optionally one org). Sequential — admin APIs are rate-limited. */
export async function syncAll(admin: SupabaseClient, opts: { orgId?: string; days?: number; now?: Date } = {}): Promise<SyncResult[]> {
  // provider_connections also holds coding-tool connectors (lib/connectors) — only bill providers here.
  let q = admin.from('provider_connections').select('id, org_id, provider, key_enc')
    .in('provider', BILLING_PROVIDERS as string[])
  if (opts.orgId) q = q.eq('org_id', opts.orgId)
  const { data, error } = await q
  if (error) throw new Error(`load provider_connections: ${error.message}`)
  const out: SyncResult[] = []
  for (const c of (data ?? []) as ConnectionRow[]) out.push(await syncConnection(admin, c, opts))
  return out
}
