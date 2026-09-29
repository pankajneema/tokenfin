/**
 * TokenFin MCP Server — remote, Streamable HTTP transport (MCP spec 2025-06-18+).
 *
 * Thin HTTP layer over the MCP module in `@/lib/mcp`:
 *   route.ts  → Origin guard, auth, JSON-RPC parse, dispatch, respond
 *   lib/mcp/  → auth · tools · run · server · compress · ccr · pricing · types
 *
 * One endpoint exposes the UNIFIED tool set: read-only FinOps analytics + reversible
 * token saving (compress / retrieve / savings_stats).
 *
 * Security: Bearer auth per request (401 + WWW-Authenticate on failure); org-scoped
 * queries, role-scoped per-user data (members/viewers see only their own prompts,
 * sessions and member spend — lib/mcp/scope.ts); browser Origin rejected (DNS-rebinding); bearer token never logged.
 * Future: OAuth 2.1 + PKCE discovery (spec 2025-11-25); bearer is the interop baseline.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import crypto from 'crypto'
import { authenticate, unauthorized, authUnavailable, AuthUnavailableError, credentialFrom, originAllowed } from '@/lib/mcp/auth'
import { handleRpc } from '@/lib/mcp/server'

// DNS-rebinding guard. Blanket-rejecting every Origin broke legitimate clients —
// several MCP clients (web connectors, browser-based agents, MCP Inspector) DO
// send one. Allow known-good origins + our own app; reject the rest.
const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_APP_URL,
  'https://claude.ai', 'https://claude.com', 'https://chatgpt.com', 'https://chat.openai.com',
].filter(Boolean) as string[]


export async function POST(req: NextRequest) {
  if (!originAllowed(req.headers.get('origin'), ALLOWED_ORIGINS)) {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Origin not allowed' } }, { status: 403 })
  }

  let ctx: Awaited<ReturnType<typeof authenticate>>
  try { ctx = await authenticate(req) } catch (e) {
    if (e instanceof AuthUnavailableError) return authUnavailable()
    throw e
  }
  if (!ctx) return unauthorized(credentialFrom(req) !== '')
  // MCP is read-only analytics: only keys carrying the 'read' scope (new split
  // read keys, or legacy read+write keys). Ingest-only keys are refused.
  if (!ctx.scopes.includes('read')) {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32003, message: 'Forbidden: key lacks read scope' } }, { status: 403 })
  }

  // Lets get_insights call GET /api/v1/insights as this same key. Prefer the
  // configured app URL over the Host header.
  ctx.forward = {
    baseUrl: (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/+$/, ''),
    authorization: `Bearer ${credentialFrom(req)}`,
  }

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 })
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Mcp-Session-Id': req.headers.get('mcp-session-id') ?? crypto.randomUUID(),
  }

  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(m => handleRpc(m, ctx)))).filter(Boolean)
    return new NextResponse(JSON.stringify(out), { status: out.length ? 200 : 202, headers })
  }
  const res = await handleRpc(body, ctx)
  if (res === null) return new NextResponse(null, { status: 202, headers }) // notification
  return new NextResponse(JSON.stringify(res), { status: 200, headers })
}

// GET is for server→client SSE streaming; this server is request/response only.
export async function GET() {
  return new NextResponse('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } })
}
