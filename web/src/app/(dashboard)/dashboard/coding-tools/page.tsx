import { requireOrgContext } from '@/lib/org-context'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { can } from '@/lib/rbac'
import { buildCodingToolsView, type ToolSummaryRow } from '@/lib/connectors/summary'
import { loadMergedPrData } from '@/lib/connectors/merged-prs'
import { CONNECTOR_PROVIDERS } from '@/lib/connectors/types'
import { CodingToolsClient } from './_client'
import type { CodingToolsData, ConnectorStatus, GithubMapping } from './_types'

export const metadata = { title: 'Coding tools — TokenFin' }
export const dynamic = 'force-dynamic'
export const revalidate = 0

const ALLOWED_DAYS = [7, 30]

/**
 * All coding AI in one view: vendor pull connectors (Claude Code Analytics API,
 * Cursor, GitHub Copilot → coding_tool_usage) + TokenFin's own CLI-agent
 * telemetry (usage_events by source, productivity_daily), per tool and per
 * developer; plus cost per merged PR (GitHub → merged_prs).
 * Days are UTC calendar days — vendors report UTC days.
 */
export default async function CodingToolsPage({ searchParams }: { searchParams?: Promise<{ days?: string }> }) {
  const sp = await searchParams
  const days = ALLOWED_DAYS.includes(Number(sp?.days)) ? Number(sp?.days) : 30

  const supabase = createClient()
  const admin    = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const ctx = await requireOrgContext()   // honours the selected workspace (tf_org)
  const orgId = ctx.orgId
  const role  = ctx.role

  const now = new Date()
  const sinceMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days - 1) * 86400_000
  const since = new Date(sinceMs).toISOString().slice(0, 10)

  const [summary, { data: conns }, mappings, { data: members }, { data: authData }] = await Promise.all([
    fetchAllRows<ToolSummaryRow>((from, to) => admin
      .rpc('coding_tools_summary', { p_org: orgId, p_since: since, p_since_ts: new Date(sinceMs).toISOString() })
      .order('tool').order('user_key').range(from, to))
      .catch(e => { console.error('[coding-tools] summary failed:', (e as Error)?.message ?? e); return [] as ToolSummaryRow[] }),
    admin.from('provider_connections')
      .select('provider, key_hint, status, last_synced_at, last_error, config')
      .eq('org_id', orgId).in('provider', CONNECTOR_PROVIDERS as string[]),
    fetchAllRows<GithubMapping>((from, to) => admin.from('github_user_map')
      .select('login, user_key').eq('org_id', orgId).order('login').range(from, to))
      .catch(() => [] as GithubMapping[]),
    admin.from('members').select('user_id').eq('org_id', orgId),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ])

  const orgUserIds = new Set((members ?? []).map(m => m.user_id as string))
  const people = new Map<string, { name: string; email: string }>()
  for (const u of authData?.users ?? []) {
    if (!orgUserIds.has(u.id) || !u.email) continue
    const email = u.email.toLowerCase()
    people.set(email, { email, name: (u.user_metadata?.full_name as string | undefined) ?? email.split('@')[0] })
  }

  const data: CodingToolsData = {
    orgId, days, since,
    canConnect: can(role, 'org:edit'),
    canManage:  can(role, 'integrations:manage'),
    connections: (conns ?? []) as ConnectorStatus[],
    view: buildCodingToolsView(summary, people),
    mappings,
    memberEmails: Array.from(people.keys()).sort(),
    prs: await loadMergedPrData(admin, orgId, days, people),
  }
  return <CodingToolsClient data={data} />
}
