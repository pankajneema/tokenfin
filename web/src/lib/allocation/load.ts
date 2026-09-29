import type { SupabaseClient } from '@supabase/supabase-js'
import { selectAll } from '@/lib/supabase/paginate'
import { normalizeRule, type AllocationRule } from './apply'

/** Server-only loaders for allocation inputs. Pass the service-role client. */

export interface AllocationRuleRow {
  id: string; org_id: string; name: string; kind: string; priority: number
  match: Record<string, unknown>; assign: Record<string, unknown>
  is_active: boolean; created_by: string | null; created_at: string; updated_at: string
}

/** Active + inactive rules for an org (the table is small; bounded at 500). */
export async function loadRuleRows(admin: SupabaseClient, orgId: string): Promise<AllocationRuleRow[]> {
  const { data, error } = await admin.from('allocation_rules')
    .select('id, org_id, name, kind, priority, match, assign, is_active, created_by, created_at, updated_at')
    .eq('org_id', orgId).order('priority', { ascending: true }).order('created_at', { ascending: true })
    .limit(500)
  if (error) {
    // Table missing before migration 014 → behave as "no rules".
    console.error('[allocation] load rules failed:', error.message)
    return []
  }
  return (data ?? []) as AllocationRuleRow[]
}

export function toRules(rows: AllocationRuleRow[]): AllocationRule[] {
  const out: AllocationRule[] = []
  for (const r of rows) {
    const n = normalizeRule(r)
    if (typeof n !== 'string') out.push(n)
  }
  return out
}

export async function loadRules(admin: SupabaseClient, orgId: string): Promise<AllocationRule[]> {
  return toRules(await loadRuleRows(admin, orgId)).filter(r => r.is_active !== false)
}

/** user_id → team name from members.team_id. */
export async function loadMemberTeams(admin: SupabaseClient, orgId: string): Promise<Map<string, string>> {
  const [{ data: members }, { data: teams }] = await Promise.all([
    selectAll<{ user_id: string; team_id: string }>(() =>
      admin.from('members').select('id, user_id, team_id').eq('org_id', orgId).not('team_id', 'is', null)),
    selectAll<{ id: string; name: string }>(() => admin.from('teams').select('id, name').eq('org_id', orgId)),
  ])
  const teamName = new Map(teams.map(t => [t.id, t.name]))
  const out = new Map<string, string>()
  for (const m of members) {
    const n = teamName.get(m.team_id)
    if (n) out.set(m.user_id, n)
  }
  return out
}
