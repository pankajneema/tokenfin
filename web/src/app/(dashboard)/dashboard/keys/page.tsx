import { createClient }       from '@/lib/supabase/server'
import { createAdminClient }  from '@/lib/supabase/server'
import { getOrgRole }          from '@/lib/api/auth'
import { can }                 from '@/lib/rbac'
import { redirect }            from 'next/navigation'
import { KeysClient }          from './_client'

export const metadata = { title: 'API Keys — TokenFin' }

/* ── Types ─────────────────────────────────────────────────── */
export interface ApiKeyRow {
  id:               string
  name:             string
  keyPrefix:        string
  env:              'production' | 'staging' | 'development'
  scopes:           string[]
  projectId:        string
  projectName:      string
  expiresAt:        string | null
  isActive:         boolean
  lastUsedAt:       string | null
  createdAt:        string
  createdByName:    string
  assignedToId:     string | null
  assignedToName:   string | null
  assignedTeamId:   string | null
  assignedTeamName: string | null
  requests30d:      number
  cost30d:          number
}

export interface ProjectOption {
  id:   string
  name: string
}

export interface TeamOption {
  id:   string
  name: string
}

export interface MemberOption {
  id:     string  // auth user_id
  name:   string
  teamId: string | null
}

/* ── Server page ─────────────────────────────────────────────── */
export default async function KeysPage() {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: _mb } = await admin
    .from('members')
    .select('org_id')
    .eq('user_id', user!.id)
    .limit(1)

  const orgId = _mb?.[0]?.org_id ?? ''
  const role  = await getOrgRole(user.id, orgId)

  // Only owner/admin can access the keys page
  if (!can(role, 'keys:view')) redirect('/dashboard')
  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString()

  const [
    { data: rawKeys  },
    { data: projects },
    { data: authData },
    { data: usage    },
    { data: orgMembers },
    { data: teams    },
  ] = await Promise.all([
    admin
      .from('api_keys')
      .select('id, name, key_prefix, env, scopes, expires_at, is_active, last_used_at, created_at, created_by, user_id, team_id, project_id, projects(name)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    admin
      .from('projects')
      .select('id, name')
      .eq('org_id', orgId)
      .order('name'),
    admin.auth.admin.listUsers({ perPage: 1000 }),
    admin
      .from('usage_events')
      .select('project_id, cost_usd')
      .eq('org_id', orgId)
      .gte('created_at', since30),
    admin
      .from('members')
      .select('user_id, team_id')
      .eq('org_id', orgId),
    admin
      .from('teams')
      .select('id, name')
      .eq('org_id', orgId)
      .order('name'),
  ])

  /* ── Per-project usage map ── */
  const usageMap: Record<string, { reqs: number; cost: number }> = {}
  for (const e of usage ?? []) {
    if (!usageMap[e.project_id]) usageMap[e.project_id] = { reqs: 0, cost: 0 }
    usageMap[e.project_id].reqs++
    usageMap[e.project_id].cost += e.cost_usd ?? 0
  }

  /* ── User display name map ── */
  const userMap = new Map(
    (authData?.users ?? []).map(u => [
      u.id,
      (u.user_metadata?.full_name as string | undefined) ?? u.email?.split('@')[0] ?? 'Unknown',
    ])
  )

  /* ── Team name map ── */
  const teamMap = new Map((teams ?? []).map(t => [t.id, t.name]))

  const keys: ApiKeyRow[] = (rawKeys ?? []).map(k => {
    const proj   = k.projects as unknown as { name: string } | null
    const u      = usageMap[k.project_id] ?? { reqs: 0, cost: 0 }
    const uid    = (k as Record<string, unknown>).user_id  as string | null ?? null
    const tid    = (k as Record<string, unknown>).team_id  as string | null ?? null
    return {
      id:               k.id,
      name:             k.name,
      keyPrefix:        k.key_prefix,
      env:              (k.env ?? 'production') as ApiKeyRow['env'],
      scopes:           (k.scopes ?? ['read', 'write']) as string[],
      projectId:        k.project_id,
      projectName:      proj?.name ?? '—',
      expiresAt:        k.expires_at ?? null,
      isActive:         k.is_active,
      lastUsedAt:       k.last_used_at ?? null,
      createdAt:        k.created_at,
      createdByName:    k.created_by ? (userMap.get(k.created_by) ?? 'Unknown') : 'Unknown',
      assignedToId:     uid,
      assignedToName:   uid ? (userMap.get(uid) ?? null) : null,
      assignedTeamId:   tid,
      assignedTeamName: tid ? (teamMap.get(tid) ?? null) : null,
      requests30d:      u.reqs,
      cost30d:          u.cost,
    }
  })

  const projectOptions: ProjectOption[] = (projects ?? []).map(p => ({ id: p.id, name: p.name }))
  const teamOptions:    TeamOption[]    = (teams    ?? []).map(t => ({ id: t.id, name: t.name }))

  // Build member list — include team_id for filtering in the modal
  const memberOptions: MemberOption[] = (orgMembers ?? [])
    .filter(m => userMap.has(m.user_id))
    .map(m => ({
      id:     m.user_id,
      name:   userMap.get(m.user_id) ?? m.user_id.slice(0, 8),
      teamId: (m as Record<string, unknown>).team_id as string | null ?? null,
    }))

  return (
    <KeysClient
      initialKeys={keys}
      projects={projectOptions}
      teams={teamOptions}
      members={memberOptions}
      orgId={orgId}
      userId={user.id}
      role={role}
    />
  )
}
