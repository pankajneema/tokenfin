import { describe, it, expect } from 'vitest'
import { allocate, allocateRows, matches, normalizeRule, sortRules, splitWeights, referencedTagKeys, type AllocationRule } from './apply'

const rule = (p: Partial<AllocationRule>): AllocationRule => ({
  id: p.id ?? 'r', kind: 'assign', priority: 100, match: {}, assign: {}, ...p,
})

describe('matches', () => {
  it('tag equality and presence', () => {
    expect(matches({ tag: 'cost_center', equals: 'cc-42' }, { tags: { cost_center: 'cc-42' } })).toBe(true)
    expect(matches({ tag: 'cost_center', equals: 'cc-42' }, { tags: { cost_center: 'cc-1' } })).toBe(false)
    expect(matches({ tag: 'env' }, { tags: { env: 'prod' } })).toBe(true)
    expect(matches({ tag: 'env' }, { tags: {} })).toBe(false)
  })
  it('repo prefix on bare names, owner/name and git URLs', () => {
    expect(matches({ repo_prefix: 'payments-' }, { repo: 'payments-api' })).toBe(true)
    expect(matches({ repo_prefix: 'payments-' }, { repo: 'acme/payments-web' })).toBe(true)
    expect(matches({ repo_prefix: 'payments-' }, { repo: 'git@github.com:acme/payments-core.git' })).toBe(true)
    expect(matches({ repo_prefix: 'payments-' }, { repo: 'acme/search' })).toBe(false)
    expect(matches({ repo_prefix: 'payments-' }, { repo: null })).toBe(false)
  })
  it('email domain incl. sub-domains, case-insensitive', () => {
    expect(matches({ email_domain: 'contractor.com' }, { user_email: 'A@Contractor.com' })).toBe(true)
    expect(matches({ email_domain: '@contractor.com' }, { user_email: 'a@eu.contractor.com' })).toBe(true)
    expect(matches({ email_domain: 'contractor.com' }, { user_email: 'a@notcontractor.com' })).toBe(false)
  })
  it('ANDs keys; empty match matches everything', () => {
    expect(matches({}, {})).toBe(true)
    expect(matches({ project_id: 'p1', source: 'claude_code' }, { project_id: 'p1', source: 'sdk' })).toBe(false)
  })
})

describe('allocate', () => {
  const rules = sortRules([
    rule({ id: 'late', priority: 200, match: {}, assign: { cost_center: 'cc-default' } }),
    rule({ id: 'pay', priority: 10, match: { repo_prefix: 'payments-' }, assign: { team: 'Payments', cost_center: 'cc-42' } }),
    rule({ id: 'ctr', priority: 20, match: { email_domain: 'contractor.com' }, assign: { team: 'Contractors' } }),
  ])
  it('first matching rule wins per field, later rules fill gaps', () => {
    const a = allocate({ repo: 'payments-api', user_email: 'x@contractor.com' }, rules)
    expect(a).toMatchObject({ team: 'Payments', cost_center: 'cc-42', team_from: 'rule', rule_ids: ['pay'] })
    const b = allocate({ user_email: 'x@contractor.com' }, rules)
    expect(b).toMatchObject({ team: 'Contractors', cost_center: 'cc-default', rule_ids: ['ctr', 'late'] })
  })
  it('falls back to the member team and a cost_center tag', () => {
    const a = allocate({ member_team: 'Search', tags: { cost_center: 'cc-7' } }, [])
    expect(a).toMatchObject({ team: 'Search', team_from: 'member', cost_center: 'cc-7' })
  })
  it('ignores inactive rules', () => {
    const a = allocate({ repo: 'payments-x' }, sortRules([rule({ id: 'x', is_active: false, match: {}, assign: { team: 'T' } })]))
    expect(a.team).toBeNull()
  })
})

describe('shared split', () => {
  type R = { team?: string; cost: number; repo?: string }
  const rows: R[] = [
    { team: 'A', cost: 30 }, { team: 'B', cost: 10 }, { cost: 8 }, { cost: 2, repo: 'infra-x' },
  ]
  const subj = (r: R) => ({ member_team: r.team ?? null, repo: r.repo ?? null })
  it('splits unattributed cost proportionally to attributed cost', () => {
    const out = allocateRows(rows, subj, r => r.cost, [rule({ id: 's', kind: 'shared_split' })])
    const byTeam = new Map<string, number>()
    for (const o of out) byTeam.set(o.team ?? '-', (byTeam.get(o.team ?? '-') ?? 0) + o.row.cost * o.weight)
    expect(byTeam.get('A')).toBeCloseTo(30 + 10 * 0.75)
    expect(byTeam.get('B')).toBeCloseTo(10 + 10 * 0.25)
    expect(byTeam.has('-')).toBe(false)
    // Total preserved.
    expect(Array.from(byTeam.values()).reduce((s, v) => s + v, 0)).toBeCloseTo(50)
  })
  it('honours match and among', () => {
    const out = allocateRows(rows, subj, r => r.cost,
      [rule({ id: 's', kind: 'shared_split', match: { repo_prefix: 'infra-' }, assign: { among: ['B'] } })])
    const un = out.filter(o => !o.team)
    expect(un).toHaveLength(1)                       // the 8 without repo stays unattributed
    const b = out.filter(o => o.team === 'B' && o.split_rule === 's')
    expect(b).toHaveLength(1)
    expect(b[0].weight).toBe(1)
  })
  it('leaves rows alone when nothing is attributed', () => {
    const out = allocateRows([{ cost: 5 }] as R[], subj, r => r.cost, [rule({ id: 's', kind: 'shared_split' })])
    expect(out).toHaveLength(1)
    expect(out[0].team).toBeNull()
  })
  it('splitWeights sums to 1', () => {
    const w = splitWeights(new Map([['a', 1], ['b', 3], ['c', 0]]))
    expect(w.get('a')).toBeCloseTo(0.25)
    expect(w.has('c')).toBe(false)
  })
})

describe('normalizeRule', () => {
  it('validates keys and requires an assignment', () => {
    expect(normalizeRule({ match: { bogus: 'x' }, assign: { team: 'T' } })).toMatch(/unknown match key/)
    expect(normalizeRule({ match: { equals: 'x' }, assign: { team: 'T' } })).toMatch(/needs match.tag/)
    expect(normalizeRule({ match: {}, assign: {} })).toMatch(/must set team or cost_center/)
    const ok = normalizeRule({ kind: 'shared_split', assign: { among: ['A', ' '] } })
    expect(typeof ok).toBe('object')
    expect((ok as AllocationRule).assign.among).toEqual(['A'])
  })
  it('referencedTagKeys always includes cost_center', () => {
    expect(referencedTagKeys([rule({ match: { tag: 'team' } })])).toEqual(['cost_center', 'team'])
  })
})
