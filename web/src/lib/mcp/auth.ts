import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import type { KeyCtx } from './types'

// Validates the API key on every request and resolves it to an org.
// Accepts the key via (in order): Authorization: Bearer, x-api-key header, or a
// ?key= / ?api_key= query param — the query form lets clients that can't set a
// header (e.g. Claude's web custom connector) still authenticate.
// Returns null when the key is missing/unknown/inactive/expired (caller responds
// 401). Throws AuthUnavailableError when the key lookup itself fails (DB/network)
// so the caller can answer 503 — a transient outage must not look like a
// revoked key to clients that drop credentials on 401.
export class AuthUnavailableError extends Error {
  constructor() { super('auth backend unavailable') }
}

export async function authenticate(req: NextRequest): Promise<KeyCtx | null> {
  const auth = req.headers.get('authorization') ?? ''
  const raw =
    (auth.startsWith('Bearer ') ? auth.slice(7).trim() : '') ||
    (req.headers.get('x-api-key') ?? '').trim() ||
    (req.nextUrl.searchParams.get('key') ?? req.nextUrl.searchParams.get('api_key') ?? '').trim()
  if (!raw) return null
  const keyHash = crypto.createHash('sha256').update(raw).digest('hex')
  const { data, error } = await createAdminClient()
    .from('api_keys')
    .select('id, org_id, project_id, user_id, is_active, expires_at, scopes')
    .eq('key_hash', keyHash)
    .maybeSingle()
  if (error) {
    console.error('[mcp] api key lookup failed:', error.message)
    throw new AuthUnavailableError()
  }
  if (!data || !data.is_active) return null
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null
  return {
    keyId: data.id as string,
    orgId: data.org_id as string,
    projectId: (data.project_id as string | null) ?? null,
    userId: (data.user_id as string | null) ?? null,
    scopes: (data.scopes as string[] | null) ?? [],
  }
}

export function authUnavailable(): NextResponse {
  return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: -32002, message: 'Service temporarily unavailable' } },
    { status: 503, headers: { 'Retry-After': '5' } },
  )
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
