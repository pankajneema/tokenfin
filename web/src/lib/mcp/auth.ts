import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import type { KeyCtx } from './types'

// Validates the Bearer API key on every request and resolves it to an org.
// Returns null on any failure (caller responds 401).
export async function authenticate(req: NextRequest): Promise<KeyCtx | null> {
  const auth = req.headers.get('authorization') ?? ''
  const raw  = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!raw) return null
  const keyHash = crypto.createHash('sha256').update(raw).digest('hex')
  const { data } = await createAdminClient()
    .from('api_keys')
    .select('org_id, project_id, is_active, expires_at, scopes')
    .eq('key_hash', keyHash)
    .maybeSingle()
  if (!data || !data.is_active) return null
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null
  return {
    orgId: data.org_id as string,
    projectId: (data.project_id as string | null) ?? null,
    scopes: (data.scopes as string[] | null) ?? [],
  }
}

export function unauthorized(): NextResponse {
  return new NextResponse(
    JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        // RFC 9728 discovery hint — points clients at the protected-resource metadata.
        'WWW-Authenticate': 'Bearer realm="TokenFin MCP", error="invalid_token"',
      },
    },
  )
}
