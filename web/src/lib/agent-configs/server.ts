/**
 * Agent-config data access (server-only: service-role client). Used by
 * /api/v1/agent-configs/** and the /dashboard/agents page.
 *
 * Access model:
 *   • owners / admins see and change every device in the org;
 *   • members see and change only devices synced with their OWN keys;
 *   • viewers see their own devices (read-only);
 *   • devices synced with a shared org-level key (user_id NULL) are admin-only.
 * The CLI (device key) only ever touches the device its key belongs to.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { lookupApiKey } from '@/lib/api/auth'
import type { NextRequest } from 'next/server'
import { can, type Role } from '@/lib/rbac'
import { AGENT_IDS, DEVICE_ID_RE, isAgentId, type AgentId } from './agents'
import { redactConfig } from './redact'
import { summarize, type AgentSummary, type SummaryContext } from './summary'

// ── Device-key auth (CLI) ─────────────────────────────────────────────────────

export interface DeviceCaller {
  orgId:     string
  /** Key owner for personal keys; null for shared org-level keys. */
  userId:    string | null
  keyId:     string
  /** api_keys.device_id — when set, the caller may only act as this device. */
  keyDevice: string | null
}

/** Any active key (ingest or read) of the org. 'none' | 'invalid' → 401. */
export async function deviceCaller(req: NextRequest): Promise<DeviceCaller | 'none' | 'invalid'> {
  const r = await lookupApiKey(req)
  if (r.status !== 'ok') return r.status
  const { data } = await createAdminClient().from('api_keys').select('device_id').eq('id', r.key.keyId).maybeSingle()
  return {
    orgId: r.key.orgId,
    userId: r.key.personal ? r.key.userId : null,
    keyId: r.key.keyId,
    keyDevice: ((data as { device_id?: string | null } | null)?.device_id) ?? null,
  }
}

// ── Push payload validation ──────────────────────────────────────────────────

export interface PushAgent { agent: AgentId; version: string | null; path: string | null; mtime: string | null; config: unknown; sha256: string | null; needs_restart_since: string | null }
export interface PushBody { device_id: string; hostname: string | null; os: string | null; cli_version: string | null; agents: PushAgent[] }

const MAX_CONFIG_BYTES = 256 * 1024
const s = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

export function parsePushBody(body: unknown): { ok: true; value: PushBody } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const device_id = typeof b.device_id === 'string' ? b.device_id : ''
  if (!DEVICE_ID_RE.test(device_id)) return { ok: false, error: 'device_id must be 8-64 chars of [A-Za-z0-9-]' }
  if (!Array.isArray(b.agents)) return { ok: false, error: 'agents must be an array' }
  if (b.agents.length > AGENT_IDS.length) return { ok: false, error: 'too many agents' }
  const seen = new Set<string>()
  const agents: PushAgent[] = []
  for (const raw of b.agents) {
    const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    if (!isAgentId(a.agent)) return { ok: false, error: `unknown agent ${String(a.agent)}` }
    if (seen.has(a.agent)) return { ok: false, error: `duplicate agent ${a.agent}` }
    seen.add(a.agent)
    const cfg = a.config && typeof a.config === 'object' && !Array.isArray(a.config) ? a.config : {}
    if (JSON.stringify(cfg).length > MAX_CONFIG_BYTES) return { ok: false, error: `${a.agent} config exceeds 256 KB` }
    const mtime = typeof a.mtime === 'string' && !Number.isNaN(Date.parse(a.mtime)) ? new Date(a.mtime).toISOString() : null
    const sha = typeof a.sha256 === 'string' && /^[0-9a-f]{64}$/.test(a.sha256) ? a.sha256 : null
    const nr = typeof a.needs_restart_since === 'string' && !Number.isNaN(Date.parse(a.needs_restart_since)) ? new Date(a.needs_restart_since).toISOString() : null
    agents.push({ agent: a.agent, version: s(a.version, 80), path: s(a.path, 500), mtime, config: redactConfig(cfg), sha256: sha, needs_restart_since: nr })
  }
  return { ok: true, value: { device_id, hostname: s(b.hostname, 255), os: s(b.os, 100), cli_version: s(b.cli_version, 40), agents } }
}

export async function pushSnapshot(caller: DeviceCaller, body: PushBody): Promise<{ device_ref: string; pending: number }> {
  const { data, error } = await createAdminClient().rpc('agent_config_push', {
    p_org: caller.orgId, p_user: caller.userId, p_device: body.device_id,
    p_hostname: body.hostname, p_os: body.os, p_cli: body.cli_version, p_agents: body.agents,
  })
  if (error) throw error
  return data as { device_ref: string; pending: number }
}

/** The caller's device row (null when it never pushed). */
export async function callerDevice(caller: DeviceCaller, deviceId: string) {
  let q = createAdminClient().from('agent_devices').select('id, org_id, user_id, device_id')
    .eq('org_id', caller.orgId).eq('device_id', deviceId)
  q = caller.userId ? q.eq('user_id', caller.userId) : q.is('user_id', null)
  const { data } = await q.maybeSingle()
  return data as { id: string; org_id: string; user_id: string | null; device_id: string } | null
}

// ── Session-side access ──────────────────────────────────────────────────────

export interface DeviceRow { id: string; org_id: string; user_id: string | null; device_id: string; hostname: string | null; os: string | null; cli_version: string | null; first_seen_at: string; last_synced_at: string }

/** May `role`/`userId` see this device? `write` = may request changes. */
export function canAccessDevice(dev: { user_id: string | null }, role: Role, userId: string, write = false): boolean {
  if (can(role, 'prompts:view_all')) return true                    // owner / admin
  if (write && role === 'viewer') return false
  return !!dev.user_id && dev.user_id === userId
}

export async function getDevice(orgId: string, ref: string): Promise<DeviceRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(ref)) return null
  const { data } = await createAdminClient().from('agent_devices')
    .select('id, org_id, user_id, device_id, hostname, os, cli_version, first_seen_at, last_synced_at')
    .eq('id', ref).eq('org_id', orgId).maybeSingle()
  return (data as DeviceRow | null) ?? null
}

// ── The Agents view ──────────────────────────────────────────────────────────

export interface ChangeRow {
  id: string; device_ref: string; agent: AgentId; patch: Record<string, unknown>; reason: string | null
  requested_by: string | null; requested_by_email: string | null; status: 'pending' | 'applied' | 'failed' | 'cancelled'
  error: string | null; created_at: string; updated_at: string; applied_at: string | null
}
export interface AgentView {
  agent: AgentId; version: string | null; path: string | null; mtime: string | null
  syncedAt: string; changedAt: string; sha256: string | null; config: unknown
  summary: AgentSummary
  lastEventAt: string | null; tokensToday: number; flowing: boolean
  /** Set when a change was applied while an older agent process is still running. */
  needsRestartSince: string | null
}
export interface DeviceView {
  ref: string; deviceId: string; hostname: string | null; os: string | null; cliVersion: string | null
  firstSeenAt: string; lastSyncedAt: string; agents: AgentView[]; changes: ChangeRow[]; canEdit: boolean
}
export interface PersonView { userId: string | null; email: string; name: string; role: string; devices: DeviceView[] }

const FLOWING_MS = 24 * 3600_000

export async function loadAgentsView(
  orgId: string, viewer: { userId: string; role: Role }, ctx: SummaryContext, sinceIso: string,
): Promise<PersonView[]> {
  const admin = createAdminClient()
  const scope = can(viewer.role, 'prompts:view_all') ? null : viewer.userId

  let dq = admin.from('agent_devices')
    .select('id, org_id, user_id, device_id, hostname, os, cli_version, first_seen_at, last_synced_at')
    .eq('org_id', orgId).order('last_synced_at', { ascending: false }).limit(500)
  if (scope) dq = dq.eq('user_id', scope)
  const { data: devs } = await dq
  const devices = (devs ?? []) as DeviceRow[]
  const refs = devices.map(d => d.id)

  const [{ data: cfgs }, { data: chg }, { data: members }, { data: keys }] = await Promise.all([
    refs.length ? admin.from('agent_configs').select('device_ref, agent, version, path, mtime, config, sha256, synced_at, changed_at, needs_restart_since').in('device_ref', refs) : Promise.resolve({ data: [] as unknown[] }),
    refs.length ? admin.from('agent_config_changes').select('id, device_ref, agent, patch, reason, requested_by, requested_by_email, status, error, created_at, updated_at, applied_at')
      .in('device_ref', refs).order('created_at', { ascending: false }).limit(300) : Promise.resolve({ data: [] as unknown[] }),
    scope ? admin.from('members').select('user_id, role').eq('org_id', orgId).eq('user_id', scope)
          : admin.from('members').select('user_id, role').eq('org_id', orgId),
    refs.length ? admin.from('api_keys').select('id, user_id, device_id').eq('org_id', orgId).in('device_id', Array.from(new Set(devices.map(d => d.device_id))))
                : Promise.resolve({ data: [] as unknown[] }),
  ])

  // Telemetry per device: events sent with that device's keys (fallback: the owner's events).
  const telemetry = new Map<string, Map<string, { last: string | null; tokens: number }>>()
  await Promise.all(devices.map(async d => {
    const keyIds = ((keys ?? []) as { id: string; user_id: string | null; device_id: string | null }[])
      .filter(k => k.device_id === d.device_id && (k.user_id ?? null) === (d.user_id ?? null)).map(k => k.id)
    if (!keyIds.length && !d.user_id) return
    const { data } = await admin.rpc('tf_connection_sources', {
      p_org: orgId, p_since: sinceIso, p_user: keyIds.length ? null : d.user_id, p_key_ids: keyIds.length ? keyIds : null, p_source: null,
    })
    telemetry.set(d.id, new Map(((data ?? []) as { source: string; last_event_at: string | null; tokens_today: number }[])
      .map(r => [r.source, { last: r.last_event_at, tokens: Number(r.tokens_today ?? 0) }])))
  }))

  const byDevice = new Map<string, AgentView[]>()
  for (const r of (cfgs ?? []) as Record<string, unknown>[]) {
    const agent = r.agent as AgentId
    const t = telemetry.get(r.device_ref as string)?.get(agent)
    const view: AgentView = {
      agent, version: (r.version as string | null) ?? null, path: (r.path as string | null) ?? null, mtime: (r.mtime as string | null) ?? null,
      syncedAt: r.synced_at as string, changedAt: r.changed_at as string, sha256: (r.sha256 as string | null) ?? null,
      config: r.config, summary: summarize(agent, r.config, ctx),
      lastEventAt: t?.last ?? null, tokensToday: t?.tokens ?? 0,
      flowing: !!t?.last && Date.now() - Date.parse(t.last) < FLOWING_MS,
      needsRestartSince: (r.needs_restart_since as string | null) ?? null,
    }
    const list = byDevice.get(r.device_ref as string) ?? []
    list.push(view)
    byDevice.set(r.device_ref as string, list)
  }
  const changesBy = new Map<string, ChangeRow[]>()
  for (const c of (chg ?? []) as ChangeRow[]) {
    const list = changesBy.get(c.device_ref) ?? []
    list.push(c)
    changesBy.set(c.device_ref, list)
  }

  const roleOf = new Map(((members ?? []) as { user_id: string; role: string }[]).map(m => [m.user_id, m.role]))
  const userIds = Array.from(new Set([...roleOf.keys(), ...devices.map(d => d.user_id).filter((u): u is string => !!u)]))
  const users = new Map(await Promise.all(userIds.map(async id => {
    const { data } = await admin.auth.admin.getUserById(id)
    return [id, data?.user ?? null] as const
  })))

  const people = new Map<string, PersonView>()
  const personFor = (uid: string | null): PersonView => {
    const k = uid ?? 'shared'
    let p = people.get(k)
    if (!p) {
      const u = uid ? users.get(uid) : null
      const email = u?.email ?? (uid ? 'former member' : 'Shared org key')
      const meta = (u?.user_metadata ?? {}) as Record<string, unknown>
      p = {
        userId: uid, email,
        name: (typeof meta.full_name === 'string' && meta.full_name) || (typeof meta.name === 'string' && meta.name) || (uid ? email.split('@')[0] : 'Shared org key'),
        role: uid ? roleOf.get(uid) ?? 'former' : 'shared', devices: [],
      }
      people.set(k, p)
    }
    return p
  }
  for (const uid of roleOf.keys()) personFor(uid)
  for (const d of devices) {
    personFor(d.user_id).devices.push({
      ref: d.id, deviceId: d.device_id, hostname: d.hostname, os: d.os, cliVersion: d.cli_version,
      firstSeenAt: d.first_seen_at, lastSyncedAt: d.last_synced_at,
      agents: (byDevice.get(d.id) ?? []).sort((a, b) => AGENT_IDS.indexOf(a.agent) - AGENT_IDS.indexOf(b.agent)),
      changes: changesBy.get(d.id) ?? [],
      canEdit: canAccessDevice(d, viewer.role, viewer.userId, true),
    })
  }
  return Array.from(people.values()).sort((a, b) =>
    (a.userId === viewer.userId ? -1 : 0) - (b.userId === viewer.userId ? -1 : 0) ||
    b.devices.length - a.devices.length || a.email.localeCompare(b.email))
}

export interface HistoryRow { id: number; version: string | null; sha256: string | null; config: unknown; captured_at: string }

export async function loadHistory(deviceRef: string, agent: AgentId): Promise<HistoryRow[]> {
  const { data } = await createAdminClient().from('agent_config_history')
    .select('id, version, sha256, config, captured_at').eq('device_ref', deviceRef).eq('agent', agent)
    .order('captured_at', { ascending: false }).limit(10)
  return (data ?? []) as HistoryRow[]
}
