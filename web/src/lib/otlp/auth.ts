/**
 * API-key → org resolution for every ingest path (OTLP receivers + SDK ingest).
 *
 * Accepts `Authorization: Bearer tfk_…` (what OTEL_EXPORTER_OTLP_HEADERS sends)
 * or `x-api-key: tfk_…`, or `?key=` (Gemini CLI can't set headers). SHA-256 of
 * the raw key → api_keys lookup, with the org's ingest settings embedded in the
 * same round trip. Results are cached per instance for 60s keyed by the hash
 * (unknown keys for 10s), so a busy exporter costs zero auth queries; a revoked
 * key therefore stops working within a minute.
 */
import crypto from 'crypto'
import type { NextRequest } from 'next/server'
import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/server'
import { DEFAULT_TIMEZONE, isValidTimeZone } from '@/lib/dates'
import { TtlCache } from '@/lib/cache'

export interface KeyCtx {
  orgId: string
  projectId: string | null
  keyId: string
  userId: string | null
  /** Workspace IANA time zone — days (usage_agg buckets, productivity) use it. */
  timezone?: string
  /** organizations.capture_prompts (migration 011); undefined = allowed. */
  capturePrompts?: boolean
  /** The org's first project — used when the key isn't bound to one. */
  defaultProjectId?: string | null
}

interface KeyRow {
  id: string
  org_id: string
  project_id: string | null
  user_id: string | null
  is_active: boolean
  expires_at: string | null
  scopes: string[] | null
  last_used_at: string | null
  timezone: string
  capture_prompts: boolean
  default_project_id: string | null
}

export type KeyLookup =
  | { ok: true; ctx: KeyCtx; row: KeyRow }
  | { ok: false; reason: 'invalid' | 'inactive' | 'expired' | 'scope' }

const KEY_TTL_MS = 60_000
const MISS_TTL_MS = 10_000
const keyCache = new TtlCache<string, KeyRow | null>(5_000, KEY_TTL_MS)

export const hashApiKey = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex')

/** Forget cached key lookups (tests; key revocation within this instance). */
export function invalidateKeyCache(keyHash?: string): void {
  if (keyHash) keyCache.delete(keyHash)
  else keyCache.clear()
}

async function loadKeyRow(keyHash: string): Promise<KeyRow | null> {
  const admin = createAdminClient()
  const base = 'id, org_id, project_id, user_id, is_active, expires_at, scopes, last_used_at'
  // One round trip: key + org settings + the org's first project.
  let { data, error } = await admin.from('api_keys')
    .select(`${base}, organizations(timezone, capture_prompts, projects(id, created_at))`)
    .eq('key_hash', keyHash)
    .order('created_at', { referencedTable: 'organizations.projects', ascending: true })
    .limit(1, { referencedTable: 'organizations.projects' })
    .maybeSingle()
  if (error && /capture_prompts|timezone/.test(error.message)) {
    // Database without migration 010/011 — settings fall back to defaults.
    ;({ data, error } = await admin.from('api_keys')
      .select(`${base}, organizations(projects(id, created_at))`)
      .eq('key_hash', keyHash)
      .order('created_at', { referencedTable: 'organizations.projects', ascending: true })
      .limit(1, { referencedTable: 'organizations.projects' })
      .maybeSingle())
  }
  if (error) throw new Error(`api key lookup failed: ${error.message}`)
  if (!data) return null
  const d = data as any
  const org = Array.isArray(d.organizations) ? d.organizations[0] : d.organizations
  const tz = org?.timezone
  return {
    id: d.id, org_id: d.org_id, project_id: d.project_id ?? null, user_id: d.user_id ?? null,
    is_active: !!d.is_active, expires_at: d.expires_at ?? null, scopes: d.scopes ?? null,
    last_used_at: d.last_used_at ?? null,
    timezone: tz && isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE,
    capture_prompts: org?.capture_prompts !== false,
    default_project_id: org?.projects?.[0]?.id ?? null,
  }
}

/** Resolve a raw API key for an ingest write (cached). */
export async function lookupIngestKey(raw: string): Promise<KeyLookup> {
  if (!raw) return { ok: false, reason: 'invalid' }
  const keyHash = hashApiKey(raw)
  const row = await keyCache.getOrLoad(keyHash, () => loadKeyRow(keyHash), r => (r ? KEY_TTL_MS : MISS_TTL_MS))
  if (!row) return { ok: false, reason: 'invalid' }
  if (!row.is_active) return { ok: false, reason: 'inactive' }
  if (row.expires_at && new Date(row.expires_at) < new Date()) return { ok: false, reason: 'expired' }
  // Ingest is a write: a read-only (e.g. MCP analytics) key must not be able to
  // push usage. Legacy keys with no recorded scopes stay allowed.
  const scopes = row.scopes ?? []
  if (scopes.length > 0 && !scopes.includes('write') && !scopes.includes('ingest')) return { ok: false, reason: 'scope' }
  return {
    ok: true,
    row,
    ctx: {
      orgId: row.org_id, projectId: row.project_id, keyId: row.id, userId: row.user_id,
      timezone: row.timezone, capturePrompts: row.capture_prompts, defaultProjectId: row.default_project_id,
    },
  }
}

export function rawKeyFrom(req: NextRequest): string {
  const authz = req.headers.get('authorization')
  return (
    req.headers.get('x-api-key') ||
    (authz?.startsWith('Bearer ') ? authz.slice(7).trim() : '') ||
    (req.nextUrl?.searchParams?.get('key')?.trim() ?? '')
  )
}

export async function authOtlp(req: NextRequest): Promise<KeyCtx | null> {
  const res = await lookupIngestKey(rawKeyFrom(req))
  if (!res.ok) return null
  touchKey(res.ctx.keyId, res.row.last_used_at)
  return res.ctx
}

// ── Post-response work ──────────────────────────────────────────────────────

/** Run `task` after the response is sent (next/server after()); inline outside a request. */
export function defer(task: () => Promise<unknown> | unknown): void {
  const run = async () => {
    try { await task() } catch (e: any) { console.error('[ingest] deferred task failed:', e?.message ?? e) }
  }
  try { after(run) } catch { void run() }
}

const TOUCH_INTERVAL_MS = 5 * 60_000
const touched = new TtlCache<string, number>(10_000, TOUCH_INTERVAL_MS)

/**
 * api_keys.last_used_at, written at most every 5 minutes per key (and only if
 * the stored value is older), after the response.
 */
export function touchKey(keyId: string, lastUsedAt: string | null): void {
  const now = Date.now()
  const seen = Math.max(touched.get(keyId) ?? 0, lastUsedAt ? Date.parse(lastUsedAt) || 0 : 0)
  if (now - seen < TOUCH_INTERVAL_MS) return
  touched.set(keyId, now)
  const cutoff = new Date(now - TOUCH_INTERVAL_MS).toISOString()
  defer(() => createAdminClient().from('api_keys')
    .update({ last_used_at: new Date(now).toISOString() })
    .eq('id', keyId)
    .or(`last_used_at.is.null,last_used_at.lt.${cutoff}`))
}

// ── Attribution: user email → workspace member ──────────────────────────────

const memberCache = new TtlCache<string, string | null>(20_000, 5 * 60_000)

/**
 * Map emails (OTLP user.email / SDK user_email) to workspace member user ids,
 * for shared/org keys that carry no user. One RPC for all uncached emails.
 */
export async function resolveMemberIds(admin: SupabaseClient, orgId: string, emails: Array<string | null | undefined>): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const misses: string[] = []
  for (const e of Array.from(new Set(emails.map(x => (x ?? '').trim().toLowerCase()).filter(Boolean)))) {
    const hit = memberCache.get(`${orgId}|${e}`)
    if (hit === undefined) misses.push(e)
    else if (hit) out.set(e, hit)
  }
  if (misses.length) {
    const { data, error } = await admin.rpc('org_member_ids_by_email', { p_org: orgId, p_emails: misses })
    if (error) {
      console.warn('[ingest] member lookup failed (attribution skipped):', error.message)
      return out
    }
    const found = new Map<string, string>()
    for (const r of (data ?? []) as Array<{ email: string; user_id: string }>) found.set(String(r.email).toLowerCase(), r.user_id)
    for (const e of misses) {
      const id = found.get(e) ?? null
      memberCache.set(`${orgId}|${e}`, id)
      if (id) out.set(e, id)
    }
  }
  return out
}

/** Forget cached attribution (tests). */
export function clearMemberCache(): void { memberCache.clear() }
