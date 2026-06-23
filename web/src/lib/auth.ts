/**
 * Server-side auth helpers — import only in Server Components, API routes,
 * Server Actions, and middleware. Never import in client components.
 */
import { redirect }                        from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { User }                       from '@supabase/supabase-js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuthUser = User

export interface UserOrg {
  org_id:  string
  role:    string
  org:     {
    id:   string
    name: string
    slug: string
    plan: string
  }
}

// ─── Core helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the currently authenticated user, or null.
 * Prefers getUser() over getSession() to always hit the server (no stale JWTs).
 */
export async function getUser(): Promise<AuthUser | null> {
  const supabase = createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  return user
}

/**
 * Requires an authenticated user. Redirects to /login if not authenticated.
 * Use in page/layout Server Components that need the user object.
 */
export async function requireUser(): Promise<AuthUser> {
  const user = await getUser()
  if (!user) redirect('/login')
  return user
}

/**
 * Returns the user's primary org membership, or null.
 * Assumes a user belongs to at most one org (the first one returned).
 */
export async function getUserOrg(userId: string): Promise<UserOrg | null> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('members')
    .select('org_id, role, organizations(id, name, slug, plan)')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()

  if (error || !data) return null

  const org = Array.isArray(data.organizations)
    ? data.organizations[0]
    : data.organizations

  if (!org) return null

  return {
    org_id: data.org_id,
    role:   data.role,
    org:    org as UserOrg['org'],
  }
}

/**
 * Full auth + org guard for dashboard routes.
 * Redirects to /login, /plans, or /onboarding as needed.
 * Returns { user, membership } when all checks pass.
 */
export async function requireDashboardAccess() {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Use admin client — bypasses RLS so membership is never missed
  const { data: members } = await admin
    .from('members')
    .select('id, org_id, role')
    .eq('user_id', user.id)
    .limit(1)

  const membership = members?.[0] ?? null
  if (!membership) redirect('/plans')

  const { data: projects } = await admin
    .from('projects')
    .select('id')
    .eq('org_id', membership.org_id)
    .limit(1)

  const project = projects?.[0] ?? null
  if (!project) redirect('/onboarding')

  return { user, membership }
}

/**
 * Checks if a user has one of the allowed roles within their org.
 * Returns false (not throws) when insufficient.
 */
export async function hasRole(
  userId: string,
  orgId:  string,
  roles:  string[]
): Promise<boolean> {
  const supabase = createClient()

  const { data } = await supabase
    .from('members')
    .select('role')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle()

  return data ? roles.includes(data.role) : false
}
