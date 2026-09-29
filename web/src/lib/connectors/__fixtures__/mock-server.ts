/**
 * Local mock of the four connector APIs (test-only; never talks to a vendor):
 *   Anthropic Claude Code Analytics, Cursor Admin, GitHub Copilot metrics + billing, GitHub pulls.
 * Response shapes follow the vendors' published docs/examples.
 */
import http from 'http'
import type { AddressInfo } from 'net'

export const GOOD_CLAUDE_KEY = 'sk-ant-admin01-cc_' + 'c'.repeat(24)
export const GOOD_CURSOR_KEY = 'key_cursor_' + 'd'.repeat(32)
export const GOOD_GH_TOKEN   = 'github_pat_' + 'G'.repeat(40)
export const GH_ORG = 'acme'
export const DAY1 = '2026-09-10'
export const DAY2 = '2026-09-11'

export interface MockOpts { cursor429Once?: boolean }
export interface MockServer {
  url: string
  requests: { method: string; path: string; query: URLSearchParams; headers: http.IncomingHttpHeaders; body: unknown }[]
  close: () => Promise<void>
}

// ── Anthropic Claude Code Analytics ──────────────────────────────────────────
const ccRecord = (email: string, customer: 'api' | 'subscription', model: string, cents: number) => ({
  date: `${DAY1}T00:00:00Z`,
  actor: { type: 'user_actor', email_address: email },
  organization_id: 'dc9f6c26-b22c-4831-8d01-0446bada88f1',
  customer_type: customer, terminal_type: 'vscode',
  core_metrics: { num_sessions: 5, lines_of_code: { added: 1543, removed: 892 }, commits_by_claude_code: 12, pull_requests_by_claude_code: 2 },
  tool_actions: { edit_tool: { accepted: 45, rejected: 5 }, multi_edit_tool: { accepted: 12, rejected: 2 }, write_tool: { accepted: 8, rejected: 1 }, notebook_edit_tool: { accepted: 3, rejected: 0 } },
  model_breakdown: [{ model, tokens: { input: 100000, output: 35000, cache_read: 10000, cache_creation: 5000 }, estimated_cost: { currency: 'USD', amount: cents } }],
})
export const claudeCodePage1 = { data: [ccRecord('Dev@Acme.test', 'api', 'claude-opus-4-1', 113)], has_more: true, next_page: 'page_2' }
export const claudeCodePage2 = {
  data: [
    ccRecord('pro@acme.test', 'subscription', 'claude-sonnet-4-6', 250),
    { date: `${DAY1}T00:00:00Z`, actor: { type: 'api_actor', api_key_name: 'ci-bot' }, customer_type: 'api', core_metrics: { num_sessions: 1 }, tool_actions: {}, model_breakdown: [] },
  ],
  has_more: false, next_page: null,
}

// ── Cursor ───────────────────────────────────────────────────────────────────
const D1MS = Date.parse(`${DAY1}T00:00:00Z`)
export const cursorDailyPage1 = {
  data: [{
    userId: 12345, day: DAY1, date: D1MS, isActive: true, email: 'dev@acme.test',
    totalLinesAdded: 1543, totalLinesDeleted: 892, acceptedLinesAdded: 1102, acceptedLinesDeleted: 645,
    totalApplies: 87, totalAccepts: 73, totalRejects: 14, totalTabsShown: 342, totalTabsAccepted: 289,
    composerRequests: 45, chatRequests: 128, agentRequests: 12, cmdkUsages: 67, subscriptionIncludedReqs: 180,
    apiKeyReqs: 0, usageBasedReqs: 5, bugbotUsages: 3, mostUsedModel: 'gpt-5',
  }],
  pagination: { page: 1, pageSize: 500, totalUsers: 2, totalPages: 2, hasNextPage: true, hasPreviousPage: false },
}
export const cursorDailyPage2 = {
  data: [
    { userId: 777, day: DAY2, date: D1MS + 86400_000, isActive: true, email: 'other@acme.test', acceptedLinesAdded: 10, acceptedLinesDeleted: 2, totalAccepts: 1, totalRejects: 1, totalTabsShown: 4, totalTabsAccepted: 2, chatRequests: 3 },
    { userId: 778, day: DAY2, date: D1MS + 86400_000, isActive: false, email: 'idle@acme.test' },
  ],
  pagination: { page: 2, pageSize: 500, totalUsers: 2, totalPages: 2, hasNextPage: false, hasPreviousPage: true },
}
export const cursorEventsPage1 = {
  totalUsageEventsCount: 3,
  pagination: { numPages: 2, currentPage: 1, pageSize: 1000, hasNextPage: true, hasPreviousPage: false },
  usageEvents: [
    { timestamp: String(D1MS + 3600_000), userEmail: 'dev@acme.test', model: 'claude-4.5-sonnet', kind: 'Usage-based', isChargeable: true, tokenUsage: { inputTokens: 126, outputTokens: 450, totalCents: 20.18232 }, chargedCents: 21.36232 },
    { timestamp: String(D1MS + 7200_000), userEmail: 'dev@acme.test', model: 'claude-4.5-sonnet', kind: 'Included in Business', isChargeable: false, tokenUsage: { inputTokens: 100, outputTokens: 100, totalCents: 3 }, chargedCents: 0 },
  ],
}
export const cursorEventsPage2 = {
  totalUsageEventsCount: 3,
  pagination: { numPages: 2, currentPage: 2, pageSize: 1000, hasNextPage: false, hasPreviousPage: true },
  usageEvents: [
    { timestamp: String(D1MS + 90000_000), userEmail: 'other@acme.test', model: 'gpt-5', kind: 'Usage-based', tokenUsage: { inputTokens: 10, outputTokens: 20, totalCents: 1.5 }, chargedCents: 1.5 },
  ],
}

// ── GitHub Copilot ───────────────────────────────────────────────────────────
export const copilotNdjson = [
  { day: DAY1, organization_id: '1', user_id: 1, user_login: 'OctoDev', user_initiated_interaction_count: 30, code_generation_activity_count: 100, code_acceptance_activity_count: 40, loc_suggested_to_add_sum: 500, loc_added_sum: 220, loc_deleted_sum: 30, ai_credits_used: 12.5, used_agent: true, used_chat: true },
  { day: DAY1, organization_id: '1', user_id: 2, user_login: 'unmapped-user', user_initiated_interaction_count: 2, code_generation_activity_count: 10, code_acceptance_activity_count: 5, loc_added_sum: 8, loc_deleted_sum: 0 },
].map(r => JSON.stringify(r)).join('\n') + '\n'
export const copilotBilling = {
  usageItems: [
    { date: `${DAY1}T00:00:00Z`, product: 'Copilot', sku: 'Copilot Business', quantity: 3, unitType: 'user-months', pricePerUnit: 0.6333, grossAmount: 1.9, discountAmount: 0, netAmount: 1.9, organizationName: GH_ORG },
    { date: `${DAY1}T00:00:00Z`, product: 'copilot', sku: 'Copilot Premium Request', quantity: 10, unitType: 'requests', pricePerUnit: 0.04, grossAmount: 0.4, discountAmount: 0, netAmount: 0.4, organizationName: GH_ORG },
    { date: `${DAY1}T00:00:00Z`, product: 'Actions', sku: 'Actions Linux', quantity: 100, unitType: 'minutes', pricePerUnit: 0.008, grossAmount: 0.8, discountAmount: 0, netAmount: 0.8, organizationName: GH_ORG },
    { date: '2026-01-01T00:00:00Z', product: 'Copilot', sku: 'Copilot Business', quantity: 1, netAmount: 99 },
  ],
}

// ── GitHub pulls ─────────────────────────────────────────────────────────────
const pr = (n: number, login: string, merged: string | null, updated: string, created: string) => ({
  number: n, title: `PR ${n}`, user: { login }, head: { ref: `feat-${n}`, sha: `sha${n}` },
  created_at: created, updated_at: updated, merged_at: merged, state: 'closed',
})
export const pullsPage1 = [
  pr(12, 'OctoDev', '2026-09-20T10:00:00Z', '2026-09-20T10:00:00Z', '2026-09-18T09:00:00Z'),
  pr(11, 'someone', null,                    '2026-09-19T10:00:00Z', '2026-09-17T09:00:00Z'),   // closed, not merged
]
export const pullsPage2 = [
  pr(10, 'OctoDev', '2026-09-12T10:00:00Z', '2026-09-12T10:00:00Z', '2026-09-11T09:00:00Z'),
  pr(3,  'OctoDev', '2026-06-01T10:00:00Z', '2026-06-01T10:00:00Z', '2026-05-30T09:00:00Z'),    // before the 60-day window
]

export async function startMockConnectors(opts: MockOpts = {}): Promise<MockServer> {
  const requests: MockServer['requests'] = []
  let cursor429 = !!opts.cursor429Once
  let url = ''
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      const u = new URL(req.url ?? '/', 'http://localhost')
      let body: unknown = null
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null } catch { /* not json */ }
      requests.push({ method: req.method ?? 'GET', path: u.pathname, query: u.searchParams, headers: req.headers, body })
      const send = (status: number, b: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(b === undefined ? '' : JSON.stringify(b))
      }
      const p = u.pathname

      // Anthropic
      if (p === '/v1/organizations/usage_report/claude_code') {
        if (req.headers['x-api-key'] !== GOOD_CLAUDE_KEY) return send(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })
        if (req.headers['anthropic-version'] !== '2023-06-01') return send(400, { error: { message: 'missing anthropic-version' } })
        if (u.searchParams.get('starting_at') !== DAY1) return send(200, { data: [], has_more: false, next_page: null })
        return send(200, u.searchParams.get('page') === 'page_2' ? claudeCodePage2 : claudeCodePage1)
      }

      // Cursor
      if (p.startsWith('/teams/')) {
        const expected = 'Basic ' + Buffer.from(`${GOOD_CURSOR_KEY}:`).toString('base64')
        if (req.headers.authorization !== expected) return send(401, { error: 'Unauthorized' })
        if (p === '/teams/members') return send(200, { teamMembers: [{ id: 'u1', name: 'Dev', email: 'dev@acme.test', role: 'member', isRemoved: false }] })
        const b = (body ?? {}) as { startDate?: number; endDate?: number; page?: number }
        if (!b.startDate || !b.endDate || b.endDate - b.startDate > 30 * 86400_000) return send(400, { error: 'Date range cannot exceed 30 days' })
        const inRange = b.startDate <= D1MS && D1MS <= b.endDate
        if (p === '/teams/daily-usage-data') {
          if (cursor429) { cursor429 = false; return send(429, { error: 'rate limited' }, { 'retry-after': '1' }) }
          if (!inRange) return send(200, { data: [], pagination: { page: 1, totalPages: 0, hasNextPage: false } })
          return send(200, b.page === 2 ? cursorDailyPage2 : cursorDailyPage1)
        }
        if (p === '/teams/filtered-usage-events') {
          if (!inRange) return send(200, { usageEvents: [], pagination: { numPages: 0, currentPage: 1, hasNextPage: false } })
          return send(200, b.page === 2 ? cursorEventsPage2 : cursorEventsPage1)
        }
      }

      // Pre-signed download (must NOT carry the GitHub token)
      if (p.startsWith('/dl/')) {
        if (req.headers.authorization) return send(400, { error: 'unexpected auth header on signed URL' })
        res.writeHead(200, { 'content-type': 'application/x-ndjson' }); return res.end(copilotNdjson)
      }

      // GitHub
      if (req.headers.authorization !== `Bearer ${GOOD_GH_TOKEN}`) return send(401, { message: 'Bad credentials' })
      if (p === `/orgs/${GH_ORG}/copilot/metrics/reports/users-1-day`) {
        if (u.searchParams.get('day') !== DAY1) { res.writeHead(204); return res.end() }
        return send(200, { download_links: [`${url}/dl/${DAY1}.ndjson?sig=abc`], report_day: DAY1 })
      }
      if (p === `/orgs/${GH_ORG}/copilot/metrics/reports/organization-28-day/latest`) return send(200, { download_links: [], report_start_day: DAY1, report_end_day: DAY2 })
      if (p.startsWith('/orgs/')) return send(404, { message: 'Not Found' })
      if (p === `/organizations/${GH_ORG}/settings/billing/usage`) return send(200, copilotBilling)
      if (p === '/user/repos') return send(200, [{ full_name: 'acme/web' }])
      if (p === '/repos/acme/web') return send(200, { full_name: 'acme/web' })
      if (p === '/repos/acme/web/pulls') {
        if (u.searchParams.get('page') === '2') return send(200, pullsPage2)
        return send(200, pullsPage1, { link: `<${url}/repos/acme/web/pulls?state=closed&page=2>; rel="next", <${url}/repos/acme/web/pulls?page=2>; rel="last"` })
      }
      const m = p.match(/^\/repos\/acme\/web\/pulls\/(\d+)$/)
      if (m) return send(200, { number: +m[1], additions: +m[1] * 10, deletions: +m[1] })
      const c = p.match(/^\/repos\/acme\/web\/commits\/sha(\d+)$/)
      if (c) return send(200, { sha: `sha${c[1]}`, commit: { author: { email: c[1] === '10' ? '1+OctoDev@users.noreply.github.com' : 'Octo@Acme.test' } } })
      send(404, { message: 'Not Found' })
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  url = `http://127.0.0.1:${port}`
  return { url, requests, close: () => new Promise(r => server.close(() => r())) }
}
