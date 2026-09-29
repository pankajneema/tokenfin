import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgRole } from '@/lib/api/auth'
import { fetchAllPages, fetchAllRows } from '@/lib/supabase/paginate'
import { getOrgTimezone } from '@/lib/org-timezone'
import { toZonedDate } from '@/lib/dates'
import { loadMemberTeams, loadRuleRows, toRules } from '@/lib/allocation/load'
import { referencedTagKeys } from '@/lib/allocation/apply'
import { localMidnightUtc, monthBounds } from '@/lib/focus/time'
import type { DimsRow } from '@/lib/focus/aggregate'
import { AllocationClient } from './_client'
import type { PreviewRow } from './_types'

export const metadata = { title: 'Cost allocation — TokenFin' }
export const dynamic = 'force-dynamic'

const PREVIEW_CAP = 20_000

export default async function AllocationPage() {
  const supabase = createClient()
  const admin    = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: membership } = await admin
    .from('members').select('org_id').eq('user_id', user.id).order('joined_at', { ascending: true }).limit(1)
  const orgId = membership?.[0]?.org_id as string | undefined
  if (!orgId) return null

  const [role, tz, ruleRows, memberTeam, projects, teams] = await Promise.all([
    getOrgRole(user.id, orgId),
    getOrgTimezone(orgId),
    loadRuleRows(admin, orgId),
    loadMemberTeams(admin, orgId),
    fetchAllRows<{ id: string; name: string }>((a, b) => admin.from('projects').select('id, name').eq('org_id', orgId).order('id').range(a, b)).catch(() => []),
    fetchAllRows<{ id: string; name: string }>((a, b) => admin.from('teams').select('id, name').eq('org_id', orgId).order('id').range(a, b)).catch(() => []),
  ])

  // Preview window: the previous calendar month in the workspace zone.
  const thisMonth = monthBounds(toZonedDate(Date.now(), tz)).start
  const [y, m] = thisMonth.split('-').map(Number)
  const prevStart = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`
  const { data: dims, error } = await fetchAllPages<DimsRow>((a, b) =>
    admin.rpc('finops_usage_dims', {
      p_org: orgId, p_from: localMidnightUtc(prevStart, tz), p_to: localMidnightUtc(thisMonth, tz),
      p_tz: tz, p_tag_keys: referencedTagKeys(toRules(ruleRows)), p_by_day: false,
    }).range(a, b), 1000, PREVIEW_CAP)
  if (error && dims.length === 0) console.error('[allocation] preview query failed:', error)

  const preview: PreviewRow[] = dims.map(d => ({
    project_id: d.project_id, source: d.source, model: d.model, cost_basis: d.cost_basis,
    user_id: d.user_id, user_email: d.user_email, repo: d.repo, tags: d.tag_values ?? {},
    member_team: d.user_id ? memberTeam.get(d.user_id) ?? null : null,
    cost: Number(d.cost_usd ?? 0), tokens: Number(d.total_tokens ?? 0),
  }))

  return (
    <AllocationClient
      orgId={orgId}
      canEdit={role === 'owner' || role === 'admin'}
      initialRules={ruleRows}
      projects={projects}
      teamNames={teams.map(t => t.name).sort()}
      preview={preview}
      previewMonth={prevStart.slice(0, 7)}
      previewTruncated={dims.length >= PREVIEW_CAP}
    />
  )
}
