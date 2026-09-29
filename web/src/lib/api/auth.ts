/**
 * Server-side auth helpers. Import only in Server Components and Route Handlers.
 * Never import in client components.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse }                     from 'next/server'
import type { NextRequest }                 from 'next/server'
import type { User }                        from '@supabase/supabase-js'
import { can, type Role, type Permission }  from '@/lib/rbac'
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
 * requireOrgMemberWithRole — like requireOrgMember but also returns the
 * member's role. Use on pages and routes that need role-based UI/logic.
 */
export async function requireOrgMemberWithRole(
  orgId: string | null | undefined,
): Promise<{ userId: string; role: Role } | NextResponse> {
  if (!orgId) {
    return NextResponse.json({ error: 'org_id required' }, { status: 400 })
  }

  const supabase = createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: member } = await createAdminClient()
    .from('members')
    .select('id, role')
    .eq('user_id', user.id)
    .eq('org_id', orgId)
    .maybeSingle()

  if (!member) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return { userId: user.id, role: (member.role ?? 'viewer') as Role }
}

/**
 * requirePermission — verifies membership AND a specific RBAC permission.
 * Returns { userId, role } or a 403/401 NextResponse.
 *
 * Usage:
 *   const guard = await requirePermission(orgId, 'keys:create')
 *   if (guard instanceof NextResponse) return guard
 */
export async function requirePermission(
  orgId:      string | null | undefined,
  permission: Permission,
): Promise<{ userId: string; role: Role } | NextResponse> {
  const guard = await requireOrgMemberWithRole(orgId)
  if (guard instanceof NextResponse) return guard

  if (!can(guard.role, permission)) {
    return NextResponse.json(
      { error: 'Forbidden', reason: `Requires permission: ${permission}` },
      { status: 403 }
    )
  }

  return guard
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

// ─── Role helper for Server Components (pages) ────────────────────────────────

/**
 * getOrgRole — lightweight helper for server components.
 * Fetches the current user's role in the given org.
 * Returns 'viewer' on any error so pages degrade gracefully.
 */
export async function getOrgRole(userId: string, orgId: string): Promise<Role> {
  const { data } = await createAdminClient()
    .from('members')
    .select('role')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle()
  return (data?.role as Role | undefined) ?? 'viewer'
}

// ─── API Key auth ─────────────────────────────────────────────────────────────

export interface ApiKeyContext {
  orgId:     string
  /** The project the key was minted for — callers should scope reads to it when relevant. */
  projectId: string | null
  keyId:     string
  scopes:    string[]
}

/**
 * Resolves the org (and project) from a Bearer API key in the Authorization header.
 * Returns null if no key present, or the key is invalid, inactive, expired, or
 * lacks the 'read' scope. Legacy keys with an empty scopes array are treated as
 * read-capable for backward compatibility.
 */
export async function resolveOrgFromApiKey(
  req: NextRequest,
): Promise<ApiKeyContext | null> {
  const auth = req.headers.get('authorization') ?? ''
  const raw  = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!raw) return null

  const keyHash        = crypto.createHash('sha256').update(raw).digest('hex')
  const { data: keyRow } = await createAdminClient()
    .from('api_keys')
    .select('id, org_id, project_id, is_active, expires_at, scopes')
    .eq('key_hash', keyHash)
    .maybeSingle()

  if (!keyRow || !keyRow.is_active) return null
  if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) return null

  const scopes = Array.isArray(keyRow.scopes) ? (keyRow.scopes as string[]) : []
  if (scopes.length > 0 && !scopes.includes('read') && !scopes.includes('admin')) return null

  return {
    orgId:     keyRow.org_id as string,
    projectId: (keyRow.project_id as string | null) ?? null,
    keyId:     keyRow.id as string,
    scopes,
  }
}

/**
 * requireApiKeyOrOrgMember — accepts EITHER:
 *  • Bearer API key (with 'read' scope) → resolves org_id (+ project_id) from api_keys
 *  • Supabase session + org_id query param  →  delegates to requireOrgMember
 *
 * Use this on any READ route the MCP server calls. `projectId` is set only for
 * API-key callers and is the project the key belongs to.
 */
export async function requireApiKeyOrOrgMember(
  req: NextRequest,
  orgIdParam?: string | null,
): Promise<{ orgId: string; projectId?: string | null } | NextResponse> {
  const apiKey = await resolveOrgFromApiKey(req)
  if (apiKey) return { orgId: apiKey.orgId, projectId: apiKey.projectId }

  const guard = await requireOrgMember(orgIdParam)
  if (guard instanceof NextResponse) return guard
  return { orgId: orgIdParam! }
}

/**
 * assertOrgOwnsIds — verifies that every provided id (project/team/user) belongs
 * to `orgId`. Returns null when all are valid, or a 422 NextResponse naming the
 * first offending field. Undefined/null ids are skipped.
 */
export async function assertOrgOwnsIds(
  orgId: string,
  ids: { project_id?: string | null; team_id?: string | null; user_id?: string | null },
): Promise<null | NextResponse> {
  const admin = createAdminClient()
  if (ids.project_id) {
    const { data } = await admin.from('projects').select('id').eq('id', ids.project_id).eq('org_id', orgId).maybeSingle()
    if (!data) return NextResponse.json({ error: 'project_id does not belong to this org' }, { status: 422 })
  }
  if (ids.team_id) {
    const { data } = await admin.from('teams').select('id').eq('id', ids.team_id).eq('org_id', orgId).maybeSingle()
    if (!data) return NextResponse.json({ error: 'team_id does not belong to this org' }, { status: 422 })
  }
  if (ids.user_id) {
    const { data } = await admin.from('members').select('id').eq('user_id', ids.user_id).eq('org_id', orgId).maybeSingle()
    if (!data) return NextResponse.json({ error: 'user_id is not a member of this org' }, { status: 422 })
  }
  return null
}

/**
 * requireResourcePermission — for PATCH/DELETE that only receive a resource `id`.
 * Looks up the resource's org_id, then enforces the RBAC permission on it.
 * Returns { userId, role, orgId } or a 400/401/403/404 NextResponse.
 */
export async function requireResourcePermission(
  table: string,
  id: string | null | undefined,
  permission: Permission,
): Promise<{ userId: string; role: Role; orgId: string } | NextResponse> {
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { data, error } = await createAdminClient()
    .from(table)
    .select('org_id')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const guard = await requirePermission(data.org_id as string, permission)
  if (guard instanceof NextResponse) return guard
  return { ...guard, orgId: data.org_id as string }
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
