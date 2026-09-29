import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext } from '@/lib/org-context'
import { promptScope } from '@/lib/rbac'
import { computeInsights, userKeyOf } from '@/lib/insights/load'
import { InsightsClient } from './_client'

export const metadata = { title: 'Insights — TokenFin' }
export const dynamic = 'force-dynamic'

export default async function InsightsPage() {
  const ctx = await requireOrgContext()
  const scope = promptScope(ctx.role, ctx.user.id)
  const userKey = scope ? userKeyOf(ctx.user.email, ctx.user.id) : null

  let error: string | null = null
  const result = await computeInsights(createAdminClient(), ctx.orgId, { timezone: ctx.timezone, userKey })
    .catch((e: unknown) => { error = e instanceof Error ? e.message : String(e); return null })

  return <InsightsClient result={result} error={error} />
}
