import { createAdminClient } from '@/lib/supabase/server'

// CCR reversible store (Supabase `ccr_store`, migration 015). Originals of
// compressed content live here, TTL-bounded, so `retrieve` can return them
// verbatim. Service-role only (RLS denies all other roles).
// Keyed by (org_id, hash) — migration 005 — so one tenant can never overwrite
// or read another tenant's original through a colliding hash.

const TTL_MS = 24 * 3600_000

export async function ccrPut(hash: string, orgId: string, content: string): Promise<void> {
  const { error } = await createAdminClient().from('ccr_store').upsert(
    { hash, org_id: orgId, content, expires_at: new Date(Date.now() + TTL_MS).toISOString() },
    { onConflict: 'org_id,hash' },
  )
  if (error) {
    console.error('[mcp] ccr_store upsert failed:', error.message)
    throw new Error('Could not store the original for retrieval; try again')
  }
}

export async function ccrGet(hash: string, orgId: string): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from('ccr_store').select('content')
    .eq('org_id', orgId).eq('hash', hash)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (error) {
    console.error('[mcp] ccr_store read failed:', error.message)
    throw new Error('Could not read the original; try again')
  }
  return data?.content ?? null
}
