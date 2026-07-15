/**
 * Bearer → org resolution for the OTLP receivers.
 *
 * Accepts `Authorization: Bearer tfk_…` (what OTEL_EXPORTER_OTLP_HEADERS sends)
 * or `x-api-key: tfk_…`. SHA-256 of the raw key → api_keys lookup. Same identity
 * model as the ingest route; the key is never sent to the model provider.
 */
import crypto from 'crypto'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export interface KeyCtx {
  orgId: string
  projectId: string | null
  keyId: string
  userId: string | null
}

export async function authOtlp(req: NextRequest): Promise<KeyCtx | null> {
  const authz = req.headers.get('authorization')
  const raw =
    req.headers.get('x-api-key') ||
    (authz?.startsWith('Bearer ') ? authz.slice(7).trim() : '') ||
    // Gemini CLI can't set OTLP headers, so it authenticates via ?key= on the
    // endpoint URL. Same key, same org resolution.
    (req.nextUrl?.searchParams?.get('key')?.trim() ?? '')
  if (!raw) return null

  const keyHash = crypto.createHash('sha256').update(raw).digest('hex')
  const { data } = await createAdminClient()
    .from('api_keys')
    .select('id, org_id, project_id, user_id, is_active, expires_at')
    .eq('key_hash', keyHash)
    .maybeSingle()

  if (!data || !data.is_active) return null
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null
  return { orgId: data.org_id, projectId: data.project_id ?? null, keyId: data.id, userId: data.user_id ?? null }
}
