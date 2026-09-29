import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext } from '@/lib/org-context'
import { promptScope } from '@/lib/rbac'
import { getOrgPrices } from '@/lib/pricing-overrides'
import { loadWhatIfData, userKeyOf } from '@/lib/insights/load'
import { DEFAULT_SEAT_USD } from '@/lib/insights/waste'
import { WhatIfClient } from './_client'

export const metadata = { title: 'What-if — TokenFin' }
export const dynamic = 'force-dynamic'

export default async function WhatIfPage() {
  const ctx = await requireOrgContext()
  const scope = promptScope(ctx.role, ctx.user.id)
  const userKey = scope ? userKeyOf(ctx.user.email, ctx.user.id) : null
  const admin = createAdminClient()
  const [data, overrides] = await Promise.all([
    loadWhatIfData(admin, ctx.orgId, ctx.timezone, userKey),
    getOrgPrices(admin, ctx.orgId),
  ])
  return <WhatIfClient data={data} overrides={overrides} scoped={!!userKey} defaultSeatUsd={DEFAULT_SEAT_USD} />
}
