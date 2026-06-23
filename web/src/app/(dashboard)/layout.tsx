import { redirect }          from 'next/navigation'
import { createClient }      from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { Sidebar }            from '@/components/layout/sidebar'
import { Topbar }             from '@/components/layout/topbar'

/* ── Map DB notification type → UI type ── */
type NotifType     = 'alert' | 'info' | 'success' | 'warning'
type NotifCategory = 'budget' | 'team' | 'system' | 'usage'

function mapType(t: string): NotifType {
  if (t === 'alert')   return 'alert'
  if (t === 'warning') return 'warning'
  if (t === 'success') return 'success'
  return 'info'
}

function mapCategory(title: string, type: string): NotifCategory {
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

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Use admin client for membership + project checks — bypasses RLS so
  // we never get a false-negative that boots the user back to /plans.
  const { data: members } = await admin
    .from('members')
    .select('id, org_id')
    .eq('user_id', user.id)
    .limit(1)

  const membership = members?.[0] ?? null
  if (!membership) {
    console.log('[DashboardLayout] no membership for user', user.id)
    redirect('/plans')
  }

  const [{ data: projects }, { data: orgRow }] = await Promise.all([
    admin.from('projects').select('id').eq('org_id', membership.org_id).limit(1),
    admin.from('organizations').select('plan').eq('id', membership.org_id).single(),
  ])

  const project = projects?.[0] ?? null
  if (!project) {
    console.log('[DashboardLayout] no project for org', membership.org_id)
    redirect('/onboarding')
  }

  /* ── Fetch real notifications ── */
  const { data: rawNotifs } = await admin
    .from('notifications')
    .select('id, title, body, type, is_read, created_at')
    .eq('org_id', membership.org_id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  const notifications = (rawNotifs ?? []).map((n, i) => ({
    id:       i + 1,
    type:     mapType(n.type ?? 'info') as NotifType,
    category: mapCategory(n.title ?? '', n.type ?? '') as NotifCategory,
    title:    n.title ?? 'Notification',
    body:     n.body  ?? '',
    time:     relTime(n.created_at),
    timeMs:   new Date(n.created_at).getTime(),
    read:     n.is_read ?? false,
  }))

  return (
    <div className="flex h-screen bg-[var(--bg-secondary)] overflow-hidden">
      <Sidebar user={user} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar user={user} notifications={notifications} orgPlan={orgRow?.plan ?? 'free'} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
