import { describe, it, expect } from 'vitest'
import { ruleCoversLimit } from './_budget-link'

describe('ruleCoversLimit (mirrors the alert engine)', () => {
  const orgLimit  = { project_id: null, budget_usd: 100 }
  const projLimit = { project_id: 'p1', budget_usd: 50 }
  it('an org-wide budget rule watches every limit', () => {
    expect(ruleCoversLimit({ trigger_type: 'limit_breach', project_id: null }, orgLimit)).toBe(true)
    expect(ruleCoversLimit({ trigger_type: 'forecast', project_id: null }, projLimit)).toBe(true)
  })
  it('a project rule watches only that project’s limits', () => {
    expect(ruleCoversLimit({ trigger_type: 'limit_breach', project_id: 'p1' }, projLimit)).toBe(true)
    expect(ruleCoversLimit({ trigger_type: 'limit_breach', project_id: 'p1' }, orgLimit)).toBe(false)
    expect(ruleCoversLimit({ trigger_type: 'limit_breach', project_id: 'p2' }, projLimit)).toBe(false)
  })
  it('non-budget triggers and zero budgets never link', () => {
    expect(ruleCoversLimit({ trigger_type: 'threshold', project_id: null }, orgLimit)).toBe(false)
    expect(ruleCoversLimit({ trigger_type: 'limit_breach', project_id: null }, { project_id: null, budget_usd: 0 })).toBe(false)
    expect(ruleCoversLimit({ trigger_type: 'limit_breach', project_id: null }, { scope: 'member', project_id: null, budget_usd: 10 })).toBe(false)
  })
})
