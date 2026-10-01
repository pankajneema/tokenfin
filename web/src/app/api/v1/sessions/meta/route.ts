/**
 * POST /api/v1/sessions/meta — session context from the agent's machine.
 *
 * Body: one event, or { events: [...], tools: [...] }.
 *   event: { session_id, event: "start" | "end" | "seen", agent, agent_version,
 *            cwd, git_branch, repo, hostname, user_email, start_source,
 *            end_reason, at }
 *   tool:  { event_key, session_id, prompt_id, tool, mcp_server, success,
 *            duration_ms, decision, error, at }
 * Callers: the Claude Code SessionStart / SessionEnd hooks installed by
 * `tokenfin setup`, and the TokenFin OpenCode plugin. Auth: the same ingest
 * key as usage (Bearer). Writes are idempotent (see migration 023).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authIngest } from '@/app/api/v1/ingest/_core'
import { parseMeta, parseToolCall, persistSessionMeta, persistToolCalls } from '@/lib/session-meta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_ITEMS = 500

export async function POST(req: NextRequest) {
  const auth = await authIngest(req)
  if (!auth.ok) return auth.res
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'JSON body required' }, { status: 400 })

  const rawEvents = Array.isArray(body.events) ? body.events : body.session_id ? [body] : []
  const rawTools = Array.isArray(body.tools) ? body.tools : []
  if (rawEvents.length + rawTools.length === 0) return NextResponse.json({ error: 'nothing to record' }, { status: 400 })
  if (rawEvents.length > MAX_ITEMS || rawTools.length > MAX_ITEMS) return NextResponse.json({ error: `at most ${MAX_ITEMS} events and ${MAX_ITEMS} tools per request` }, { status: 413 })

  const metas = rawEvents.map(parseMeta).filter(Boolean) as NonNullable<ReturnType<typeof parseMeta>>[]
  const tools = rawTools.map(parseToolCall).filter(Boolean) as NonNullable<ReturnType<typeof parseToolCall>>[]
  const admin = createAdminClient()
  const [events, toolCalls] = await Promise.all([
    persistSessionMeta(admin, auth.ctx.orgId, metas),
    persistToolCalls(admin, auth.ctx.orgId, tools),
  ])
  return NextResponse.json({ events, tools: toolCalls, rejected: rawEvents.length - metas.length + rawTools.length - tools.length })
}
