/**
 * Server-side auth helpers. Import only in Server Components and Route Handlers.
 * Never import in client components.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse }                     from 'next/server'
import type { NextRequest }                 from 'next/server'
import type { User }                        from '@supabase/supabase-js'
import { can, keyCanRead, promptScope, type Role, type Permission } from '@/lib/rbac'
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
  /** The key's owner: api_keys.user_id, or created_by for org-level keys. */
  userId:    string | null
  /** True when the key is assigned to a specific member (api_keys.user_id set). */
  personal:  boolean
  /** The owner's role in the org — key-authenticated reads honour it. */
  role:      Role
}

export type ApiKeyLookup =
  | { status: 'none' }                 // no Bearer header
  | { status: 'invalid' }              // header present, key unknown/inactive/expired/owner left
  | { status: 'ok'; key: ApiKeyContext }

/** Extracts a Bearer token from the Authorization header ('' when absent). */
export function bearerFrom(req: NextRequest): string {
  const auth = req.headers.get('authorization') ?? ''
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
}

/**
 * Looks up a Bearer API key WITHOUT checking scopes. The owner's role is
 * resolved from members: a personal key whose owner is no longer a member is
 * treated as invalid; an org-level key (user_id NULL) inherits its creator's
 * role, or 'member' if the creator has left.
 */
export async function lookupApiKey(req: NextRequest): Promise<ApiKeyLookup> {
  const raw = bearerFrom(req)
  if (!raw) return { status: 'none' }

  const admin   = createAdminClient()
  const keyHash = crypto.createHash('sha256').update(raw).digest('hex')
  const { data: keyRow } = await admin
    .from('api_keys')
    .select('id, org_id, project_id, user_id, created_by, is_active, expires_at, scopes')
    .eq('key_hash', keyHash)
    .maybeSingle()

  if (!keyRow || !keyRow.is_active) return { status: 'invalid' }
  if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) return { status: 'invalid' }

  const personal = !!keyRow.user_id
  const ownerId  = (keyRow.user_id ?? keyRow.created_by ?? null) as string | null
  let role: Role = 'member'
  if (ownerId) {
    const { data: m } = await admin.from('members').select('role')
      .eq('org_id', keyRow.org_id).eq('user_id', ownerId).maybeSingle()
    if (m?.role) role = m.role as Role
    else if (personal) return { status: 'invalid' }
  }

  return {
    status: 'ok',
    key: {
      orgId:     keyRow.org_id as string,
      projectId: (keyRow.project_id as string | null) ?? null,
      keyId:     keyRow.id as string,
      scopes:    Array.isArray(keyRow.scopes) ? (keyRow.scopes as string[]) : [],
      userId:    ownerId,
      personal,
      role,
    },
  }
}

/**
 * Resolves the org (and project) from a Bearer API key in the Authorization header.
 * Returns null if no key present, or the key is invalid, inactive, expired, or
 * lacks the 'read' scope (ingest-only keys cannot read). Legacy keys with an
 * empty scopes array are treated as read-capable for backward compatibility.
 */
export async function resolveOrgFromApiKey(
  req: NextRequest,
): Promise<ApiKeyContext | null> {
  const r = await lookupApiKey(req)
  if (r.status !== 'ok' || !keyCanRead(r.key.scopes)) return null
  return r.key
}

export interface ReadGuard {
  orgId:       string
  projectId?:  string | null
  /** Caller identity: the key owner (API key) or the session user. */
  userId:      string | null
  role:        Role
  viaKey:      boolean
  keyId?:      string
  /**
   * When non-null, the caller may only see rows for this user_id (members /
   * viewers). null = org-wide (owner/admin). Routes that support per-user data
   * should apply `.eq('user_id', scopeUserId)` when set.
   */
  scopeUserId: string | null
}

/**
 * requireApiKeyOrOrgMember — accepts EITHER:
 *  • Bearer API key (with 'read' scope) → resolves org_id (+ project_id) from api_keys
 *  • Supabase session + org_id query param  →  membership check
 *
 * A Bearer header that is present but invalid → 401 (never falls through to the
 * session path); a valid key without 'read' → 403. The caller's role (the key
 * OWNER's role for keys) is returned and, if `opts.permission` is given, enforced.
 */
export async function requireApiKeyOrOrgMember(
  req: NextRequest,
  orgIdParam?: string | null,
  opts: { permission?: Permission } = {},
): Promise<ReadGuard | NextResponse> {
  const r = await lookupApiKey(req)
  if (r.status === 'invalid') {
    return NextResponse.json({ error: 'Invalid or expired API key' }, {
      status: 401, headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
    })
  }
  if (r.status === 'ok') {
    const k = r.key
    if (!keyCanRead(k.scopes)) {
      return NextResponse.json({ error: 'Forbidden', reason: 'API key lacks the read scope' }, { status: 403 })
    }
    // The key's org always wins; a stray ?org_id= is ignored (as before).
    if (opts.permission && !can(k.role, opts.permission)) {
      return NextResponse.json({ error: 'Forbidden', reason: `Requires permission: ${opts.permission}` }, { status: 403 })
    }
    return {
      orgId: k.orgId, projectId: k.projectId, userId: k.userId, role: k.role,
      viaKey: true, keyId: k.keyId, scopeUserId: promptScope(k.role, k.userId),
    }
  }

  const guard = await requireOrgMemberWithRole(orgIdParam)
  if (guard instanceof NextResponse) return guard
  if (opts.permission && !can(guard.role, opts.permission)) {
    return NextResponse.json({ error: 'Forbidden', reason: `Requires permission: ${opts.permission}` }, { status: 403 })
  }
  return {
    orgId: orgIdParam!, userId: guard.userId, role: guard.role, viaKey: false,
    scopeUserId: promptScope(guard.role, guard.userId),
  }
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
