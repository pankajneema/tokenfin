/**
 * getOrgContext — the ONE way server components resolve "which org am I in?".
 *
 * Deterministic org choice (users can belong to several orgs):
 *   1. the `tf_org` cookie, if the user is actually a member of that org;
 *   2. otherwise the membership with the earliest joined_at, ties broken by org_id.
 * Wrapped in React cache() so a page + its layout share one lookup per request.
 * Server-only (uses the service-role client for the membership read — identity
 * is verified first via supabase.auth.getUser()).
 */
import * as React from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgTimezone } from '@/lib/org-timezone'
import type { Role } from '@/lib/rbac'

export const ORG_COOKIE = 'tf_org'

// React.cache exists in the server (react-server) build Next uses for RSC and
// route handlers; plain Node (unit tests) gets a pass-through.
const cache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  (React as unknown as { cache?: <T>(fn: T) => T }).cache ?? (fn => fn)

export interface Membership {
  org_id: string
  role: string | null
  joined_at: string | null
}

export interface OrgContext {
  user: User
  orgId: string
  role: Role
  timezone: string
}

const ROLES: readonly Role[] = ['owner', 'admin', 'member', 'viewer']

function asRole(r: string | null | undefined): Role {
  return (ROLES as readonly string[]).includes(r ?? '') ? (r as Role) : 'viewer'
}

/**
 * Pure: pick the membership to use. Honours `preferredOrgId` only when the user
 * belongs to it; else earliest joined_at, then smallest org_id. Null when none.
 */
export function pickMembership(
  memberships: readonly Membership[],
  preferredOrgId?: string | null,
): { orgId: string; role: Role } | null {
  if (!memberships.length) return null
  if (preferredOrgId) {
    const hit = memberships.find(m => m.org_id === preferredOrgId)
    if (hit) return { orgId: hit.org_id, role: asRole(hit.role) }
  }
  const sorted = [...memberships].sort((a, b) => {
    const ta = a.joined_at ? Date.parse(a.joined_at) : Number.POSITIVE_INFINITY
    const tb = b.joined_at ? Date.parse(b.joined_at) : Number.POSITIVE_INFINITY
    if (ta !== tb) return ta < tb ? -1 : 1
    return a.org_id < b.org_id ? -1 : a.org_id > b.org_id ? 1 : 0
  })
  return { orgId: sorted[0].org_id, role: asRole(sorted[0].role) }
}

/** Returns null when signed out; `{ user, orgId: null }` when the user has no org. */
export const getOrgContext = cache(async (): Promise<
  OrgContext | { user: User; orgId: null; role: null; timezone: null } | null
> => {
  const { data: { user } } = await createClient().auth.getUser()
  if (!user) return null

  const { data } = await createAdminClient()
    .from('members')
    .select('org_id, role, joined_at')
    .eq('user_id', user.id)
    .order('joined_at', { ascending: true })
    .order('org_id', { ascending: true })

  let preferred: string | null = null
  try { preferred = (await cookies()).get(ORG_COOKIE)?.value ?? null } catch { /* outside request scope */ }

  const picked = pickMembership((data ?? []) as Membership[], preferred)
  if (!picked) return { user, orgId: null, role: null, timezone: null }
  return { user, orgId: picked.orgId, role: picked.role, timezone: await getOrgTimezone(picked.orgId) }
})

/** Like getOrgContext but redirects: signed out → /login, no org → /welcome. */
export async function requireOrgContext(): Promise<OrgContext> {
  const ctx = await getOrgContext()
  if (!ctx) redirect('/login')
  if (!ctx.orgId) redirect('/welcome')
  return ctx as OrgContext
}
