import { describe, it, expect } from 'vitest'
import { parseYaml, YamlError } from './yaml'
import { normalizeBudgets } from './schema'
import { buildPlan, formatPlan, MANAGED_PREFIX, type CurrentAlert, type CurrentLimit } from './plan'

const FILE = `
---
# TokenFin budgets
version: 1
defaults:
  period: monthly
  warn: 70          # percent
  notify: [email, inapp]
budgets:
  - name: Workspace total
    scope: org
    amount_usd: 5000
  - scope: project
    target: payments-api
    amount_usd: 800
    warn: 60
    notify:
      - email
      - slack
  - scope: team
    target: "Search"
    period: weekly
    amount_usd: 1_200
    notify: []
  - scope: member
    period: daily
    amount_usd: 40.5
`

describe('parseYaml', () => {
  it('parses the budgets subset', () => {
    const doc = parseYaml(FILE) as { budgets: Record<string, unknown>[]; defaults: Record<string, unknown> }
    expect(doc.defaults).toEqual({ period: 'monthly', warn: 70, notify: ['email', 'inapp'] })
    expect(doc.budgets).toHaveLength(4)
    expect(doc.budgets[1]).toEqual({ scope: 'project', target: 'payments-api', amount_usd: 800, warn: 60, notify: ['email', 'slack'] })
    expect(doc.budgets[2].amount_usd).toBe(1200)
    expect(doc.budgets[2].notify).toEqual([])
    expect(doc.budgets[3].amount_usd).toBe(40.5)
  })
  it('scalars, quotes, comments, flow maps and sequences at key indent', () => {
    expect(parseYaml(`a: 'it''s # not a comment'\nb: "x\\ny"\nc: ~\nd: true\ne: {k: 1, j: [a, b]}\nf:\n- 1\n- two`)).toEqual({
      a: "it's # not a comment", b: 'x\ny', c: null, d: true, e: { k: 1, j: ['a', 'b'] }, f: [1, 'two'],
    })
    expect(parseYaml('url: http://x.test/a:b')).toEqual({ url: 'http://x.test/a:b' })
    expect(parseYaml('')).toBeNull()
  })
  it('rejects unsupported and malformed input with line numbers', () => {
    expect(() => parseYaml('a: 1\na: 2')).toThrow(/line 2: duplicate key/)
    expect(() => parseYaml('a: |\n  x')).toThrow(YamlError)
    expect(() => parseYaml('a: &x 1')).toThrow(/unsupported/)
    expect(() => parseYaml('a:\n\tb: 1')).toThrow(/tabs/)
    expect(() => parseYaml('a: 1\n  b: 2')).toThrow(/line 2/)
    expect(() => parseYaml('just a string\nanother')).toThrow(/expected "key: value"/)
    expect(() => parseYaml('a: [1, 2')).toThrow(/unterminated/)
  })
})

describe('normalizeBudgets', () => {
  it('applies defaults', () => {
    const n = normalizeBudgets(parseYaml(FILE))
    expect(n.ok).toBe(true)
    if (!n.ok) return
    expect(n.budgets[0]).toMatchObject({ scope: 'org', period: 'monthly', warn: 70, throttle: 90, block: 100, notify: ['email', 'inapp'] })
    expect(n.budgets[2]).toMatchObject({ period: 'weekly', notify: [] })
    expect(n.prune).toBe(false)
  })
  it('reports schema and semantic issues', () => {
    const bad = normalizeBudgets({ budgets: [{ scope: 'project', amount_usd: 5 }, { scope: 'org', amount_usd: 1, warn: 95, throttle: 90 }] })
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.issues.map(i => i.path)).toEqual(['budgets.0.target', 'budgets.1'])
    const bad2 = normalizeBudgets({ budgets: [{ scope: 'org', amount_usd: -1, extra: 1 }] })
    expect(bad2.ok).toBe(false)
  })
})

describe('buildPlan', () => {
  const lookup = {
    projects: [{ id: 'p1', name: 'Payments API', slug: 'payments-api' }],
    teams: [{ id: 't1', name: 'Search' }],
  }
  const desired = () => { const n = normalizeBudgets(parseYaml(FILE)); if (!n.ok) throw new Error('bad'); return n.budgets }
  const lim = (p: Partial<CurrentLimit>): CurrentLimit => ({
    id: 'l', scope: 'org', project_id: null, team_id: null, period: 'monthly', budget_usd: 5000,
    warn_at: 70, throttle_at: 90, block_at: 100, is_active: true, ...p,
  })

  it('creates everything on an empty workspace', () => {
    const p = buildPlan(desired(), { limits: [], alerts: [] }, lookup, false)
    expect(p.ok).toBe(true)
    expect(p.limits.map(c => c.op)).toEqual(['create', 'create', 'create', 'create'])
    // team has notify: [] → no alert; 3 alerts
    expect(p.alerts.filter(a => a.op === 'create')).toHaveLength(3)
    const proj = p.limits[1]
    expect(proj.op === 'create' && proj.after).toMatchObject({ scope: 'project', project_id: 'p1', warn_at: 60, budget_usd: 800 })
    const projAlert = p.alerts.find(a => a.name.includes('Payments API'))!
    expect(projAlert.op === 'create' && projAlert.after).toMatchObject({
      name: `${MANAGED_PREFIX}Payments API monthly budget`, trigger_type: 'limit_breach', project_id: 'p1', threshold: 60, scope: 'Payments API',
      channels: { email: true, slack: true, webhook: false, inapp: false },
    })
    expect(formatPlan(p)).toMatch(/7 to create, 0 to update, 0 to delete, 0 unchanged/)
  })

  it('updates, leaves unchanged, prunes and removes stale managed alerts', () => {
    const alerts: CurrentAlert[] = [
      { id: 'a1', name: `${MANAGED_PREFIX}Entire org monthly budget`, project_id: null, scope: 'Entire org', threshold: 70, channels: { email: true, inapp: true }, is_active: true },
      { id: 'a2', name: `${MANAGED_PREFIX}Old project monthly budget`, project_id: null, scope: 'Old', threshold: 70, channels: { email: true }, is_active: true },
    ]
    const limits = [
      lim({ id: 'org' }),
      lim({ id: 'proj', scope: 'project', project_id: 'p1', budget_usd: '500.00', warn_at: 60 }),
      lim({ id: 'stray', scope: 'project', project_id: 'p9', period: 'daily' }),
    ]
    const p = buildPlan(desired(), { limits, alerts }, lookup, true)
    const byId = Object.fromEntries(p.limits.filter(c => 'id' in c).map(c => [(c as { id: string }).id, c]))
    expect(byId.org.op).toBe('unchanged')
    expect(byId.proj).toMatchObject({ op: 'update', before: { budget_usd: 500 }, after: { budget_usd: 800 } })
    expect(byId.stray.op).toBe('delete')
    expect(p.alerts.find(a => 'id' in a && a.id === 'a1')!.op).toBe('unchanged')
    expect(p.alerts.find(a => 'id' in a && a.id === 'a2')!.op).toBe('delete')
    // No prune → stray limit kept.
    expect(buildPlan(desired(), { limits, alerts }, lookup, false).limits.some(c => c.op === 'delete')).toBe(false)
  })

  it('flags unknown targets and duplicates', () => {
    const n = normalizeBudgets({ budgets: [
      { scope: 'project', target: 'nope', amount_usd: 1 },
      { scope: 'org', amount_usd: 1 }, { scope: 'org', amount_usd: 2 },
      { scope: 'team', target: 't1', amount_usd: 3 },
    ] })
    if (!n.ok) throw new Error('bad')
    const p = buildPlan(n.budgets, { limits: [], alerts: [] }, lookup, false)
    expect(p.ok).toBe(false)
    expect(p.issues.map(i => i.message)).toEqual([expect.stringMatching(/unknown project/), expect.stringMatching(/duplicate budget/)])
    expect(p.limits.find(c => c.op === 'create' && c.after.scope === 'team')).toBeTruthy()   // team by id resolves
  })
})
