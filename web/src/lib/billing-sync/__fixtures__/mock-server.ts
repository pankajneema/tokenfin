/** Tiny local mock of the Anthropic + OpenAI admin cost endpoints (test-only). */
import http from 'http'
import type { AddressInfo } from 'net'
import { anthropicCostPage1, anthropicCostPage2, anthropicUsage, openaiPage1, openaiPage2 } from './fixtures'

export const GOOD_ANTHROPIC_KEY = 'sk-ant-admin01-test_' + 'x'.repeat(24)
export const GOOD_OPENAI_KEY    = 'sk-admin-test_' + 'y'.repeat(24)

export interface MockServer { url: string; requests: { path: string; query: URLSearchParams; headers: http.IncomingHttpHeaders }[]; close: () => Promise<void> }

export async function startMockProviders(): Promise<MockServer> {
  const requests: MockServer['requests'] = []
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://localhost')
    requests.push({ path: u.pathname, query: u.searchParams, headers: req.headers })
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }

    if (u.pathname.startsWith('/v1/organizations/')) {
      if (req.headers['x-api-key'] !== GOOD_ANTHROPIC_KEY) return send(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })
      if (req.headers['anthropic-version'] !== '2023-06-01') return send(400, { error: { message: 'missing anthropic-version' } })
      if (u.pathname === '/v1/organizations/cost_report') return send(200, u.searchParams.get('page') === 'page_2' ? anthropicCostPage2 : anthropicCostPage1)
      if (u.pathname === '/v1/organizations/usage_report/messages') return send(200, anthropicUsage)
    }
    if (u.pathname === '/v1/organization/costs') {
      if (req.headers.authorization !== `Bearer ${GOOD_OPENAI_KEY}`) return send(401, { error: { message: 'Incorrect API key provided' } })
      return send(200, u.searchParams.get('page') === 'page_AAA' ? openaiPage2 : openaiPage1)
    }
    send(404, { error: { message: 'not found' } })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise(r => server.close(() => r())) }
}
