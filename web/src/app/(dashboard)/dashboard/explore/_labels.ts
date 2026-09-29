/**
 * Server-only label lookups for rollup keys (project ids, user keys).
 * Shared by Explore and the member drill-down.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { selectAll } from '@/lib/supabase/paginate'
import { NO_PROJECT_ID } from '@/lib/rollups'
import type { ExploreDim } from '@/lib/explore'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface Labeler {
  projects: Map<string, string>
  label(dim: ExploreDim, key: string): string
  memberLabel(key: string): string
}

export async function loadLabeler(admin: SupabaseClient, orgId: string, memberKeys: readonly string[] = []): Promise<Labeler> {
  const { data: projectRows } = await selectAll<{ id: string; name: string }>(() =>
    admin.from('projects').select('id, name').eq('org_id', orgId))
  const projects = new Map(projectRows.map(p => [p.id, p.name]))

  // user_key falls back to the user id when an event had no email — resolve those.
  const emails = new Map<string, string>()
  const uuidKeys = Array.from(new Set(memberKeys.filter(k => UUID_RE.test(k)))).slice(0, 50)
  await Promise.all(uuidKeys.map(async id => {
    const { data } = await admin.auth.admin.getUserById(id)
    if (data?.user?.email) emails.set(id, data.user.email)
  }))

  const memberLabel = (key: string) => !key ? '(unknown user)' : emails.get(key) ?? (UUID_RE.test(key) ? `user ${key.slice(0, 8)}` : key)

  return {
    projects,
    memberLabel,
    label(dim, key) {
      if (dim === 'project') return key === NO_PROJECT_ID || !key ? '(no project)' : projects.get(key) ?? `project ${key.slice(0, 8)}`
      if (dim === 'member') return memberLabel(key)
      if (dim === 'cost_basis') return key === 'notional' ? 'notional (subscription)' : key || '(none)'
      return key || '(none)'
    },
  }
}
