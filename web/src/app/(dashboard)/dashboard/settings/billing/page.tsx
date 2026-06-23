import { createClient }      from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
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
    const [{ data: org }, { data: agg }, { data: invNotifs }] = await Promise.all([
      admin.from('organizations').select('plan,name').eq('id', orgId).single(),
      admin.from('usage_agg')
        .select('total_tokens').eq('org_id', orgId)
        .gte('bucket', new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)),
      admin.from('notifications')
        .select('id,title,body,created_at')
        .eq('org_id', orgId).eq('type', 'invoice')
        .order('created_at', { ascending: false }).limit(24),
    ])

    plan       = org?.plan  ?? 'free'
    orgName    = org?.name  ?? ''
    tokensUsed = (agg ?? []).reduce((s, r) => s + Number(r.total_tokens ?? 0), 0)

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
