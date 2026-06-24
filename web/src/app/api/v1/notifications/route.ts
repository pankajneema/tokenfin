/**
 * GET  /api/v1/notifications  — fetch up to 30 notifications for the caller's org
 * PATCH /api/v1/notifications — mark as read
 *   body: { id: string }       → mark one
 *   body: { all: true }        → mark all unread for this user's org
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

type NotifType     = 'alert' | 'info' | 'success' | 'warning'
type NotifCategory = 'budget' | 'team' | 'system' | 'usage'

function mapType(t: string): NotifType {
  if (t === 'alert')   return 'alert'
  if (t === 'warning') return 'warning'
  if (t === 'success') return 'success'
  return 'info'
}

function mapCategory(title: string): NotifCategory {
  const l = title.toLowerCase()
  if (l.includes('budget') || l.includes('spend') || l.includes('cost')) return 'budget'
  if (l.includes('member') || l.includes('team')  || l.includes('key'))  return 'team'
  if (l.includes('usage')  || l.includes('spike')  || l.includes('token')) return 'usage'
  return 'system'
}

function relTime(isoStr: string): string {
  const ms = Date.now() - new Date(isoStr).getTime()
  if (ms < 60_000)          return 'Just now'
  if (ms < 3_600_000)       return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000)      return `${Math.round(ms / 3_600_000)}h ago`
  if (ms < 2 * 86_400_000)  return 'Yesterday'
  return new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

async function getOrgId(userId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('members').select('org_id').eq('user_id', userId).limit(1).single()
  return data?.org_id ?? null
}

/* ─── GET ─────────────────────────────────────────────── */
export async function GET(_req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orgId = await getOrgId(user.id)
  if (!orgId) return NextResponse.json([])

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('notifications')
    .select('id, title, body, type, is_read, created_at')
    .eq('org_id', orgId)
    .not('type', 'in', '("invoice","sales_inquiry")')   // those are system-internal
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) return NextResponse.json([], { status: 200 })

  const notifs = (data ?? []).map((n, i) => ({
    dbId:     n.id as string,
    id:       i + 1,
    type:     mapType(n.type ?? 'info') as NotifType,
    category: mapCategory(n.title ?? '') as NotifCategory,
    title:    n.title ?? 'Notification',
    body:     n.body  ?? '',
    time:     relTime(n.created_at),
    timeMs:   new Date(n.created_at).getTime(),
    read:     n.is_read ?? false,
  }))

  return NextResponse.json(notifs)
}

/* ─── PATCH ───────────────────────────────────────────── */
export async function PATCH(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orgId = await getOrgId(user.id)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 404 })

  const body = await req.json() as { id?: string; all?: boolean }
  const admin = createAdminClient()

  if (body.all) {
    await admin
      .from('notifications')
      .update({ is_read: true })
      .eq('org_id', orgId)
      .eq('is_read', false)
    return NextResponse.json({ ok: true })
  }

  if (body.id) {
    await admin
      .from('notifications')
      .update({ is_read: true })
      .eq('id', body.id)
      .eq('org_id', orgId)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Provide id or all:true' }, { status: 400 })
}
