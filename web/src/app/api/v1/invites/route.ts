import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgMember, dbError } from '@/lib/api/auth'

function db() { return createAdminClient() }

/* POST /api/v1/invites — invite one or more emails to an org
   Body: { org_id, emails: string[] } */
export async function POST(req: NextRequest) {
  const { org_id, emails } = await req.json()

  if (!org_id || !Array.isArray(emails) || emails.length === 0)
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const guard = await requireOrgMember(org_id)
  if (guard instanceof NextResponse) return guard

  const admin  = createAdminClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tokenfin.curiousdevs.com'

  const results: { email: string; status: 'sent' | 'failed'; error?: string }[] = []

  for (const rawEmail of emails) {
    const email = rawEmail.trim().toLowerCase()
    if (!email) continue

    // 1. Send real invite email via Supabase Auth
    //    Invited user lands on /auth/callback → redirected to /dashboard
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${appUrl}/auth/callback?next=/dashboard`,
      data: { org_id, invited_by: guard.userId },
    })

    if (inviteErr) {
      // User may already exist in auth — still record invitation
      console.warn(`[invites] ${email}:`, inviteErr.message)
      results.push({ email, status: 'failed', error: inviteErr.message })
    } else {
      results.push({ email, status: 'sent' })
    }

    // 2. Always upsert into invitations table (for pending list UI)
    await db()
      .from('invitations')
      .upsert(
        {
          org_id,
          invited_by: guard.userId,
          email,
          role:       'member',
          status:     'pending',
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
        { onConflict: 'org_id,email' },
      )
  }

  const sent   = results.filter(r => r.status === 'sent').length
  const failed = results.filter(r => r.status === 'failed').length

  return NextResponse.json({ invited: sent, failed, results }, { status: 201 })
}

/* GET /api/v1/invites?org_id=xxx — list pending invitations for an org */
export async function GET(req: NextRequest) {
  const org_id = req.nextUrl.searchParams.get('org_id')
  const guard  = await requireOrgMember(org_id)
  if (guard instanceof NextResponse) return guard

  const { data, error } = await db()
    .from('invitations')
    .select('id, email, role, status, expires_at, created_at')
    .eq('org_id', org_id!)
    .order('created_at', { ascending: false })

  if (error) return dbError(error, 'GET invites')
  return NextResponse.json(data ?? [])
}

/* DELETE /api/v1/invites?id=xxx — cancel a pending invitation */
export async function DELETE(req: NextRequest) {
  const id     = req.nextUrl.searchParams.get('id')
  const org_id = req.nextUrl.searchParams.get('org_id')
  if (!id || !org_id)
    return NextResponse.json({ error: 'id and org_id required' }, { status: 400 })

  const guard = await requireOrgMember(org_id)
  if (guard instanceof NextResponse) return guard

  const { error } = await db()
    .from('invitations')
    .delete()
    .eq('id', id)
    .eq('org_id', org_id)

  if (error) return dbError(error, 'DELETE invite')
  return NextResponse.json({ ok: true })
}
