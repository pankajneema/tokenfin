import { describe, it, expect } from 'vitest'
import { buildCodingToolsView, type ToolSummaryRow } from './summary'
import { summarizeMergedPrs, type MergedPrCostRow } from './merged-prs'

const row = (tool: string, user_key: string, o: Partial<ToolSummaryRow> = {}): ToolSummaryRow => ({
  tool, user_key, cost_vendor: 0, cost_notional: 0, requests: 0, sessions: 0, input_tokens: 0, output_tokens: 0,
  lines_added: 0, lines_removed: 0, accepted: 0, suggested: 0, commits: 0, pull_requests: 0, active_days: 1, ...o,
})

describe('buildCodingToolsView', () => {
  const people = new Map([['a@x.test', { name: 'Ann', email: 'a@x.test' }]])
  const v = buildCodingToolsView([
    row('claude_code_analytics', 'a@x.test', { cost_vendor: '3.5', accepted: 8, suggested: 10, pull_requests: 2 }),
    row('otel:claude_code',      'a@x.test', { cost_notional: 4, requests: 20, accepted: 9, suggested: 10 }),
    row('cursor',                'a@x.test', { cost_vendor: 1, requests: 5, accepted: 1, suggested: 10 }),
    row('otel:codex_cli',        'b@x.test', { cost_notional: 2, requests: 3 }),
    row('github_copilot',        'github:octo', { lines_added: 50, accepted: 5, suggested: 20 }),
    row('github_copilot',        '(organization)', { cost_vendor: 19 }),
  ], people)

  it('per tool: totals, developer counts, org-level spend', () => {
    const cp = v.tools.find(t => t.tool === 'github_copilot')!
    expect(cp).toMatchObject({ developers: 1, costVendor: 19, orgLevelCost: 19, label: 'GitHub Copilot' })
    expect(cp.acceptRate).toBeCloseTo(0.25)
    expect(v.tools[0].tool).toBe('github_copilot')                        // sorted by spend
  })

  it('per developer: Claude Code overlap excluded from totals, names resolved', () => {
    const ann = v.developers.find(d => d.key === 'a@x.test')!
    expect(ann.label).toBe('Ann')
    expect(ann.costVendor).toBe(4.5)
    expect(ann.costNotional).toBe(0)                                       // telemetry Claude Code excluded
    expect(ann.tools.find(t => t.tool === 'otel:claude_code')!.excluded).toBe(true)
    expect(ann.acceptRate).toBeCloseTo(9 / 20)
    expect(ann.prs).toBe(2)
    const b = v.developers.find(d => d.key === 'b@x.test')!
    expect(b).toMatchObject({ costNotional: 2, sub: 'not an org member' })
    const gh = v.developers.find(d => d.key === 'github:octo')!
    expect(gh).toMatchObject({ mapped: false, label: '@octo' })
  })

  it('grand totals include org rows and exclude overlap', () => {
    expect(v.totals.costVendor).toBeCloseTo(3.5 + 1 + 19)
    expect(v.totals.costNotional).toBe(2)
    expect(v.totals.developers).toBe(3)
    expect(v.unmappedLogins).toEqual(['octo'])
  })

  it('empty input', () => {
    const e = buildCodingToolsView([], new Map())
    expect(e).toMatchObject({ tools: [], developers: [], unmappedLogins: [] })
    expect(e.totals.acceptRate).toBeNull()
  })
})

describe('summarizeMergedPrs', () => {
  const pr = (o: Partial<MergedPrCostRow>): MergedPrCostRow => ({
    repo: 'acme/web', number: 1, title: 't', author_login: 'octo', user_key: 'a@x.test', merged_at: '2026-09-20T00:00:00Z',
    window_start: '2026-09-10T00:00:00Z', additions: 10, deletions: 1, cost_usd: 0, notional_usd: 0, events: 0, ...o,
  })
  it('cost per merged PR only over attributed PRs; unmapped authors listed by login', () => {
    const s = summarizeMergedPrs([
      pr({ number: 1, cost_usd: 4, notional_usd: 4 }),
      pr({ number: 2, cost_usd: 2, merged_at: '2026-09-21T00:00:00Z' }),
      pr({ number: 3, user_key: null, author_login: 'Ghost', repo: 'acme/api' }),
    ], new Map([['a@x.test', { name: 'Ann', email: 'a@x.test' }]]))
    expect(s.totals).toMatchObject({ prs: 3, attributed: 2, cost: 6, notional: 4, costPerPr: 3 })
    expect(s.byRepo.find(r => r.key === 'acme/web')).toMatchObject({ prs: 2, costPerPr: 3, additions: 20 })
    expect(s.byRepo.find(r => r.key === 'acme/api')).toMatchObject({ prs: 1, attributed: 0, costPerPr: null })
    expect(s.byAuthor.find(a => a.key === 'a@x.test')!.label).toBe('Ann')
    expect(s.byAuthor.find(a => a.key === 'login:ghost')!.sub).toMatch(/not mapped/)
    expect(s.recent[0].number).toBe(2)
  })
})
