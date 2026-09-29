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
import { requireApiKeyOrOrgMember, dbError, type ReadGuard } from '@/lib/api/auth'
import { getOrgTimezone } from '@/lib/org-timezone'
import { zonedMidnightIso } from '@/app/api/v1/me/_window'

interface SourceStatus {
  source: string
  last_event_at: string | null
  tokens_today: number
  cost_basis: string | null
  model: string | null
}

/**
 * Whose events count. Key callers see only their OWN events so `setup`/`status`
 * never report a teammate's traffic:
 *   • personal key (api_keys.user_id) → that user's events;
 *   • org-level key (setup-hub etc.)  → events sent with any org-level key the
 *     same admin minted (the ingest/read pair share created_by).
 * Dashboard sessions keep the org-wide view (the setup beacon).
 */
async function callerFilter(g: ReadGuard): Promise<{ user: string | null; keyIds: string[] | null }> {
  if (!g.viaKey) return { user: null, keyIds: null }
  const { data: k } = await createAdminClient().from('api_keys').select('user_id, created_by').eq('id', g.keyId!).maybeSingle()
  if (k?.user_id) return { user: k.user_id as string, keyIds: null }
  const { data: sibs } = await createAdminClient().from('api_keys').select('id')
    .eq('org_id', g.orgId).is('user_id', null).eq('created_by', (k?.created_by as string | null) ?? '00000000-0000-0000-0000-000000000000')
  return { user: null, keyIds: Array.from(new Set([g.keyId!, ...(sibs ?? []).map(r => r.id as string)])) }
}

export async function GET(req: NextRequest) {
  const guard = await requireApiKeyOrOrgMember(req, req.nextUrl.searchParams.get('org_id'))
  if (guard instanceof NextResponse) return guard
  const { orgId } = guard

  const source = req.nextUrl.searchParams.get('source')
  const tz     = await getOrgTimezone(orgId)
  const since  = zonedMidnightIso(Date.now(), tz)
  const who    = await callerFilter(guard)

  const { data, error } = await createAdminClient().rpc('tf_connection_sources', {
    p_org: orgId, p_since: since, p_user: who.user, p_key_ids: who.keyIds, p_source: source,
  })
  if (error) return dbError(error, 'GET connections')

  const statuses: SourceStatus[] = ((data ?? []) as any[]).map(r => ({
    source:        r.source as string,
    last_event_at: (r.last_event_at as string | null) ?? null,
    tokens_today:  Number(r.tokens_today ?? 0),
    cost_basis:    (r.cost_basis as string | null) ?? null,
    model:         (r.model as string | null) ?? null,
  }))

  if (source) {
    return NextResponse.json(statuses[0] ?? { source, last_event_at: null, tokens_today: 0, cost_basis: null, model: null })
  }
  return NextResponse.json({ sources: statuses, scope: guard.viaKey ? 'caller' : 'org' })
}
