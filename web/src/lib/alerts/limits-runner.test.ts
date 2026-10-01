/**
 * runOrgLimits against an in-memory fake Supabase: once-per-period claims
 * (limit_events unique key), notification rows, email, the switch_model route
 * and the queued agent change.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
const db: { tables: Record<string, Row[]>; usage: Row[] } = { tables: {}, usage: [] }
const sent: { to: string[]; subject: string }[] = []

vi.mock('@/lib/audit', () => ({ audit: vi.fn(async () => {}) }))
vi.mock('@/lib/org-timezone', () => ({ getOrgTimezone: async () => 'UTC' }))
vi.mock('./email', () => ({ sendAlertEmail: vi.fn(async (to: string[], subject: string) => { sent.push({ to, subject }); return { sent: true, via: 'mailpit' } }) }))

let seq = 0
function q(table: string) {
  const f: ((r: Row) => boolean)[] = []
  let op: 'select' | 'insert' | 'update' | 'upsert' = 'select'
  let payload: Row | Row[] | null = null
  let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {}
  const rows = () => (db.tables[table] ??= [])
  const run = (): Row[] => {
    if (op === 'insert' || op === 'upsert') {
      const list = (Array.isArray(payload) ? payload : [payload!]).map(r => ({ id: `id${++seq}`, ...r }) as Row)
      const out: Row[] = []
      for (const r of list) {
        if (op === 'upsert' && upsertOpts.onConflict) {
          const keys = upsertOpts.onConflict.split(',')
          if (rows().some(x => keys.every(k => x[k] === r[k]))) continue
        }
        rows().push(r); out.push(r)
      }
      return out
    }
    const hit = rows().filter(r => f.every(fn => fn(r)))
    if (op === 'update') hit.forEach(r => Object.assign(r, payload))
    return hit
  }
  const b: Record<string, unknown> = {
    select: () => b, order: () => b, limit: () => b,
    eq: (k: string, v: unknown) => { f.push(r => r[k] === v); return b },
    in: (k: string, v: unknown[]) => { f.push(r => v.includes(r[k])); return b },
    insert: (p: Row | Row[]) => { op = 'insert'; payload = p; return b },
    update: (p: Row) => { op = 'update'; payload = p; return b },
    upsert: (p: Row, o: typeof upsertOpts) => { op = 'upsert'; payload = p; upsertOpts = o ?? {}; return b },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    single: async () => { const r = run()[0]; return { data: r ?? null, error: r ? null : { message: 'none' } } },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => { const d = run(); return Promise.resolve({ data: d, error: null, count: d.length }).then(res, rej) },
  }
  return b
}
const admin = {
  from: (t: string) => q(t),
  rpc: async (name: string) => ({ data: name === 'limit_usage_rows' ? db.usage : null, error: null }),
  auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@x.test` } } }) } },
}

import { runOrgLimits } from './limits-runner'

const NOW = new Date('2026-09-30T12:00:00Z')
const usage = (cost: number): Row => ({ day: '2026-09-30', model: 'claude-opus-4-8', project_id: 'p1', user_key: 'owner', cost_basis: 'notional', requests: 3, total_tokens: 900, cost_usd: cost })

beforeEach(() => {
  seq = 0; sent.length = 0
  db.tables = {
    limits: [{ id: 'L1', org_id: 'O', scope: 'org', period: 'weekly', model: 'claude-opus', metric: 'cost_usd', value: 10, budget_usd: 0,
      basis: 'all', notify_at: 90, notify_channels: { inapp: true, email: true }, auto_action: 'switch_model',
      switch_to: 'claude-sonnet-4-6', auto_action_at: 100, is_active: true }],
    members: [{ org_id: 'O', user_id: 'owner', role: 'owner', team_id: null }, { org_id: 'O', user_id: 'dev', role: 'member', team_id: null }],
    projects: [], teams: [], user_preferences: [], notifications: [], limit_events: [], model_routes: [],
    agent_devices: [{ id: 'D1', org_id: 'O', user_id: 'dev', hostname: 'laptop' }],
    agent_configs: [{ org_id: 'O', device_ref: 'D1', agent: 'claude_code', config: { settings: { model: 'opus' } } }],
    agent_config_changes: [],
  }
})

describe('runOrgLimits', () => {
  it('below notify_at: nothing fires', async () => {
    db.usage = [usage(5)]
    const r = await runOrgLimits(admin as never, 'O', { now: NOW })
    expect(r).toMatchObject({ limits: 1, notified: 0, actions: 0 })
    expect(db.tables.notifications).toHaveLength(0)
  })

  it('at 90%: one in-app row for the owner + one email, once per period', async () => {
    db.usage = [usage(9.3)]
    const r1 = await runOrgLimits(admin as never, 'O', { now: NOW })
    expect(r1.notified).toBe(1)
    expect(db.tables.notifications.map(n => n.user_id)).toEqual(['owner'])   // owners/admins only
    expect(sent).toEqual([{ to: ['owner@x.test'], subject: "TokenFin: claude-opus spend at 93% of this week's limit" }])
    const r2 = await runOrgLimits(admin as never, 'O', { now: NOW })
    expect(r2.notified).toBe(0)
    expect(db.tables.notifications).toHaveLength(1)
    expect(db.tables.limit_events).toHaveLength(1)
    expect(db.tables.limit_events[0]).toMatchObject({ limit_id: 'L1', period_key: 'w2026-09-28', level: 'notify' })
    // next week is a new period → fires again
    db.usage = [{ ...usage(9.3), day: '2026-10-06' }]
    const r3 = await runOrgLimits(admin as never, 'O', { now: new Date('2026-10-06T12:00:00Z') })
    expect(r3.notified).toBe(1)
  })

  it('at 100% with switch_model: prefix route activated, agents queued, everyone told, once', async () => {
    db.usage = [usage(10.5)]
    const r = await runOrgLimits(admin as never, 'O', { now: NOW })
    expect(r).toMatchObject({ notified: 1, actions: 1 })
    const routes = db.tables.model_routes
    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({ from_model: 'claude-opus', to_model: 'claude-sonnet-4-6', match: 'prefix', origin: 'auto', limit_id: 'L1', is_active: true })
    expect(db.tables.agent_config_changes).toHaveLength(1)
    expect(db.tables.agent_config_changes[0]).toMatchObject({ device_ref: 'D1', agent: 'claude_code', patch: { model: 'claude-sonnet-4-6' }, status: 'pending' })
    // action notification reaches every member in-app
    const actionRows = db.tables.notifications.filter(n => n.type === 'alert')
    expect(actionRows.map(n => n.user_id).sort()).toEqual(['dev', 'owner'])
    const again = await runOrgLimits(admin as never, 'O', { now: NOW })
    expect(again).toMatchObject({ notified: 0, actions: 0 })
    expect(db.tables.model_routes).toHaveLength(1)
  })

  it('email channel off / notify off are respected', async () => {
    db.tables.limits[0].notify_channels = { inapp: true, email: false }
    db.tables.limits[0].auto_action = 'none'
    db.usage = [usage(9.5)]
    await runOrgLimits(admin as never, 'O', { now: NOW })
    expect(sent).toHaveLength(0)
    expect(db.tables.notifications).toHaveLength(1)
    db.tables.limits[0].notify_at = null
    db.tables.limit_events = []; db.tables.notifications = []
    const r = await runOrgLimits(admin as never, 'O', { now: NOW })
    expect(r.limits).toBe(0)
  })
})
