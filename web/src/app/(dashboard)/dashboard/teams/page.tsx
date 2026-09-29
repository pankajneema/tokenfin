import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext } from '@/lib/org-context'
import { dashBreakdown }     from '@/lib/rollups'
import { resolveWindow }     from '@/lib/rollup-scope'
import { TeamsClient }        from './_client'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { PRODUCTIVITY_COLUMNS, type ProductivityRow } from '@/components/dashboard/productivity-card'

export const metadata = { title: 'Teams — TokenFin' }
export const dynamic = 'force-dynamic'
export const revalidate = 0

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

/** Per-member engineering impact over the last 30 days (keyed by user_id). */
export interface MemberImpact {
  linesAdded: number
  commits:    number
  prs:        number
  cost:       number
}

export interface ProjectRow {
  id:   string
  name: string
  slug: string
}

export interface InviteRow {
  id:        string
  email:     string
  role:      string
  status:    string
  expiresAt: string
  createdAt: string
}

/* ═══════════════════════════════════════════════════════════════ */
export default async function TeamsPage() {
  const ctx   = await requireOrgContext()
  const admin = createAdminClient()
  const orgId = ctx.orgId
  const win   = resolveWindow(undefined, ctx.timezone, { defaultDays: 30 })

  const [
    { data: teams       },
    { data: members     },
    { data: limits      },
    { data: projects    },
    { data: invitations },
  ] = await Promise.all([
    admin.from('teams').select('id,name,project_id,created_at').eq('org_id', orgId).order('created_at', { ascending: true }),
    admin.from('members').select('id,user_id,team_id,role,created_at').eq('org_id', orgId),
    admin.from('limits').select('team_id,budget_usd,warn_at,throttle_at').eq('org_id', orgId).eq('scope', 'team'),
    admin.from('projects').select('id,name,slug').eq('org_id', orgId).order('created_at', { ascending: false }),
    admin.from('invitations').select('id,email,role,status,expires_at,created_at').eq('org_id', orgId).order('created_at', { ascending: false }),
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

  /* ── Per-member impact (last 30 days): productivity_daily + rollup cost ──
   * Match on user_id when present, else user_key / email ↔ auth email. */
  const orgUserIds = new Set((members ?? []).map(m => m.user_id as string))
  const emailToUid = new Map<string, string>()
  for (const [uid, u] of Array.from(userMap.entries())) if (orgUserIds.has(uid) && u.email) emailToUid.set(u.email.toLowerCase(), uid)
  const resolve = (uid: string | null, email: string | null) =>
    (uid && orgUserIds.has(uid) ? uid : null) ?? emailToUid.get((email ?? '').trim().toLowerCase()) ?? null

  const [prodRows, byMember] = await Promise.all([
    fetchAllRows<ProductivityRow>((from, to) => admin.from('productivity_daily')
      .select(PRODUCTIVITY_COLUMNS).eq('org_id', orgId).gte('day', win.from).lte('day', win.to)
      .order('day').order('user_key').order('repo').range(from, to)).catch(() => [] as ProductivityRow[]),
    // rollup key = lower(email) else user id
    dashBreakdown(admin, orgId, win.from, win.to, 'member', undefined, 1000),
  ])
  const impact: Record<string, MemberImpact> = {}
  const slot = (uid: string) => (impact[uid] ??= { linesAdded: 0, commits: 0, prs: 0, cost: 0 })
  for (const r of prodRows) {
    const uid = resolve(r.user_id, r.user_key)
    if (!uid) continue
    const e = slot(uid)
    e.linesAdded += Number(r.lines_added ?? 0); e.commits += Number(r.commits ?? 0); e.prs += Number(r.pull_requests ?? 0)
  }
  for (const r of byMember.rows) {
    const uid = resolve(r.key, r.key)
    if (uid) slot(uid).cost += r.cost_usd
  }

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

  const enrichedInvites: InviteRow[] = (invitations ?? []).map(i => ({
    id:        i.id,
    email:     i.email,
    role:      i.role,
    status:    i.status,
    expiresAt: i.expires_at,
    createdAt: i.created_at,
  }))

  return (
    <TeamsClient
      teams={enrichedTeams}
      members={enrichedMembers}
      projects={(projects ?? []) as ProjectRow[]}
      invites={enrichedInvites}
      orgId={orgId}
      impact={impact}
    />
  )
}
