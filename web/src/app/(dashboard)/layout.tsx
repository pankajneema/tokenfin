import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext } from '@/lib/org-context'
import { AppShell }           from '@/components/layout/app-shell'

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
  // Signed out → /login, no org → /welcome (shared, cached per request).
  const { user, orgId } = await requireOrgContext()
  const admin = createAdminClient()
  const membership = { org_id: orgId }

  const { data: projects } = await admin.from('projects').select('id').eq('org_id', orgId).limit(1)
  if (!projects?.[0]) {
    console.log('[DashboardLayout] no project for org', orgId)
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

  // Filter out internal system records (invoices, sales inquiries)
  const filteredNotifs = (rawNotifs ?? []).filter(
    n => n.type !== 'invoice' && n.type !== 'sales_inquiry'
  )

  const notifications = filteredNotifs.map((n, i) => ({
    dbId:     n.id as string,          // DB UUID — for PATCH mark-as-read
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
    <>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <AppShell user={user} notifications={notifications}>{children}</AppShell>
    </>
  )
}
