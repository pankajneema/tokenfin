import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/sidebar'
import { Topbar }  from '@/components/layout/topbar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // No org/plan yet → plan selection
  const { data: membership } = await supabase
    .from('members')
    .select('id, org_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (!membership) redirect('/plans')

  // Has org but no projects yet → onboarding wizard
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('org_id', membership.org_id)
    .limit(1)
    .maybeSingle()

  if (!project) redirect('/onboarding')

  return (
    <div className="flex h-screen bg-[var(--bg-secondary)] overflow-hidden">
      <Sidebar user={user} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar user={user} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
