import { createAdminClient } from '@/lib/supabase/server'

// CCR reversible store (Supabase `ccr_store`, migration 015). Originals of
// compressed content live here, TTL-bounded, so `retrieve` can return them
// verbatim. Service-role only (RLS denies all other roles).

const TTL_MS = 24 * 3600_000

export async function ccrPut(hash: string, orgId: string, content: string): Promise<void> {
  await createAdminClient().from('ccr_store').upsert(
    { hash, org_id: orgId, content, expires_at: new Date(Date.now() + TTL_MS).toISOString() },
    { onConflict: 'hash' },
  )
}

export async function ccrGet(hash: string, orgId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from('ccr_store').select('content').eq('hash', hash).eq('org_id', orgId).maybeSingle()
  return data?.content ?? null
}
