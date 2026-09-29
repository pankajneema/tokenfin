import { requireOrgContext } from '@/lib/org-context'
import { createClient }       from '@/lib/supabase/server'
import { createAdminClient }  from '@/lib/supabase/server'
import { ProfileClient }      from './_client'

export const metadata = { title: 'Profile Settings — TokenFin' }

export default async function ProfilePage() {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const ctx = await requireOrgContext()   // honours the selected workspace (tf_org)
  const membership = { role: ctx.role, org_id: ctx.orgId }

  // Fetch org name
  let orgName = ''
  if (membership?.org_id) {
    const { data: org } = await admin
      .from('organizations')
      .select('name')
      .eq('id', membership.org_id)
      .single()
    orgName = org?.name ?? ''
  }

  const meta = (user.user_metadata ?? {}) as Record<string, string>

  return (
    <ProfileClient
      userId={user.id}
      initialName={meta.full_name ?? meta.name ?? ''}
      initialHandle={meta.handle ?? (user.email?.split('@')[0] ?? '')}
      initialBio={meta.bio ?? ''}
      initialTimezone={meta.timezone ?? 'Asia/Kolkata'}
      initialLang={meta.lang ?? 'en'}
      email={user.email ?? ''}
      role={membership?.role ?? 'viewer'}
      orgName={orgName}
    />
  )
}
