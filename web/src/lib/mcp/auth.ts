import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import type { KeyCtx } from './types'
import { promptScope, type Role } from '@/lib/rbac'

// Validates the API key on every request and resolves it to an org.
// Accepts the key via Authorization: Bearer or the x-api-key header ONLY. A
// ?key= query credential is deliberately NOT accepted here (URLs leak into logs,
// proxies and browser history); it is allowed only on /api/otel/* for Gemini CLI.
// Returns null when the key is missing/unknown/inactive/expired (caller responds
// 401). Throws AuthUnavailableError when the key lookup itself fails (DB/network)
// so the caller can answer 503 — a transient outage must not look like a
// revoked key to clients that drop credentials on 401.
export class AuthUnavailableError extends Error {
  constructor() { super('auth backend unavailable') }
}

/** The raw credential from headers ('' when none was sent). */
export function credentialFrom(req: NextRequest): string {
  const auth = req.headers.get('authorization') ?? ''
  return (auth.startsWith('Bearer ') ? auth.slice(7).trim() : '') ||
    (req.headers.get('x-api-key') ?? '').trim()
}

/**
 * Resolves the key's owner and role exactly like lib/api/auth.ts lookupApiKey:
 * owner = api_keys.user_id, else created_by; role = the owner's members.role.
 * A personal key whose owner left the org is invalid (null); an org-level key
 * whose creator left falls back to 'member' (the least-privileged reader that
 * still sees org analytics — never owner/admin by default).
 */
export function resolveKeyIdentity(
  key: { user_id?: string | null; created_by?: string | null },
  memberRole: string | null | undefined,
): { userId: string | null; role: Role; scopeUserId: string | null } | null {
  const personal = !!key.user_id
  const userId = (key.user_id ?? key.created_by ?? null) as string | null
  let role: Role = 'member'
  if (userId) {
    if (memberRole && ROLES.has(memberRole)) role = memberRole as Role
    else if (memberRole) role = 'viewer' // unknown role string → fail closed
    else if (personal) return null
  }
  return { userId, role, scopeUserId: promptScope(role, userId) }
}

const ROLES = new Set<string>(['owner', 'admin', 'member', 'viewer'])

export async function authenticate(req: NextRequest): Promise<KeyCtx | null> {
  const raw = credentialFrom(req)
  if (!raw) return null
  const keyHash = crypto.createHash('sha256').update(raw).digest('hex')
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('api_keys')
    .select('id, org_id, project_id, user_id, created_by, is_active, expires_at, scopes')
    .eq('key_hash', keyHash)
    .maybeSingle()
  if (error) {
    console.error('[mcp] api key lookup failed:', error.message)
    throw new AuthUnavailableError()
  }
  if (!data || !data.is_active) return null
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null

  const ownerId = (data.user_id ?? data.created_by ?? null) as string | null
  let memberRole: string | null = null
  if (ownerId) {
    const { data: m, error: mErr } = await admin.from('members').select('role')
      .eq('org_id', data.org_id).eq('user_id', ownerId).maybeSingle()
    if (mErr) {
      console.error('[mcp] member role lookup failed:', mErr.message)
      throw new AuthUnavailableError()
    }
    memberRole = (m?.role as string | undefined) ?? null
  }
  const ident = resolveKeyIdentity(data, memberRole)
  if (!ident) return null
  return {
    keyId: data.id as string,
    orgId: data.org_id as string,
    projectId: (data.project_id as string | null) ?? null,
    userId: ident.userId,
    role: ident.role,
    scopeUserId: ident.scopeUserId,
    scopes: (data.scopes as string[] | null) ?? [],
  }
}

export function authUnavailable(): NextResponse {
  return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: -32002, message: 'Service temporarily unavailable' } },
    { status: 503, headers: { 'Retry-After': '5' } },
  )
}

/**
 * RFC 6750 §3: when the request carried no credential the challenge MUST NOT
 * include an error code; `invalid_token` only when a credential was presented.
 */
export function wwwAuthenticate(tokenSent: boolean): string {
  return tokenSent
    ? 'Bearer realm="TokenFin MCP", error="invalid_token"'
    : 'Bearer realm="TokenFin MCP"'
}

export function unauthorized(tokenSent = true): NextResponse {
  return new NextResponse(
    JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': wwwAuthenticate(tokenSent),
      },
    },
  )
}

// ─── Origin guard (DNS-rebinding) ─────────────────────────────────────────────

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Browser Origin allow-list, compared by exact scheme+host+port after URL
 * parsing — never by string prefix (so `http://localhost.evil.com` and
 * `https://claude.ai.evil.com` are rejected). Loopback is allowed on any port
 * (local MCP Inspector / dev). No Origin header = non-browser client → allowed.
 */
export function originAllowed(origin: string | null, allowed: readonly (string | undefined | null)[]): boolean {
  if (!origin) return true
  let o: URL
  try { o = new URL(origin) } catch { return false }
  if (o.protocol !== 'http:' && o.protocol !== 'https:') return false
  if (LOCAL_HOSTS.has(o.hostname)) return true
  return allowed.some(a => {
    if (!a) return false
    try { return new URL(a).origin === o.origin } catch { return false }
  })
}
