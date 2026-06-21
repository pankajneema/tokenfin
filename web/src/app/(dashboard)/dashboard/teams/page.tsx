import { createClient }      from '@/lib/supabase/server'
import { createAdminClient }  from '@/lib/supabase/server'
import { TeamsClient }        from './_client'

export const metadata = { title: 'Teams — TokenFin' }

/* ── Types (exported so _client.tsx can import them) ─────── */
export interface TeamRow {
  id:          string
  name:        string
  projectId:   string | null
  createdAt:   string
  budget:      number | null
  warnAt:      number
  throttleAt:  number
  memberCount: number
}

export interface MemberRow {
  id:        string
  userId:    string
  teamId:    string | null
  role:      string
  createdAt: string
  name:      string    // from auth.users metadata
  email:     string    // from auth.users
}

export interface ProjectRow {
  id:   string
  name: string
  slug: string
}

/* ═══════════════════════════════════════════════════════════════ */
export default async function TeamsPage() {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()

  const { data: membership } = await supabase
    .from('members')
    .select('org_id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const orgId = membership?.org_id ?? ''

  const [
    { data: teams    },
    { data: members  },
    { data: limits   },
    { data: projects },
  ] = await Promise.all([
    supabase.from('teams').select('id,name,project_id,created_at').eq('org_id', orgId).order('created_at', { ascending: true }),
    supabase.from('members').select('id,user_id,team_id,role,created_at').eq('org_id', orgId),
    supabase.from('limits').select('team_id,budget_usd,warn_at,throttle_at').eq('org_id', orgId).eq('scope', 'team'),
    supabase.from('projects').select('id,name,slug').eq('org_id', orgId).order('created_at', { ascending: false }),
  ])

  /* ── Fetch user display info via service role ── */
  const { data: authData } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const userMap = new Map(
    (authData?.users ?? []).map(u => [
      u.id,
      {
        email: u.email ?? '',
        name:  (u.user_metadata?.full_name as string | undefined)
               ?? u.email?.split('@')[0]
               ?? 'Unknown',
      },
    ])
  )

  /* ── Aggregate limits ── */
  const limitMap: Record<string, { budget: number; warnAt: number; throttleAt: number }> = {}
  for (const l of limits ?? []) {
    if (l.team_id) limitMap[l.team_id] = { budget: l.budget_usd, warnAt: l.warn_at, throttleAt: l.throttle_at }
  }

  /* ── Member counts per team ── */
  const memberCountMap: Record<string, number> = {}
  for (const m of members ?? []) {
    if (m.team_id) memberCountMap[m.team_id] = (memberCountMap[m.team_id] ?? 0) + 1
  }

  /* ── Shape data ── */
  const enrichedTeams: TeamRow[] = (teams ?? []).map(t => ({
    id:          t.id,
    name:        t.name,
    projectId:   t.project_id,
    createdAt:   t.created_at,
    budget:      limitMap[t.id]?.budget     ?? null,
    warnAt:      limitMap[t.id]?.warnAt     ?? 70,
    throttleAt:  limitMap[t.id]?.throttleAt ?? 90,
    memberCount: memberCountMap[t.id]       ?? 0,
  }))

  const enrichedMembers: MemberRow[] = (members ?? []).map(m => ({
    id:        m.id,
    userId:    m.user_id,
    teamId:    m.team_id,
    role:      m.role,
    createdAt: m.created_at,
    name:      userMap.get(m.user_id)?.name  ?? 'Unknown',
    email:     userMap.get(m.user_id)?.email ?? '',
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
