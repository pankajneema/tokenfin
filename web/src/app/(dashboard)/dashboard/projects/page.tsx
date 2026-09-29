import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext } from '@/lib/org-context'
import { dashBreakdown, dashSummary } from '@/lib/rollups'
import { resolveWindow } from '@/lib/rollup-scope'
import { ProjectsClient } from './_client'

export const metadata = { title: 'Projects — TokenFin' }
export const dynamic = 'force-dynamic'
export const revalidate = 0

/* ── Type ───────────────────────────────────────────────────── */
export interface EnrichedProject {
  id:           string
  name:         string
  slug:         string
  description:  string | null
  created_at:   string
  cost:         number
  meteredCost:  number
  notionalCost: number
  tokens:       number
  reqs:         number
  prompts:      number
  keyCount:     number
  lastEventAt:  string | null
}

/* ═══════════════════════════════════════════════════════════════ */
export default async function ProjectsPage() {
  const ctx   = await requireOrgContext()
  const admin = createAdminClient()
  const orgId = ctx.orgId
  const win   = resolveWindow(undefined, ctx.timezone, { defaultDays: 30 })

  const [{ data: projects }, usage, { data: keys }] = await Promise.all([
    admin
      .from('projects')
      .select('id,name,slug,description,created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    dashBreakdown(admin, orgId, win.from, win.to, 'project', undefined, 1000),
    admin
      .from('api_keys')
      .select('project_id,is_active')
      .eq('org_id', orgId),
  ])
  const ids = (projects ?? []).map(p => p.id as string)

  // Prompts per project (rollup) + last event per project (index: project_id, created_at desc).
  const [prompts, lastSeen] = await Promise.all([
    Promise.all(ids.map(id => usage.rows.some(r => r.key === id)
      ? dashSummary(admin, orgId, win.from, win.to, { project_id: id }).then(s => s.prompts)
      : Promise.resolve(0))),
    Promise.all(ids.map(id => admin.from('usage_events').select('created_at')
      .eq('org_id', orgId).eq('project_id', id).order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => (data?.[0]?.created_at as string | undefined) ?? null))),
  ])

  const usageMap = new Map(usage.rows.map(r => [r.key, r]))
  const keyCount: Record<string, number> = {}
  for (const k of keys ?? []) {
    if (k.is_active && k.project_id) keyCount[k.project_id] = (keyCount[k.project_id] ?? 0) + 1
  }

  const enriched: EnrichedProject[] = (projects ?? []).map((p, i) => {
    const u = usageMap.get(p.id)
    return {
      ...p,
      cost:        u?.cost_usd          ?? 0,
      meteredCost: u?.metered_cost_usd  ?? 0,
      notionalCost: u?.notional_cost_usd ?? 0,
      tokens:      u?.total_tokens      ?? 0,
      reqs:        u?.requests          ?? 0,
      prompts:     prompts[i],
      keyCount:    keyCount[p.id]       ?? 0,
      lastEventAt: lastSeen[i],
    }
  })

  return <ProjectsClient projects={enriched} orgId={orgId} windowLabel={win.label} />
}
