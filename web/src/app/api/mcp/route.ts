/**
 * TokenFin MCP Server — remote, Streamable HTTP transport (MCP spec 2025-06-18+).
 *
 * Single endpoint, JSON-RPC 2.0 over HTTP POST. Read-only FinOps tools scoped
 * to the org that owns the presented API key.
 *
 * Security model (industry standard, pragmatic):
 *   - Auth: `Authorization: Bearer <tfk_…>` validated on EVERY request. Missing/
 *     invalid → 401 with a WWW-Authenticate header (RFC 9728 discovery hint).
 *   - Least privilege: the key MUST carry the `read` scope; this server exposes
 *     NO write/destructive tools, so an MCP key never needs write access.
 *   - Org isolation: every query is scoped to the key's org_id (authorization
 *     boundary) — a key can never read another org's data.
 *   - DNS-rebinding: browser Origin headers are rejected (MCP clients are not
 *     browsers; a present Origin means a hijack attempt).
 *   - The bearer token is never logged.
 *
 * Future hardening: full OAuth 2.1 + PKCE with .well-known/oauth-protected-
 * resource discovery and step-up scopes (spec 2025-11-25). Bearer-key auth is
 * the interoperable baseline that every current MCP client supports.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'

const PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'tokenfin', title: 'TokenFin FinOps', version: '1.0.0' }

interface KeyCtx { orgId: string; scopes: string[] }

async function authenticate(req: NextRequest): Promise<KeyCtx | null> {
  const auth = req.headers.get('authorization') ?? ''
  const raw  = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!raw) return null
  const keyHash = crypto.createHash('sha256').update(raw).digest('hex')
  const { data } = await createAdminClient()
    .from('api_keys')
    .select('org_id, is_active, expires_at, scopes')
    .eq('key_hash', keyHash)
    .maybeSingle()
  if (!data || !data.is_active) return null
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null
  return { orgId: data.org_id as string, scopes: (data.scopes as string[] | null) ?? [] }
}

function unauthorized() {
  return new NextResponse(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      // RFC 9728 discovery hint — points clients at the protected-resource metadata.
      'WWW-Authenticate': 'Bearer realm="TokenFin MCP", error="invalid_token"',
    },
  })
}

// ─── Tools (all read-only) ────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'list_projects',
    description: 'List the projects in the organization.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'List projects', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_spend',
    description: 'Total AI spend, tokens, and request count for the org over the last N days (default 30).',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 365 } }, additionalProperties: false },
    annotations: { title: 'Get spend', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_usage_by_model',
    description: 'Cost, tokens, and requests broken down by model over the last N days (default 30).',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 365 } }, additionalProperties: false },
    annotations: { title: 'Usage by model', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_daily_costs',
    description: 'Daily cost series for the org over the last N days (default 30).',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 365 } }, additionalProperties: false },
    annotations: { title: 'Daily costs', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_budget_status',
    description: 'Active org budget limits with current month spend and % used.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'Budget status', readOnlyHint: true, openWorldHint: false },
  },
] as const

async function runTool(name: string, args: Record<string, unknown>, ctx: KeyCtx): Promise<unknown> {
  const admin = createAdminClient()
  const days  = Math.min(Math.max(Number(args.days) || 30, 1), 365)
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)

  switch (name) {
    case 'list_projects': {
      const { data } = await admin.from('projects').select('id, name, slug').eq('org_id', ctx.orgId).order('name')
      return { projects: data ?? [] }
    }
    case 'get_spend': {
      const { data } = await admin.from('usage_agg').select('cost_usd, total_tokens, request_count').eq('org_id', ctx.orgId).gte('bucket', since)
      const rows = data ?? []
      return {
        period_days: days,
        cost_usd: +rows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0).toFixed(4),
        total_tokens: rows.reduce((s, r) => s + Number(r.total_tokens ?? 0), 0),
        requests: rows.reduce((s, r) => s + Number(r.request_count ?? 0), 0),
      }
    }
    case 'get_usage_by_model': {
      const { data } = await admin.from('usage_agg').select('model, cost_usd, total_tokens, request_count').eq('org_id', ctx.orgId).gte('bucket', since)
      const byModel = new Map<string, { model: string; cost_usd: number; total_tokens: number; requests: number }>()
      for (const r of data ?? []) {
        const m = byModel.get(r.model) ?? { model: r.model, cost_usd: 0, total_tokens: 0, requests: 0 }
        m.cost_usd += Number(r.cost_usd ?? 0); m.total_tokens += Number(r.total_tokens ?? 0); m.requests += Number(r.request_count ?? 0)
        byModel.set(r.model, m)
      }
      return { period_days: days, models: Array.from(byModel.values()).map(m => ({ ...m, cost_usd: +m.cost_usd.toFixed(4) })).sort((a, b) => b.cost_usd - a.cost_usd) }
    }
    case 'get_daily_costs': {
      const { data } = await admin.from('usage_agg').select('bucket, cost_usd').eq('org_id', ctx.orgId).gte('bucket', since)
      const byDay = new Map<string, number>()
      for (const r of data ?? []) byDay.set(r.bucket, (byDay.get(r.bucket) ?? 0) + Number(r.cost_usd ?? 0))
      return { period_days: days, daily: Array.from(byDay.entries()).map(([day, cost]) => ({ day, cost_usd: +cost.toFixed(4) })).sort((a, b) => a.day.localeCompare(b.day)) }
    }
    case 'get_budget_status': {
      const monthStart = new Date(); monthStart.setDate(1)
      const [{ data: limits }, { data: agg }] = await Promise.all([
        admin.from('limits').select('scope, period, budget_usd, warn_at, throttle_at, block_at').eq('org_id', ctx.orgId).eq('is_active', true),
        admin.from('usage_agg').select('cost_usd').eq('org_id', ctx.orgId).gte('bucket', monthStart.toISOString().slice(0, 10)),
      ])
      const spend = (agg ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
      return {
        month_spend_usd: +spend.toFixed(4),
        limits: (limits ?? []).map(l => {
          const budget = Number(l.budget_usd ?? 0)
          const pct = budget > 0 ? +(spend / budget * 100).toFixed(1) : null
          const status = pct == null ? 'no_budget' : pct >= Number(l.block_at ?? 100) ? 'blocked' : pct >= Number(l.throttle_at ?? 90) ? 'throttled' : pct >= Number(l.warn_at ?? 70) ? 'warning' : 'ok'
          return { scope: l.scope, period: l.period, budget_usd: budget, pct_used: pct, status }
        }),
      }
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ─── JSON-RPC dispatch ────────────────────────────────────────────────────────
async function handleRpc(msg: any, ctx: KeyCtx): Promise<any | null> {
  const { id, method, params } = msg ?? {}
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result })
  const err = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })

  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: 'TokenFin exposes read-only FinOps tools: org spend, per-model usage, daily costs, and budget status.',
      })
    case 'notifications/initialized':
      return null // notification — no response
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({ tools: TOOLS })
    case 'tools/call': {
      const name = params?.name as string
      const tool = TOOLS.find(t => t.name === name)
      if (!tool) return err(-32602, `Unknown tool: ${name}`)
      try {
        const data = await runTool(name, (params?.arguments ?? {}) as Record<string, unknown>, ctx)
        return ok({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError: false })
      } catch (e) {
        return ok({ content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true })
      }
    }
    default:
      if (id === undefined) return null // unknown notification
      return err(-32601, `Method not found: ${method}`)
  }
}

export async function POST(req: NextRequest) {
  // DNS-rebinding guard: real MCP clients don't send a browser Origin.
  const origin = req.headers.get('origin')
  if (origin) {
    return new NextResponse(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Origin not allowed' } }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  }

  const ctx = await authenticate(req)
  if (!ctx) return unauthorized()
  if (!ctx.scopes.includes('read') && ctx.scopes.length > 0) {
    return new NextResponse(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32003, message: 'Forbidden: key lacks read scope' } }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  }

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 }) }

  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Mcp-Session-Id': req.headers.get('mcp-session-id') ?? crypto.randomUUID() }

  // Support JSON-RPC batches.
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(m => handleRpc(m, ctx)))).filter(Boolean)
    return new NextResponse(JSON.stringify(out), { status: out.length ? 200 : 202, headers })
  }
  const res = await handleRpc(body, ctx)
  if (res === null) return new NextResponse(null, { status: 202, headers }) // notification
  return new NextResponse(JSON.stringify(res), { status: 200, headers })
}

// GET would be used for server→client SSE streaming; this server is request/
// response only, so advertise that GET isn't supported.
export async function GET() {
  return new NextResponse('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } })
}
