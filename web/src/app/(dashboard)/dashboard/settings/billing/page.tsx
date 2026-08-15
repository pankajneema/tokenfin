import { createClient }      from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getOrgRole }         from '@/lib/api/auth'
import { can }                from '@/lib/rbac'
import { redirect }           from 'next/navigation'
import { BillingClient }     from './_client'

export const metadata = { title: 'Billing — TokenFin' }

export default async function BillingPage() {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: members } = await admin
    .from('members').select('org_id').eq('user_id', user.id).limit(1)
  const orgId = members?.[0]?.org_id ?? ''

  // Billing is owner-only
  const role = await getOrgRole(user.id, orgId)
  if (!can(role, 'billing:view')) redirect('/dashboard')

  let plan      = 'free'
  let orgName   = ''
  let orgIdOut  = orgId
  let tokensUsed = 0

  const now         = new Date()
  const renewalDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const resetLabel  = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  // Invoice type used by client
  type InvoiceRow = {
    id: string; invoiceId: string; planName: string
    amount: number; billing: string; period: string; date: string; status: 'paid'
  }
  let invoices: InvoiceRow[] = []

  if (orgId) {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const [{ data: org }, { data: agg }, { data: evts }, { data: invNotifs }] = await Promise.all([
      admin.from('organizations').select('plan,name').eq('id', orgId).single(),
      admin.from('usage_agg')
        .select('total_tokens').eq('org_id', orgId)
        .gte('bucket', monthStart),
      admin.from('usage_events')
        .select('total_tokens,cost_basis').eq('org_id', orgId)
        .gte('created_at', new Date(now.getFullYear(), now.getMonth(), 1).toISOString()),
      admin.from('notifications')
        .select('id,title,body,created_at')
        .eq('org_id', orgId).eq('type', 'invoice')
        .order('created_at', { ascending: false }).limit(24),
    ])

    plan       = org?.plan  ?? 'free'
    orgName    = org?.name  ?? ''
    // usage_agg is written async and can lag or partially miss rows — fall
    // back to raw usage_events (source of truth) when agg looks incomplete,
    // same pattern as the dashboard/analytics pages, so billing never quotes
    // a lower token count than what the user actually sees elsewhere.
    // usage_agg only ever holds METERED rows (notional/subscription usage is
    // deliberately excluded from it), so the fallback side must exclude
    // notional too — otherwise the comparison always looks "incomplete" for
    // any org with subscription usage, permanently forcing the fallback.
    const aggTokens  = (agg  ?? []).reduce((s, r) => s + Number(r.total_tokens ?? 0), 0)
    const evtsMetered = (evts ?? []).filter(r => (r as Record<string,unknown>).cost_basis !== 'notional')
    const evtsTokens  = evtsMetered.reduce((s, r) => s + Number(r.total_tokens ?? 0), 0)
    tokensUsed = aggTokens > 0 && aggTokens >= evtsTokens * 0.95 ? aggTokens : evtsTokens

    invoices = (invNotifs ?? []).map(n => {
      let meta: Record<string, unknown> = {}
      try { meta = JSON.parse(n.body) } catch { /**/ }
      return {
        id:         n.id,
        invoiceId:  meta.invoiceId  as string ?? '—',
        planName:   meta.planName   as string ?? '—',
        amount:     meta.amount     as number ?? 0,
        billing:    meta.billing    as string ?? 'monthly',
        period:     meta.period     as string ?? '',
        date:       meta.date       as string ?? String(n.created_at).slice(0, 10),
        status:     'paid' as const,
      }
    })
  }

  return (
    <BillingClient
      currentPlan={plan}
      orgName={orgName}
      orgId={orgIdOut}
      tokensUsed={tokensUsed}
      renewalDate={renewalDate}
      resetLabel={resetLabel}
      invoices={invoices}
    />
  )
}
