import { createClient }   from '@/lib/supabase/server'
import { ProjectsClient } from './_client'

export const metadata = { title: 'Projects — TokenFin' }

/* ── Type ───────────────────────────────────────────────────── */
export interface EnrichedProject {
  id:           string
  name:         string
  slug:         string
  description:  string | null
  created_at:   string
  cost:         number
  tokens:       number
  reqs:         number
  keyCount:     number
  lastEventAt:  string | null
}

/* ═══════════════════════════════════════════════════════════════ */
export default async function ProjectsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  /* ── Get org ── */
  const { data: membership } = await supabase
    .from('members')
    .select('org_id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const orgId = membership?.org_id ?? ''

  /* ── Parallel fetch ── */
  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString()

  const [
    { data: projects },
    { data: usage    },
    { data: keys     },
    { data: lastEvts },
  ] = await Promise.all([
    supabase
      .from('projects')
      .select('id,name,slug,description,created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    supabase
      .from('usage_events')
      .select('project_id,cost_usd,total_tokens')
      .eq('org_id', orgId)
      .gte('created_at', since30),
    supabase
      .from('api_keys')
      .select('project_id,is_active')
      .eq('org_id', orgId),
    supabase
      .from('usage_events')
      .select('project_id,created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  /* ── Aggregate ── */
  const usageMap: Record<string, { cost: number; tokens: number; reqs: number }> = {}
  for (const e of usage ?? []) {
    if (!usageMap[e.project_id]) usageMap[e.project_id] = { cost: 0, tokens: 0, reqs: 0 }
    usageMap[e.project_id].cost   += e.cost_usd     ?? 0
    usageMap[e.project_id].tokens += e.total_tokens ?? 0
    usageMap[e.project_id].reqs++
  }

  const keyCount: Record<string, number>    = {}
  for (const k of keys ?? []) {
    if (k.is_active) keyCount[k.project_id] = (keyCount[k.project_id] ?? 0) + 1
  }

  const lastSeen: Record<string, string> = {}
  for (const e of lastEvts ?? []) {
    if (!lastSeen[e.project_id]) lastSeen[e.project_id] = e.created_at
  }

  const enriched: EnrichedProject[] = (projects ?? []).map(p => ({
    ...p,
    cost:        usageMap[p.id]?.cost   ?? 0,
    tokens:      usageMap[p.id]?.tokens ?? 0,
    reqs:        usageMap[p.id]?.reqs   ?? 0,
    keyCount:    keyCount[p.id]         ?? 0,
    lastEventAt: lastSeen[p.id]         ?? null,
  }))

  return <ProjectsClient projects={enriched} orgId={orgId} />
}
