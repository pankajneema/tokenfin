/**
 * Connector sync — pulls vendor usage into coding_tool_usage (last 35 days) and
 * GitHub merged PRs into merged_prs (last 60 days). Idempotent upserts; errors
 * are recorded on provider_connections without key material. Server-only.
 * Called by /api/v1/cron/connectors (all orgs) and "Sync now" (one org).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { openKey, type SealedKey } from '@/lib/crypto/key-reveal'
import { fetchClaudeCodeUsage, verifyClaudeCodeKey } from './claude-code'
import { fetchCursorUsage, verifyCursorKey } from './cursor'
import { fetchCopilotUsage, verifyCopilotToken } from './copilot'
import { fetchMergedPrs, verifyGithubToken, type MergedPrRow } from './github'
import { ConnectorApiError, CONNECTOR_PROVIDERS, type CodingToolRow, type ConnectorProvider, type FetchWindow } from './types'

export const TOOL_SYNC_DAYS = 35
export const PR_SYNC_DAYS = 60
const UPSERT_CHUNK = 500

export interface ConnectorConfig { github_org?: string; repos?: string[] }
export interface ConnectorConnection { id: string; org_id: string; provider: ConnectorProvider; key_enc: SealedKey; config: ConnectorConfig | null }
export interface ConnectorSyncResult {
  connectionId: string; orgId: string; provider: ConnectorProvider
  ok: boolean; rows: number; warnings: string[]; error?: string
}

/** [UTC midnight N days ago, UTC midnight tomorrow). */
export function connectorWindow(days = TOOL_SYNC_DAYS, now = new Date()): FetchWindow {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return { start: new Date(today - days * 86400_000), end: new Date(today + 86400_000) }
}

export function verifyConnector(provider: ConnectorProvider, key: string, config: ConnectorConfig): Promise<void> {
  switch (provider) {
    case 'claude_code_analytics': return verifyClaudeCodeKey(key)
    case 'cursor':                return verifyCursorKey(key)
    case 'github_copilot':        return verifyCopilotToken(key, config.github_org ?? '')
    case 'github':                return verifyGithubToken(key, config.repos ?? [])
  }
}

async function fetchToolRows(conn: ConnectorConnection, key: string, w: FetchWindow): Promise<{ rows: CodingToolRow[]; warnings: string[] }> {
  switch (conn.provider) {
    case 'claude_code_analytics': return { rows: await fetchClaudeCodeUsage(key, w), warnings: [] }
    case 'cursor':                return { rows: await fetchCursorUsage(key, w), warnings: [] }
    case 'github_copilot': {
      if (!conn.config?.github_org) throw new ConnectorApiError('github_copilot', 0, 'GitHub organization name is not configured')
      return fetchCopilotUsage(key, conn.config.github_org, w)
    }
    default: throw new Error(`not a coding tool: ${conn.provider}`)
  }
}

function errMessage(e: unknown): string {
  if (e instanceof ConnectorApiError) return e.message.slice(0, 300)
  return (e as Error)?.message?.slice(0, 300) || 'unknown error'
}

async function upsertChunks(admin: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string): Promise<string | null> {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const { error } = await admin.from(table).upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict })
    if (error) { console.error(`[connectors] ${table} upsert failed:`, error.message); return error.message }
  }
  return null
}

async function knownPrs(admin: SupabaseClient, orgId: string, sinceIso: string): Promise<Set<string>> {
  const known = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('merged_prs').select('id, repo, number')
      .eq('org_id', orgId).gte('merged_at', sinceIso).not('additions', 'is', null)
      .order('id').range(from, from + 999)
    if (error || !data) break
    for (const r of data) known.add(`${r.repo}#${r.number}`)
    if (data.length < 1000) break
  }
  return known
}

export async function syncConnector(admin: SupabaseClient, conn: ConnectorConnection, opts: { now?: Date } = {}): Promise<ConnectorSyncResult> {
  const base = { connectionId: conn.id, orgId: conn.org_id, provider: conn.provider }
  const syncedAt = new Date().toISOString()
  let warnings: string[] = []
  let count = 0
  try {
    const key = openKey(conn.key_enc)
    if (conn.provider === 'github') {
      const since = connectorWindow(PR_SYNC_DAYS, opts.now).start
      const known = await knownPrs(admin, conn.org_id, since.toISOString())
      const res = await fetchMergedPrs(key, conn.config?.repos ?? [], since, known)
      warnings = res.warnings
      // Rows without line counts must not overwrite counts stored earlier → separate column set.
      const full = (r: MergedPrRow) => ({ ...r, org_id: conn.org_id, synced_at: syncedAt })
      const thin = ({ additions: _a, deletions: _d, author_email: _e, ...r }: MergedPrRow) => ({ ...r, org_id: conn.org_id, synced_at: syncedAt })
      const err = await upsertChunks(admin, 'merged_prs', res.rows.filter(r => r.additions !== null).map(full), 'org_id,repo,number')
        ?? await upsertChunks(admin, 'merged_prs', res.rows.filter(r => r.additions === null).map(thin), 'org_id,repo,number')
      if (err) throw new Error('Could not save merged PRs (database error)')
      count = res.rows.length
    } else {
      const res = await fetchToolRows(conn, key, connectorWindow(TOOL_SYNC_DAYS, opts.now))
      warnings = res.warnings
      const err = await upsertChunks(admin, 'coding_tool_usage',
        res.rows.map(r => ({ ...r, org_id: conn.org_id, tool: conn.provider, synced_at: syncedAt })),
        'org_id,tool,day,user_key,model')
      if (err) throw new Error('Could not save coding tool usage (database error)')
      count = res.rows.length
    }
  } catch (e) {
    const error = errMessage(e)
    await admin.from('provider_connections').update({ status: 'error', last_error: error }).eq('id', conn.id)
    return { ...base, ok: false, rows: 0, warnings, error }
  }
  await admin.from('provider_connections')
    .update({ status: 'ok', last_error: warnings.length ? warnings.join(' ').slice(0, 300) : null, last_synced_at: syncedAt })
    .eq('id', conn.id)
  return { ...base, ok: true, rows: count, warnings }
}

/** Sync every connector connection (optionally one org / one provider). Sequential — vendor APIs are rate-limited. */
export async function syncAllConnectors(admin: SupabaseClient, opts: { orgId?: string; provider?: ConnectorProvider; now?: Date } = {}): Promise<ConnectorSyncResult[]> {
  let q = admin.from('provider_connections').select('id, org_id, provider, key_enc, config')
    .in('provider', opts.provider ? [opts.provider] : CONNECTOR_PROVIDERS as string[])
  if (opts.orgId) q = q.eq('org_id', opts.orgId)
  const { data, error } = await q
  if (error) throw new Error(`load provider_connections: ${error.message}`)
  const out: ConnectorSyncResult[] = []
  for (const c of (data ?? []) as ConnectorConnection[]) out.push(await syncConnector(admin, c, opts))
  return out
}
