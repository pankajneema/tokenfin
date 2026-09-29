import { createAdminClient } from '@/lib/supabase/server'
import { DEFAULT_TIMEZONE, isValidTimeZone } from '@/lib/dates'

/**
 * The workspace's IANA time zone (Settings → Workspace), used to bucket days on
 * dashboards and in daily totals. Cached per process for 60s so the ingest hot
 * path doesn't pay a query per event.
 */
const cache = new Map<string, { tz: string; at: number }>()
const TTL_MS = 60_000

export async function getOrgTimezone(orgId: string | null | undefined): Promise<string> {
  if (!orgId) return DEFAULT_TIMEZONE
  const hit = cache.get(orgId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.tz
  let tz = DEFAULT_TIMEZONE
  try {
    const { data } = await createAdminClient().from('organizations').select('timezone').eq('id', orgId).maybeSingle()
    const v = (data as { timezone?: string } | null)?.timezone
    if (v && isValidTimeZone(v)) tz = v
  } catch { /* column missing before migration 010 → default */ }
  cache.set(orgId, { tz, at: Date.now() })
  return tz
}

/** Forget a cached zone (call after the workspace changes it). */
export function clearOrgTimezone(orgId: string): void {
  cache.delete(orgId)
}
