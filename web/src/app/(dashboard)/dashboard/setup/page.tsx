import { createClient, createAdminClient } from '@/lib/supabase/server'
import { can } from '@/lib/rbac'
import type { Role } from '@/lib/rbac'
import { getOrCreateSetupKey } from '@/lib/setup/key'
import { SetupClient } from './_client'

export const metadata = { title: 'Connections — TokenFin' }

/**
 * Setup Hub (server). Resolves the org + role, and — for admins — get-or-creates
 * the injected "setup-hub" key on load so every install link ships ready to use.
 * Non-admins see a gated state (only admins can mint the shared key).
 */
export default async function SetupPage() {
  const supabase = createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: member } = await admin
    .from('members').select('org_id, role')
    .eq('user_id', user.id)
    .order('joined_at', { ascending: true })
    .limit(1).maybeSingle()

  const orgId = (member?.org_id as string | undefined) ?? ''
  const role = (member?.role as Role | undefined) ?? 'viewer'
  const isAdmin = can(role, 'keys:create')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tokenfin.curiousdevs.com'
  const endpoint = appUrl + '/api/mcp'

  let setupKey: { id: string; raw: string; masked: string } | null = null
  let keyError = false
  if (orgId && isAdmin) {
    try {
      const k = await getOrCreateSetupKey(orgId, user.id)
      setupKey = { id: k.id, raw: k.raw, masked: k.masked }
    } catch {
      keyError = true
    }
  }

  return (
    <SetupClient
      endpoint={endpoint}
      appUrl={appUrl}
      orgId={orgId}
      isAdmin={isAdmin}
      keyError={keyError}
      initialKey={setupKey}
    />
  )
}
