/**
 * Server-side auth helpers. Import only in Server Components and Route Handlers.
 * Never import in client components.
 */
import { createClient } from '@/lib/supabase/server'
import { NextResponse }  from 'next/server'
import type { User }     from '@supabase/supabase-js'

export interface AuthResult {
  user:  User
  orgId: string
}

/** Returns the authenticated user or throws a 401 NextResponse. */
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

/**
 * Guard that ensures the user is a member of the org.
 * Returns null if authorized, otherwise a 403 NextResponse.
 */
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

  if (!data) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}
