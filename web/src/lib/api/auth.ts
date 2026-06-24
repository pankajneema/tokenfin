/**
 * Server-side auth helpers. Import only in Server Components and Route Handlers.
 * Never import in client components.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse }                     from 'next/server'
import type { NextRequest }                 from 'next/server'
import type { User }                        from '@supabase/supabase-js'
import crypto                               from 'crypto'

export interface AuthResult {
  user:  User
  orgId: string
}

// ─── Basic user auth ──────────────────────────────────────────────────────────

/** Returns the authenticated user or a 401 NextResponse. */
export async function requireAuth(): Promise<User | NextResponse> {
  const supabase = createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return user
}

/** Returns the user's primary org_id from the members table. */
export async function getUserOrgId(userId: string): Promise<string | null> {
  const supabase = createClient()
  const { data } = await supabase
    .from('members')
    .select('org_id')
    .eq('user_id', userId)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data?.org_id ?? null
}

// ─── Org-level access guard ───────────────────────────────────────────────────

/**
 * requireOrgMember — the primary auth guard for all admin API routes.
 *
 * Checks:
 *  1. Request has a valid Supabase session (authentication)
 *  2. Session's user is a member of the requested org (authorisation)
 *
 * Returns { userId } if authorised, or a NextResponse (400/401/403) to short-circuit.
 *
 * Usage:
 *   const guard = await requireOrgMember(orgId)
 *   if (guard instanceof NextResponse) return guard
 */
export async function requireOrgMember(
  orgId: string | null | undefined,
): Promise<{ userId: string } | NextResponse> {
  if (!orgId) {
    return NextResponse.json({ error: 'org_id required' }, { status: 400 })
  }

  // Verify authentication
  const supabase = createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify org membership via the admin client (bypasses RLS for the
  // security check itself — we already verified the user's identity above).
  const { data: member } = await createAdminClient()
    .from('members')
    .select('id')
    .eq('user_id', user.id)
    .eq('org_id', orgId)
    .maybeSingle()

  if (!member) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return { userId: user.id }
}

/**
 * requireResourceOwner — for PATCH/DELETE that only receive a resource `id`
 * (no org_id in the request).
 *
 * Looks up the resource's org_id, then delegates to requireOrgMember.
 */
export async function requireResourceOwner(
  table: string,
  id: string | null | undefined,
): Promise<{ userId: string } | NextResponse> {
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  // Service role for the lookup — safe because we immediately enforce
  // membership on the returned org_id via requireOrgMember.
  const { data, error } = await createAdminClient()
    .from(table)
    .select('org_id')
    .eq('id', id)
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return requireOrgMember(data.org_id)
}

// ─── API Key auth ─────────────────────────────────────────────────────────────

/**
 * Resolves org_id from a Bearer API key in the Authorization header.
 * Returns null if no key present, key is invalid, inactive, or expired.
 */
export async function resolveOrgFromApiKey(
  req: NextRequest,
): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? ''
  const raw  = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!raw) return null

  const keyHash        = crypto.createHash('sha256').update(raw).digest('hex')
  const { data: keyRow } = await createAdminClient()
    .from('api_keys')
    .select('org_id, is_active, expires_at')
    .eq('key_hash', keyHash)
    .maybeSingle()

  if (!keyRow || !keyRow.is_active) return null
  if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) return null
  return keyRow.org_id as string
}

/**
 * requireApiKeyOrOrgMember — accepts EITHER:
 *  • Bearer API key  →  resolves org_id from api_keys table (no session needed)
 *  • Supabase session + org_id query param  →  delegates to requireOrgMember
 *
 * Use this on any route the MCP server calls.
 */
export async function requireApiKeyOrOrgMember(
  req: NextRequest,
  orgIdParam?: string | null,
): Promise<{ orgId: string } | NextResponse> {
  const apiKeyOrgId = await resolveOrgFromApiKey(req)
  if (apiKeyOrgId) return { orgId: apiKeyOrgId }

  const guard = await requireOrgMember(orgIdParam)
  if (guard instanceof NextResponse) return guard
  return { orgId: orgIdParam! }
}

// ─── Error helper ─────────────────────────────────────────────────────────────

/**
 * dbError — log the real Supabase/DB error server-side, return a generic
 * message to the client. Prevents table names, constraint names, and SQL
 * detail from leaking into HTTP responses.
 */
export function dbError(error: unknown, context?: string): NextResponse {
  console.error(`[API]${context ? ` ${context}` : ''}:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

// ─── Legacy ───────────────────────────────────────────────────────────────────

/** @deprecated Use requireOrgMember — combines auth + authorisation in one call. */
export async function assertOrgMember(
  userId: string,
  orgId:  string,
): Promise<null | NextResponse> {
  const supabase = createClient()
  const { data } = await supabase
    .from('members')
    .select('id')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!data) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}
