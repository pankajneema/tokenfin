import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { parseClaudeCodePage, fetchClaudeCodeUsage, verifyClaudeCodeKey, actorKey, CLAUDE_ADMIN_KEY_RE } from './claude-code'
import { parseCursorDailyUsage, parseCursorUsageEvents, fetchCursorUsage, verifyCursorKey, chunkWindow, cursorRetry, CURSOR_KEY_RE } from './cursor'
import { parseCopilotUserReport, parseCopilotBilling, fetchCopilotUsage, verifyCopilotToken, GITHUB_TOKEN_RE } from './copilot'
import { parsePullList, fetchMergedPrs, isNoreply } from './github'
import { nextLink } from './http'
import { mergeToolRows, emptyRow, daysIn, connectorKeyHint, ConnectorApiError } from './types'
import { connectorWindow } from './sync'
import {
  startMockConnectors, claudeCodePage1, claudeCodePage2, cursorDailyPage1, cursorDailyPage2, cursorEventsPage1,
  copilotNdjson, copilotBilling, pullsPage1, pullsPage2,
  GOOD_CLAUDE_KEY, GOOD_CURSOR_KEY, GOOD_GH_TOKEN, GH_ORG, DAY1, DAY2, type MockServer,
} from './__fixtures__/mock-server'

const NOW = new Date('2026-09-29T12:00:00Z')
const W = connectorWindow(35, NOW)

describe('parsing', () => {
  it('Claude Code: activity row + per-model rows, cents → USD, customer_type → basis', () => {
    const rows = parseClaudeCodePage(claudeCodePage1)
    const act = rows.find(r => r.model === '')!
    expect(act).toMatchObject({ day: DAY1, user_key: 'dev@acme.test', sessions: 5, lines_added: 1543, lines_removed: 892, commits: 12, pull_requests: 2, accepted: 68, suggested: 76, cost_basis: 'vendor_reported' })
    const m = rows.find(r => r.model === 'claude-opus-4-1')!
    expect(m).toMatchObject({ input_tokens: 105000, output_tokens: 35000, cost_basis: 'vendor_reported' })
    expect(m.cost_usd).toBeCloseTo(1.13, 6)
    const sub = parseClaudeCodePage(claudeCodePage2)
    expect(sub.find(r => r.model === 'claude-sonnet-4-6')).toMatchObject({ user_key: 'pro@acme.test', cost_basis: 'notional', cost_usd: 2.5 })
    expect(sub.some(r => r.user_key === 'apikey:ci-bot')).toBe(true)
    expect(actorKey(null)).toBe('unknown')
  })

  it('Cursor daily usage: accepted lines, accept rate inputs, idle users dropped', () => {
    const [r] = parseCursorDailyUsage(cursorDailyPage1)
    expect(r).toMatchObject({ day: DAY1, user_key: 'dev@acme.test', requests: 45 + 128 + 12 + 67 + 3, lines_added: 1102, lines_removed: 645, accepted: 73 + 289, suggested: 73 + 14 + 342 })
    const p2 = parseCursorDailyUsage(cursorDailyPage2)
    expect(p2.map(x => x.user_key)).toEqual(['other@acme.test'])
  })

  it('Cursor usage events: charged cents → USD per event', () => {
    const rows = mergeToolRows(parseCursorUsageEvents(cursorEventsPage1))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ user_key: 'dev@acme.test', model: 'claude-4.5-sonnet', requests: 2, input_tokens: 226, output_tokens: 550 })
    expect(rows[0].cost_usd).toBeCloseTo(0.2136232, 6)
  })

  it('Copilot NDJSON report + billing', () => {
    const rows = parseCopilotUserReport(copilotNdjson, DAY1)
    expect(rows[0]).toMatchObject({ user_key: 'github:octodev', requests: 30, accepted: 40, suggested: 100, lines_added: 220, lines_removed: 30, cost_usd: 0 })
    expect(rows[0].raw.ai_credits_used).toBe(12.5)
    expect(parseCopilotUserReport(JSON.stringify([{ user_login: 'A' }]), DAY2)[0]).toMatchObject({ user_key: 'github:a', day: DAY2 })
    expect(parseCopilotUserReport('not json\n{"user_login":"b"}', DAY1)).toHaveLength(1)
    const bill = mergeToolRows(parseCopilotBilling(copilotBilling, new Set(daysIn(W))))
    expect(bill).toHaveLength(1)
    expect(bill[0]).toMatchObject({ user_key: '(organization)', day: DAY1 })
    expect(bill[0].cost_usd).toBeCloseTo(2.3, 6)
  })

  it('GitHub pulls: only merged PRs inside the window', () => {
    const since = '2026-07-31T00:00:00.000Z'
    expect(parsePullList(pullsPage1, 'acme/web', since).map(p => p.number)).toEqual([12])
    expect(parsePullList(pullsPage2, 'acme/web', since).map(p => p.number)).toEqual([10])
    expect(parsePullList({ junk: 1 }, 'acme/web', since)).toEqual([])
    expect(isNoreply('1+x@users.noreply.github.com')).toBe(true)
    expect(nextLink('<https://a/b?page=2>; rel="next", <https://a/b?page=9>; rel="last"')).toBe('https://a/b?page=2')
    expect(nextLink(null)).toBeNull()
  })

  it('merge keeps billed basis on mixed rows and records the split', () => {
    const a = { ...emptyRow(DAY1, 'x@y', 'm', 'vendor_reported'), cost_usd: 1 }
    const b = { ...emptyRow(DAY1, 'x@y', 'm', 'notional'), cost_usd: 2 }
    const [m] = mergeToolRows([a, b])
    expect(m).toMatchObject({ cost_usd: 3, cost_basis: 'vendor_reported' })
    expect(m.raw.cost_by_basis).toEqual({ vendor_reported: 1, notional: 2 })
  })

  it('windows, chunks, key formats, hints', () => {
    expect(daysIn(W)).toHaveLength(36)
    const chunks = chunkWindow(W)
    expect(chunks).toHaveLength(2)
    expect(chunks.every(c => c.end.getTime() - c.start.getTime() <= 30 * 86400_000)).toBe(true)
    expect(CLAUDE_ADMIN_KEY_RE.test(GOOD_CLAUDE_KEY)).toBe(true)
    expect(CLAUDE_ADMIN_KEY_RE.test('sk-ant-api03-' + 'x'.repeat(30))).toBe(false)
    expect(CURSOR_KEY_RE.test(GOOD_CURSOR_KEY)).toBe(true)
    expect(GITHUB_TOKEN_RE.test(GOOD_GH_TOKEN)).toBe(true)
    expect(GITHUB_TOKEN_RE.test('ghp_' + 'a'.repeat(36))).toBe(true)
    expect(GITHUB_TOKEN_RE.test('password123')).toBe(false)
    expect(connectorKeyHint('github', GOOD_GH_TOKEN)).toBe('github_pat_…GGGG')
    expect(connectorKeyHint('cursor', GOOD_CURSOR_KEY)).toBe('key_…dddd')
  })
})

describe('against the local mock server', () => {
  let mock: MockServer
  beforeAll(async () => {
    mock = await startMockConnectors({ cursor429Once: true })
    process.env.ANTHROPIC_ADMIN_BASE_URL = mock.url
    process.env.CURSOR_API_BASE_URL = mock.url
    process.env.GITHUB_API_BASE_URL = mock.url
    cursorRetry.baseMs = 10
  })
  afterAll(async () => {
    delete process.env.ANTHROPIC_ADMIN_BASE_URL; delete process.env.CURSOR_API_BASE_URL; delete process.env.GITHUB_API_BASE_URL
    await mock?.close()
  })

  it('Claude Code: follows next_page, one request per day', async () => {
    const rows = await fetchClaudeCodeUsage(GOOD_CLAUDE_KEY, W)
    const reqs = mock.requests.filter(r => r.path.endsWith('/claude_code'))
    expect(reqs).toHaveLength(36 + 1)                      // 36 days + page 2 of DAY1
    expect(reqs.find(r => r.query.get('page') === 'page_2')?.query.get('starting_at')).toBe(DAY1)
    expect(rows.filter(r => r.model === '').map(r => r.user_key).sort()).toEqual(['apikey:ci-bot', 'dev@acme.test', 'pro@acme.test'])
    await expect(verifyClaudeCodeKey(GOOD_CLAUDE_KEY)).resolves.toBeUndefined()
  })

  it('Claude Code: auth error → ConnectorApiError 401 without the key', async () => {
    const bad = 'sk-ant-admin01-wrong_' + 'z'.repeat(24)
    const err = await fetchClaudeCodeUsage(bad, W).catch(e => e)
    expect(err).toBeInstanceOf(ConnectorApiError)
    expect(err.status).toBe(401)
    expect(err.message).toMatch(/invalid x-api-key/)
    expect(err.message).not.toContain(bad)
  })

  it('Cursor: ≤30-day chunks, both paginated endpoints, 429 retried, Basic auth', async () => {
    const rows = await fetchCursorUsage(GOOD_CURSOR_KEY, W)
    const daily = mock.requests.filter(r => r.path === '/teams/daily-usage-data')
    expect(daily.some(r => r.body && (r.body as { page: number }).page === 2)).toBe(true)
    expect(rows.find(r => r.user_key === 'dev@acme.test' && r.model === '')?.lines_added).toBe(1102)
    const dev = rows.find(r => r.user_key === 'dev@acme.test' && r.model === 'claude-4.5-sonnet')!
    expect(dev.cost_usd).toBeCloseTo(0.2136232, 6)
    expect(rows.find(r => r.user_key === 'other@acme.test' && r.model === 'gpt-5')?.cost_usd).toBeCloseTo(0.015, 6)
    await expect(verifyCursorKey(GOOD_CURSOR_KEY)).resolves.toBeUndefined()
    const err = await verifyCursorKey('key_bad_' + 'x'.repeat(30)).catch(e => e)
    expect(err.status).toBe(401)
  })

  it('Copilot: per-day reports downloaded without auth header, billing to org row', async () => {
    const { rows, warnings } = await fetchCopilotUsage(GOOD_GH_TOKEN, GH_ORG, W)
    expect(warnings).toEqual([])
    const dl = mock.requests.filter(r => r.path.startsWith('/dl/'))
    expect(dl).toHaveLength(1)
    expect(dl[0].headers.authorization).toBeUndefined()
    expect(rows.find(r => r.user_key === 'github:octodev')).toMatchObject({ lines_added: 220 })
    expect(rows.find(r => r.user_key === '(organization)')?.cost_usd).toBeCloseTo(2.3, 6)
    expect(mock.requests.filter(r => r.path.endsWith('/billing/usage')).map(r => r.query.get('month')).sort()).toEqual(['8', '9'])
    await expect(verifyCopilotToken(GOOD_GH_TOKEN, GH_ORG)).resolves.toBeUndefined()
    expect((await verifyCopilotToken(GOOD_GH_TOKEN, 'nope').catch(e => e)).status).toBe(404)
    expect((await fetchCopilotUsage('ghp_' + 'b'.repeat(36), GH_ORG, W).catch(e => e)).status).toBe(401)
  })

  it('GitHub: Link pagination, detail + head-commit email, known PRs skipped', async () => {
    const since = connectorWindow(60, NOW).start
    const { rows } = await fetchMergedPrs(GOOD_GH_TOKEN, [], since)
    expect(rows.map(r => r.number).sort()).toEqual([10, 12])
    expect(rows.find(r => r.number === 12)).toMatchObject({ additions: 120, deletions: 12, author_email: 'octo@acme.test', author_login: 'OctoDev', head_ref: 'feat-12' })
    expect(rows.find(r => r.number === 10)).toMatchObject({ additions: 100, author_email: null })   // noreply ignored
    const before = mock.requests.filter(r => /\/pulls\/\d+$/.test(r.path)).length
    const again = await fetchMergedPrs(GOOD_GH_TOKEN, ['acme/web'], since, new Set(['acme/web#10', 'acme/web#12']))
    expect(mock.requests.filter(r => /\/pulls\/\d+$/.test(r.path)).length).toBe(before)
    expect(again.rows.every(r => r.additions === null)).toBe(true)
  })
})
