/**
 * Per-member rollout tracker for /dashboard/setup (server-only, admins).
 *
 * For every member (and pending invite): is capture configured, when did
 * their first event land, when were they last seen, and from which source.
 * Events are matched by user_id OR user_email — managed-settings rollouts use
 * one org ingest key, so attribution there comes from Claude Code's
 * user.email. Two indexed LIMIT 1 queries per member (bounded by team size),
 * never an unbounded row scan.
 */
import { createAdminClient } from '@/lib/supabase/server'

export interface RolloutRow {
  userId: string | null
  email: string
  name: string
  role: string
  status: 'invited' | 'no_device' | 'waiting' | 'active' | 'stale'
  devices: number
  firstEventAt: string | null
  lastSeenAt: string | null
  source: string | null
}

const STALE_MS = 7 * 86400_000

export async function getRollout(orgId: string): Promise<RolloutRow[]> {
  const admin = createAdminClient()
  const [{ data: members }, { data: invites }, { data: keys }] = await Promise.all([
    admin.from('members').select('user_id, role').eq('org_id', orgId),
    admin.from('invitations').select('email, status').eq('org_id', orgId).eq('status', 'pending'),
    admin.from('api_keys').select('user_id, device_id').eq('org_id', orgId).eq('is_active', true).not('user_id', 'is', null),
  ])
  // Only this org's members — never list every auth user.
  const users = new Map(await Promise.all((members ?? []).map(async m => {
    const { data } = await admin.auth.admin.getUserById(m.user_id as string)
    return [m.user_id as string, data?.user ?? null] as const
  })))

  const devicesBy = new Map<string, Set<string>>()
  for (const k of keys ?? []) {
    const uid = k.user_id as string
    if (!devicesBy.has(uid)) devicesBy.set(uid, new Set())
    devicesBy.get(uid)!.add((k.device_id as string | null) ?? 'key')
  }

  const eventWindow = async (uid: string, email: string, asc: boolean) => {
    const filter = email ? `user_id.eq.${uid},user_email.eq."${email.replace(/"/g, '')}"` : `user_id.eq.${uid}`
    const { data } = await admin.from('usage_events').select('created_at, source')
      .eq('org_id', orgId).or(filter)
      .order('created_at', { ascending: asc }).limit(1).maybeSingle()
    return data as { created_at: string; source: string | null } | null
  }

  const now = Date.now()
  const rows: RolloutRow[] = await Promise.all((members ?? []).map(async m => {
    const uid = m.user_id as string
    const u = users.get(uid)
    const email = u?.email ?? ''
    const [first, last] = await Promise.all([eventWindow(uid, email, true), eventWindow(uid, email, false)])
    const devices = devicesBy.get(uid)?.size ?? 0
    const lastSeenAt = last?.created_at ?? null
    const status: RolloutRow['status'] = lastSeenAt
      ? (now - Date.parse(lastSeenAt) > STALE_MS ? 'stale' : 'active')
      : devices > 0 ? 'waiting' : 'no_device'
    return {
      userId: uid, email,
      name: (u?.user_metadata?.full_name as string | undefined) ?? (u?.user_metadata?.name as string | undefined) ?? email.split('@')[0] ?? '',
      role: (m.role as string) ?? 'member', status, devices,
      firstEventAt: first?.created_at ?? null, lastSeenAt, source: last?.source ?? null,
    }
  }))

  const memberEmails = new Set(rows.map(r => r.email.toLowerCase()))
  for (const i of invites ?? []) {
    const email = String(i.email ?? '')
    if (!email || memberEmails.has(email.toLowerCase())) continue
    rows.push({ userId: null, email, name: email.split('@')[0], role: 'invited', status: 'invited', devices: 0, firstEventAt: null, lastSeenAt: null, source: null })
  }

  const order = { active: 0, stale: 1, waiting: 2, no_device: 3, invited: 4 } as const
  return rows.sort((a, b) => order[a.status] - order[b.status] || a.email.localeCompare(b.email))
}
