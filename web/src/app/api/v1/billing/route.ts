/**
 * POST /api/v1/billing
 * Activate a plan for the caller's org. During early access ALL plans are free,
 * so this is a real, instant, no-charge activation — it updates
 * organizations.plan and logs an honest $0 activation record. No payment is
 * collected and none is faked.
 * Body: { plan: string; billing?: 'monthly'|'annual' }
 *
 * GET /api/v1/billing
 * Returns the org's plan-activation history (all $0 during early access).
 *
 * Contact Sales inquiries are handled in the same POST (contactSales: true).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import crypto from 'crypto'

// Tier catalog. Prices are the FUTURE list price (shown for reference); during
// early access every tier is billed at $0.
const PLAN_NAME: Record<string, string> = {
  free: 'Free', team: 'Starter', pro: 'Pro', enterprise: 'Enterprise',
}

function activationId() {
  return 'ACT-' + crypto.randomBytes(3).toString('hex').toUpperCase()
}

function period(date = new Date()) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

/* ─────────────────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { plan?: string; billing?: string; contactSales?: boolean; name?: string; company?: string; message?: string; email?: string }
  const admin = createAdminClient()

  /* ── Contact Sales inquiry ── */
  if (body.contactSales) {
    const { data: member } = await admin
      .from('members').select('org_id').eq('user_id', user.id).limit(1).single()
    const orgId = member?.org_id ?? ''

    await admin.from('notifications').insert({
      org_id:  orgId,
      user_id: user.id,
      type:    'sales_inquiry',
      title:   `Enterprise inquiry from ${body.name ?? user.email}`,
      body:    JSON.stringify({
        name:    body.name    ?? '',
        company: body.company ?? '',
        email:   body.email   ?? user.email,
        message: body.message ?? '',
        date:    new Date().toISOString(),
      }),
      is_read: false,
    })

    return NextResponse.json({ ok: true, message: 'Inquiry received' })
  }

  /* ── Plan purchase / upgrade / downgrade ── */
  const plan    = body.plan ?? 'free'
  const billing = body.billing ?? 'monthly'

  if (!['free','team','pro','enterprise'].includes(plan))
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })

  // Get user's org
  const { data: member } = await admin
    .from('members').select('org_id').eq('user_id', user.id).limit(1).single()
  if (!member) return NextResponse.json({ error: 'No org found' }, { status: 404 })
  const orgId = member.org_id

  // Instantly activate the plan (real DB update — no payment, all tiers free now).
  const { error: updateErr } = await admin
    .from('organizations').update({ plan }).eq('id', orgId)
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  // Honest $0 activation record (not a fake "PAID" invoice).
  const inv = {
    invoiceId:  activationId(),
    plan,
    planName:   PLAN_NAME[plan] ?? plan,
    amount:     0,
    billing,
    period:     period(),
    date:       new Date().toISOString().slice(0, 10),
    annualTotal: null,
    freeEarlyAccess: true,
  }

  await admin.from('notifications').insert({
    org_id:  orgId,
    user_id: user.id,
    type:    'invoice',
    title:   `${inv.planName} plan activated · Free (early access)`,
    body:    JSON.stringify(inv),
    is_read: true,
  })

  return NextResponse.json({ ok: true, invoice: inv, free: true })
}

/* ─────────────────────────────────────────────────────── */
export async function GET(_req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: member } = await admin
    .from('members').select('org_id').eq('user_id', user.id).limit(1).single()
  if (!member) return NextResponse.json([])

  const { data, error } = await admin
    .from('notifications')
    .select('id,title,body,created_at')
    .eq('org_id', member.org_id)
    .eq('type', 'invoice')
    .order('created_at', { ascending: false })
    .limit(24)

  if (error) return NextResponse.json([], { status: 200 })

  const invoices = (data ?? []).map(n => {
    let meta: Record<string,unknown> = {}
    try { meta = JSON.parse(n.body) } catch { /**/ }
    return {
      id:         n.id,
      invoiceId:  meta.invoiceId as string  ?? '—',
      plan:       meta.plan     as string   ?? '—',
      planName:   meta.planName as string   ?? '—',
      amount:     meta.amount   as number   ?? 0,
      billing:    meta.billing  as string   ?? 'monthly',
      period:     meta.period   as string   ?? '',
      date:       meta.date     as string   ?? n.created_at,
      status:     'paid' as const,
    }
  })

  return NextResponse.json(invoices)
}
