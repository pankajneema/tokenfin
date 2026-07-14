import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireOrgMember } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * GET /api/v1/verify?org_id=<uuid>&since=<iso>
 *
 * The setup wizard's live "listening for your first event…" poller. Counts the
 * org's usage_events since `since` (defaults to 5 min ago) and returns the most
 * recent one so the wizard can flip to "you're live" with real model·tokens·$.
 * Session-authenticated + org-scoped (org member only). Read-only.
 */
export async function GET(req: NextRequest) {
  const url    = new URL(req.url)
  const orgId  = url.searchParams.get('org_id')
  const sinceP = url.searchParams.get('since')

  const guard = await requireOrgMember(orgId)
  if (guard instanceof NextResponse) return guard

  const since = (() => {
    const t = sinceP ? Date.parse(sinceP) : NaN
    return Number.isFinite(t) ? new Date(t).toISOString() : new Date(Date.now() - 5 * 60_000).toISOString()
  })()

  const admin = createAdminClient()

  const [{ count }, { data: latest }] = await Promise.all([
    admin
      .from('usage_events')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId!)
      .gt('created_at', since),
    admin
      .from('usage_events')
      .select('model, total_tokens, cost_usd, created_at')
      .eq('org_id', orgId!)
      .gt('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  return NextResponse.json({
    count: count ?? 0,
    latest: latest
      ? {
          model:  String(latest.model ?? 'unknown'),
          tokens: Number(latest.total_tokens ?? 0),
          cost:   Number(latest.cost_usd ?? 0),
          at:     latest.created_at,
        }
      : null,
  })
}
