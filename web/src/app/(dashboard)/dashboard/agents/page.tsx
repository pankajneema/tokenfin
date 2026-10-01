import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext } from '@/lib/org-context'
import { can } from '@/lib/rbac'
import { loadAgentsView } from '@/lib/agent-configs/server'
import { zonedMidnightIso } from '@/app/api/v1/me/_window'
import { AgentsClient } from './_client'

export const metadata = { title: 'Agents — TokenFin' }
export const dynamic = 'force-dynamic'

/**
 * Agents (server). People → devices → coding agents, with each agent's
 * redacted config snapshot (pushed by `tokenfin config push`), a readable
 * summary + warnings, and pull-based change requests. Owners/admins see
 * everyone; members and viewers only their own machines.
 */
export default async function AgentsPage() {
  const ctx = await requireOrgContext()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tokenfin.curiousdevs.com'
  const { data: org } = await createAdminClient().from('organizations').select('capture_prompts').eq('id', ctx.orgId).maybeSingle()
  const capturePrompts = (org as { capture_prompts?: boolean | null } | null)?.capture_prompts !== false

  let people: Awaited<ReturnType<typeof loadAgentsView>> = []
  let loadError = false
  try {
    people = await loadAgentsView(ctx.orgId, { userId: ctx.user.id, role: ctx.role }, { appUrl, capturePrompts }, zonedMidnightIso(Date.now(), ctx.timezone))
  } catch (e) {
    console.error('[agents] load failed:', e)
    loadError = true
  }

  return (
    <AgentsClient
      orgId={ctx.orgId}
      people={people}
      viewerId={ctx.user.id}
      isAdmin={can(ctx.role, 'prompts:view_all')}
      appUrl={appUrl}
      loadError={loadError}
    />
  )
}
