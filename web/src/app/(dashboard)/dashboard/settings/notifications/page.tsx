import { createClient }         from '@/lib/supabase/server'
import { createAdminClient }    from '@/lib/supabase/server'
import { NotificationsClient }  from './_client'

export const metadata = { title: 'Notification Settings — TokenFin' }

export interface NotifPrefs {
  budget_breach_email:   boolean
  budget_breach_slack:   boolean
  weekly_digest_email:   boolean
  weekly_digest_inapp:   boolean
  anomaly_email:         boolean
  anomaly_inapp:         boolean
  member_events_email:   boolean
  member_events_inapp:   boolean
  api_errors_email:      boolean
  api_errors_inapp:      boolean
  quiet_start:           string
  quiet_end:             string
}

const DEFAULTS: NotifPrefs = {
  budget_breach_email:  true,
  budget_breach_slack:  false,
  weekly_digest_email:  true,
  weekly_digest_inapp:  true,
  anomaly_email:        true,
  anomaly_inapp:        true,
  member_events_email:  false,
  member_events_inapp:  true,
  api_errors_email:     true,
  api_errors_inapp:     true,
  quiet_start:          '22:00',
  quiet_end:            '08:00',
}

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

  const saved = (prefRow?.settings ?? {}) as Partial<NotifPrefs>
  const prefs: NotifPrefs = { ...DEFAULTS, ...saved }

  return <NotificationsClient initialPrefs={prefs} userEmail={user.email ?? ''} />
}
