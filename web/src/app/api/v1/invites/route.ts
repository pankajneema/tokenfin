import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgMember, dbError } from '@/lib/api/auth'

function db() { return createAdminClient() }

/* POST /api/v1/invites — invite one or more emails to an org
   Body: { org_id, emails: string[] } */
export async function POST(req: NextRequest) {
  const { org_id, emails } = await req.json()

  if (!org_id || !Array.isArray(emails))
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const guard = await requireOrgMember(org_id)
  if (guard instanceof NextResponse) return guard

  const inserts = emails.map((email: string) => ({
    org_id,
    invited_by: guard.userId,
    email:      email.toLowerCase(),
    role:       'member',
    status:     'pending',
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }))

  const { data, error } = await db()
    .from('invitations')
    .upsert(inserts, { onConflict: 'org_id,email' })
    .select()

  if (error) return dbError(error, 'POST invites')

  // TODO: send invite emails via backend /api/notify
  // For now, invitations are stored and backend scheduler can pick them up

  return NextResponse.json({ invited: data?.length ?? 0 }, { status: 201 })
}

/* GET /api/v1/invites?org_id=xxx — list pending invitations for an org */
export async function GET(req: NextRequest) {
  const org_id = req.nextUrl.searchParams.get('org_id')
  const guard  = await requireOrgMember(org_id)
  if (guard instanceof NextResponse) return guard

  const { data, error } = await db()
    .from('invitations')
    .select('*')
    .eq('org_id', org_id)
    .order('created_at', { ascending: false })

  if (error) return dbError(error, 'GET invites')
  return NextResponse.json(data ?? [])
}
