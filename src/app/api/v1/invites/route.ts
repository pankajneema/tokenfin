import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const authenticatedClient = createClient()
  const serviceClient = createServiceRoleClient()
  const { org_id, emails } = await req.json()

  if (!org_id || !Array.isArray(emails))
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const { data: { user } } = await authenticatedClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const inserts = emails.map((email: string) => ({
    org_id,
    invited_by: user.id,
    email:      email.toLowerCase(),
    role:       'member',
    status:     'pending',
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }))

  const { data, error } = await serviceClient
    .from('invitations')
    .upsert(inserts, { onConflict: 'org_id,email' })
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // TODO: send invite emails via backend /api/notify
  // For now, invitations are stored and backend scheduler can pick them up

  return NextResponse.json({ invited: data?.length ?? 0 }, { status: 201 })
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const org_id   = req.nextUrl.searchParams.get('org_id')
  if (!org_id) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('invitations')
    .select('*')
    .eq('org_id', org_id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
