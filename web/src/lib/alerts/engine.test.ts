import { describe, it, expect } from 'vitest'
import { evaluateRuleDetailed, evaluateRule, limitSnapshots, type AlertRule, type OrgCtx, type CtxEvent } from './engine'

const NOW = new Date()
const dayTs = (n: number) => new Date(NOW.getTime() - n * 86400_000).toISOString()

function ctx(events: CtxEvent[], limits: OrgCtx['limits'] = []): OrgCtx {
  return {
    orgId: 'o', events, userMonth: new Map(), limits,
    projectName: new Map([['p1', 'Web'], ['p2', 'Batch']]), emailByUser: new Map(),
    adminUserIds: [], slackUrl: null, webhookUrl: null, members: [],
  }
}
const rule = (x: Partial<AlertRule>): AlertRule => ({
  id: 'r', org_id: 'o', project_id: null, name: 'r', trigger_type: 'threshold', condition: '', threshold: null,
  channels: {}, is_active: true, fired_count: 0, last_fired_at: null, cooldown_hours: 4, ...x,
})

describe('anomaly trigger', () => {
  const hist: CtxEvent[] = []
  for (let i = 1; i <= 20; i++) {
    hist.push({ project_id: 'p1', model: 'sonnet', cost_usd: 5, created_at: dayTs(i) })
    hist.push({ project_id: 'p2', model: 'haiku',  cost_usd: 5, created_at: dayTs(i) })
  }
  const spike = [...hist, { project_id: 'p2', model: 'haiku', cost_usd: 40, created_at: NOW.toISOString() }]

  it('old rules (no anomaly_scope) evaluate at org scope', () => {
    expect(evaluateRule(rule({ trigger_type: 'anomaly' }), ctx(spike))).toMatch(/Your org spend today \(\$40\.00\)/)
  })
  it('project / model scopes name the offender', () => {
    expect(evaluateRule(rule({ trigger_type: 'anomaly', anomaly_scope: 'project' }), ctx(spike))).toMatch(/^Project Batch/)
    expect(evaluateRule(rule({ trigger_type: 'anomaly', anomaly_scope: 'model' }), ctx(spike))).toMatch(/^Model haiku/)
  })
  it('rule.project_id restricts the data', () => {
    expect(evaluateRule(rule({ trigger_type: 'anomaly', project_id: 'p1' }), ctx(spike))).toBeNull()
  })
})

describe('limit_breach / forecast', () => {
  const evs: CtxEvent[] = [{ project_id: 'p1', cost_usd: 105, created_at: NOW.toISOString() }]
  const limits = [{ scope: 'project', project_id: 'p1', period: 'daily' as const, budget_usd: 100, warn_at: 70, block_at: 100 }]
  it('uses the limit period and marks block-level as critical', () => {
    const r = evaluateRuleDetailed(rule({ trigger_type: 'limit_breach' }), ctx(evs, limits))!
    expect(r.critical).toBe(true)
    expect(r.message).toMatch(/Web is at 105% of its \$100 daily limit/)
  })
  it('a rule percent threshold overrides warn_at', () => {
    expect(evaluateRuleDetailed(rule({ trigger_type: 'limit_breach', threshold: 110 }), ctx(evs, limits))).toBeNull()
  })
  it('forecast fires on a projected overspend', () => {
    const hist: CtxEvent[] = []
    for (let i = 1; i <= 14; i++) hist.push({ project_id: null, cost_usd: 50, created_at: dayTs(i) })
    const l = [{ scope: 'org', project_id: null, period: 'monthly' as const, budget_usd: 100, warn_at: 80, block_at: 100 }]
    const snap = limitSnapshots(ctx(hist, l), NOW)[0]
    expect(snap.forecast.rate).toBeCloseTo(50)
    const r = evaluateRuleDetailed(rule({ trigger_type: 'forecast' }), ctx(hist, l))
    expect(r?.message).toMatch(/^Forecast: org is projected to spend/)
    expect(r?.critical).toBe(false)
    const big = [{ ...l[0], budget_usd: 1_000_000 }]
    expect(evaluateRuleDetailed(rule({ trigger_type: 'forecast' }), ctx(hist, big))).toBeNull()
  })
})
