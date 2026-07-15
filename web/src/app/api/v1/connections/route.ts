/**
 * GET /api/v1/connections — per-source connection status.
 *
 * Powers: the CLI `setup` poll ("waiting for first event…" → success), `status`
 * and `doctor`, and the interim setup beacon. A connection is only "live" if
 * real events have arrived — config written is never reported as connected.
 *
 * Auth: Bearer tfk_… (CLI) OR dashboard session (browser). ?source=claude_code
 * filters to one source; omit for all sources.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireApiKeyOrOrgMember, dbError } from '@/lib/api/auth'

function db() { return createAdminClient() }

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)

interface SourceStatus {
  source: string
  last_event_at: string | null
  tokens_today: number
  cost_basis: string | null
  model: string | null
}

async function statusFor(orgId: string, source: string): Promise<SourceStatus> {
  const admin = db()
  // Latest event for this source.
  const { data: last } = await admin
    .from('usage_events')
    .select('created_at, cost_basis, model')
    .eq('org_id', orgId).eq('source', source)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  // Today's tokens for this source (IST day, matching agg buckets).
  const sinceIso = `${istToday()}T00:00:00.000Z`
  const { data: today } = await admin
    .from('usage_events')
    .select('total_tokens')
    .eq('org_id', orgId).eq('source', source)
    .gte('created_at', sinceIso)

  const tokensToday = (today ?? []).reduce((s, r) => s + Number(r.total_tokens ?? 0), 0)
  return {
    source,
    last_event_at: (last?.created_at as string | undefined) ?? null,
    tokens_today: tokensToday,
    cost_basis: (last?.cost_basis as string | undefined) ?? null,
    model: (last?.model as string | undefined) ?? null,
  }
}

export async function GET(req: NextRequest) {
  const guard = await requireApiKeyOrOrgMember(req, req.nextUrl.searchParams.get('org_id'))
  if (guard instanceof NextResponse) return guard
  const { orgId } = guard

  const source = req.nextUrl.searchParams.get('source')
  try {
    if (source) return NextResponse.json(await statusFor(orgId, source))

    // All sources seen for this org.
    const { data: rows, error } = await db()
      .from('usage_events').select('source').eq('org_id', orgId).not('source', 'is', null).limit(1000)
    if (error) return dbError(error, 'GET connections sources')
    const sources = Array.from(new Set((rows ?? []).map(r => r.source as string)))
    const statuses = await Promise.all(sources.map(s => statusFor(orgId, s)))
    return NextResponse.json({ sources: statuses })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'failed' }, { status: 500 })
  }
}
