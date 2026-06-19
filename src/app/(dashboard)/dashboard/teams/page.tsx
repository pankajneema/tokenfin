import { createClient }  from '@/lib/supabase/server'
import { TeamsClient }   from './_client'

export const metadata = { title: 'Teams — TokenFin' }

/* ── Exported types ─────────────────────────────────────────── */
export interface TeamRow {
  id:         string
  name:       string
  projectId:  string | null
  createdAt:  string
  budget:     number | null
  warnAt:     number
  throttleAt: number
  memberCount: number
}

export interface MemberRow {
  id:         string
  userId:     string
  teamId:     string | null
  role:       string
  createdAt:  string
}

export interface ProjectRow {
  id:   string
  name: string
  slug: string
}

/* ═══════════════════════════════════════════════════════════════ */
export default async function TeamsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: membership } = await supabase
    .from('members')
    .select('org_id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const orgId = membership?.org_id ?? ''

  const [
    { data: teams   },
    { data: members },
    { data: limits  },
    { data: projects },
  ] = await Promise.all([
    supabase.from('teams').select('id,name,project_id,created_at').eq('org_id', orgId).order('created_at', { ascending: true }),
    supabase.from('members').select('id,user_id,team_id,role,created_at').eq('org_id', orgId),
    supabase.from('limits').select('team_id,budget_usd,warn_at,throttle_at').eq('org_id', orgId).eq('scope', 'team'),
    supabase.from('projects').select('id,name,slug').eq('org_id', orgId).order('created_at', { ascending: false }),
  ])

  const limitMap: Record<string, { budget: number; warnAt: number; throttleAt: number }> = {}
  for (const l of limits ?? []) {
    if (l.team_id) limitMap[l.team_id] = { budget: l.budget_usd, warnAt: l.warn_at, throttleAt: l.throttle_at }
  }

  const memberCountMap: Record<string, number> = {}
  for (const m of members ?? []) {
    if (m.team_id) memberCountMap[m.team_id] = (memberCountMap[m.team_id] ?? 0) + 1
  }

  const enrichedTeams: TeamRow[] = (teams ?? []).map(t => ({
    id:          t.id,
    name:        t.name,
    projectId:   t.project_id,
    createdAt:   t.created_at,
    budget:      limitMap[t.id]?.budget      ?? null,
    warnAt:      limitMap[t.id]?.warnAt      ?? 70,
    throttleAt:  limitMap[t.id]?.throttleAt  ?? 90,
    memberCount: memberCountMap[t.id]        ?? 0,
  }))

  const enrichedMembers: MemberRow[] = (members ?? []).map(m => ({
    id:        m.id,
    userId:    m.user_id,
    teamId:    m.team_id,
    role:      m.role,
    createdAt: m.created_at,
  }))

  return (
    <TeamsClient
      teams={enrichedTeams}
      members={enrichedMembers}
      projects={(projects ?? []) as ProjectRow[]}
      orgId={orgId}
    />
  )
}
