import { createClient }         from '@/lib/supabase/server'
import { createAdminClient }    from '@/lib/supabase/server'
import { NotificationsClient }  from './_client'
import { resolvePrefs, type NotifPrefs } from '@/lib/alerts/prefs'

export const metadata = { title: 'Notification Settings — TokenFin' }

// Keys, defaults and validation live in lib/alerts/prefs (shared with the
// alert engine, weekly digest and /api/v1/preferences).
export type { NotifPrefs }

export default async function NotificationsPage() {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: prefRow } = await admin
    .from('user_preferences')
    .select('settings')
    .eq('user_id', user.id)
    .maybeSingle()

  const prefs: NotifPrefs = resolvePrefs(prefRow?.settings)

  return <NotificationsClient initialPrefs={prefs} userEmail={user.email ?? ''} />
}
