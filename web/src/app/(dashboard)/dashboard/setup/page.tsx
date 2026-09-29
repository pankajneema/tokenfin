import { createClient, createAdminClient } from '@/lib/supabase/server'
import { can } from '@/lib/rbac'
import type { Role } from '@/lib/rbac'
import { getOrCreateSetupKey } from '@/lib/setup/key'
import { SetupClient } from './_client'
import { requireOrgContext } from '@/lib/org-context'
import { getRollout, type RolloutRow } from './_rollout'

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

  const ctx = await requireOrgContext()   // honours the selected workspace (tf_org)
  const orgId = ctx.orgId
  const role: Role = ctx.role
  const isAdmin = can(role, 'keys:create')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tokenfin.curiousdevs.com'
  const endpoint = appUrl + '/api/mcp'

  let setupKey: { id: string; raw: string; masked: string } | null = null
  let keyError = false
  let rollout: RolloutRow[] = []
  let capturePrompts = true
  if (orgId) {
    const { data: org, error } = await admin.from('organizations').select('capture_prompts').eq('id', orgId).maybeSingle()
    if (!error && (org as { capture_prompts?: boolean | null } | null)?.capture_prompts === false) capturePrompts = false
  }
  if (orgId && isAdmin) {
    try {
      const k = await getOrCreateSetupKey(orgId, user.id)
      setupKey = { id: k.id, raw: k.raw, masked: k.masked }
    } catch {
      keyError = true
    }
    try { rollout = await getRollout(orgId) } catch (e) { console.error('[setup] rollout failed:', e) }
  }

  return (
    <SetupClient
      endpoint={endpoint}
      appUrl={appUrl}
      orgId={orgId}
      isAdmin={isAdmin}
      keyError={keyError}
      initialKey={setupKey}
      rollout={rollout}
      capturePrompts={capturePrompts}
    />
  )
}
