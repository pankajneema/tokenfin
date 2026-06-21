import { createClient }       from '@/lib/supabase/server'
import { createAdminClient }  from '@/lib/supabase/server'
import { KeysClient }          from './_client'

export const metadata = { title: 'API Keys — TokenFin' }

/* ── Types ─────────────────────────────────────────────────── */
export interface ApiKeyRow {
  id:            string
  name:          string
  keyPrefix:     string
  env:           'production' | 'staging' | 'development'
  scopes:        string[]
  projectId:     string
  projectName:   string
  expiresAt:     string | null
  isActive:      boolean
  lastUsedAt:    string | null
  createdAt:     string
  createdByName: string
}

export interface ProjectOption {
  id:   string
  name: string
}

/* ── Server page ─────────────────────────────────────────────── */
export default async function KeysPage() {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: membership } = await supabase
    .from('members')
    .select('org_id')
    .eq('user_id', user.id)
    .maybeSingle()

  const orgId = membership?.org_id ?? ''

  const [
    { data: rawKeys },
    { data: projects },
    { data: authData },
  ] = await Promise.all([
    admin
      .from('api_keys')
      .select('id, name, key_prefix, env, scopes, expires_at, is_active, last_used_at, created_at, created_by, project_id, projects(name)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    supabase
      .from('projects')
      .select('id, name')
      .eq('org_id', orgId)
      .order('name'),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ])

  // Build user display name map
  const userMap = new Map(
    (authData?.users ?? []).map(u => [
      u.id,
      (u.user_metadata?.full_name as string | undefined) ?? u.email?.split('@')[0] ?? 'Unknown',
    ])
  )

  const keys: ApiKeyRow[] = (rawKeys ?? []).map(k => {
    const proj = k.projects as unknown as { name: string } | null
    return {
      id:            k.id,
      name:          k.name,
      keyPrefix:     k.key_prefix,
      env:           (k.env ?? 'production') as ApiKeyRow['env'],
      scopes:        (k.scopes ?? ['read', 'write']) as string[],
      projectId:     k.project_id,
      projectName:   proj?.name ?? '—',
      expiresAt:     k.expires_at ?? null,
      isActive:      k.is_active,
      lastUsedAt:    k.last_used_at ?? null,
      createdAt:     k.created_at,
      createdByName: k.created_by ? (userMap.get(k.created_by) ?? 'Unknown') : 'Unknown',
    }
  })

  const projectOptions: ProjectOption[] = (projects ?? []).map(p => ({ id: p.id, name: p.name }))

  return (
    <KeysClient
      initialKeys={keys}
      projects={projectOptions}
      orgId={orgId}
      userId={user.id}
    />
  )
}
