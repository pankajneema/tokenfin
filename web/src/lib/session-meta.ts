/**
 * Session context (migration 023): where / how a session ran, and its tool
 * calls. Written by POST /api/v1/sessions/meta (Claude Code SessionStart /
 * SessionEnd hooks, the TokenFin OpenCode plugin) and by the OTLP logs
 * receiver (resource attributes + tool_result events). Server-only.
 */
import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { redact } from '@/lib/redact'

export type MetaEvent = 'start' | 'end' | 'seen'

export interface SessionMetaInput {
  session_id: string
  event: MetaEvent
  agent?: string | null
  agent_version?: string | null
  cwd?: string | null
  git_branch?: string | null
  repo?: string | null
  hostname?: string | null
  user_email?: string | null
  start_source?: string | null
  end_reason?: string | null
  at?: string | null
}

export interface ToolCallInput {
  event_key: string
  session_id: string
  prompt_id?: string | null
  tool: string
  mcp_server?: string | null
  success?: boolean | null
  duration_ms?: number | null
  decision?: string | null
  error?: string | null
  at: string
}

const s = (v: unknown, max: number) => {
  const t = v == null ? '' : String(v).trim()
  return t ? t.slice(0, max) : null
}
const iso = (v: unknown) => {
  const d = v == null ? NaN : Date.parse(String(v))
  return Number.isFinite(d) ? new Date(d).toISOString() : null
}
const bool = (v: unknown) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : null)

/** Validate one meta event from an untrusted client; null when unusable. */
export function parseMeta(b: unknown): SessionMetaInput | null {
  const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>
  const session_id = s(o.session_id, 200)
  const event = o.event === 'start' || o.event === 'end' || o.event === 'seen' ? o.event : null
  if (!session_id || !event) return null
  return {
    session_id, event,
    agent: s(o.agent, 64), agent_version: s(o.agent_version, 64),
    cwd: s(o.cwd, 1000), git_branch: s(o.git_branch, 300), repo: s(o.repo, 300), hostname: s(o.hostname, 255),
    user_email: s(o.user_email, 320)?.toLowerCase() ?? null,
    start_source: s(o.start_source, 32), end_reason: s(o.end_reason, 64),
    at: iso(o.at),
  }
}

/** Validate one tool call from an untrusted client; null when unusable. */
export function parseToolCall(b: unknown): ToolCallInput | null {
  const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>
  const session_id = s(o.session_id, 200)
  const tool = s(o.tool, 200)
  const key = s(o.event_key ?? o.id, 300)
  const at = iso(o.at) ?? new Date().toISOString()
  if (!session_id || !tool || !key) return null
  const d = Number(o.duration_ms)
  return {
    event_key: key, session_id, tool,
    prompt_id: s(o.prompt_id, 200), mcp_server: s(o.mcp_server, 200),
    success: bool(o.success),
    duration_ms: Number.isFinite(d) && d >= 0 ? Math.min(Math.round(d), 2_147_483_647) : null,
    decision: s(o.decision, 32),
    error: o.error == null ? null : redact(String(o.error)).slice(0, 500),
    at,
  }
}

export async function persistSessionMeta(admin: SupabaseClient, orgId: string, metas: SessionMetaInput[]): Promise<number> {
  let n = 0
  await Promise.all(metas.map(m => {
    const { session_id, event, ...rest } = m
    return admin.rpc('tf_session_meta_upsert', { p_org: orgId, p_session: session_id, p_event: event, p: rest })
      .then(({ error }) => { if (error) console.warn('[session-meta] skipped:', error.message); else n++ })
  }))
  return n
}

export async function persistToolCalls(admin: SupabaseClient, orgId: string, calls: ToolCallInput[]): Promise<number> {
  if (!calls.length) return 0
  const seen = new Set<string>()
  const rows = calls.filter(c => !seen.has(c.event_key) && seen.add(c.event_key)).map(c => ({ org_id: orgId, ...c }))
  const { error } = await admin.from('session_tool_calls').upsert(rows, { onConflict: 'org_id,event_key', ignoreDuplicates: true })
  if (error) { console.warn('[session-meta] tool calls skipped:', error.message); return 0 }
  return rows.length
}

// ── OTLP logs (Claude Code / Cowork) ─────────────────────────────────────────

type Attrs = Record<string, unknown>

/**
 * From an OTLP logs body: one 'seen' meta per session (agent, version, host,
 * Cowork workspace path) and one tool call per tool_result event. Tool inputs
 * are never kept — only the tool / MCP server name, outcome and duration.
 */
export function sessionContextFromLogs(body: any, attrsToMap: (a: any[]) => Attrs, source: (res: Attrs, eventName: string) => string) {
  const metas = new Map<string, SessionMetaInput>()
  const tools: ToolCallInput[] = []
  for (const rl of body?.resourceLogs ?? []) {
    const res = attrsToMap(rl?.resource?.attributes ?? [])
    for (const sl of rl?.scopeLogs ?? []) {
      for (const rec of sl?.logRecords ?? []) {
        const a = attrsToMap(rec?.attributes ?? [])
        const id = { ...res, ...a }
        const session = s(id['session.id'], 200)
        if (!session) continue
        const eventName = String(rec?.eventName ?? a['event.name'] ?? '')
        const at = nanoIso(rec?.timeUnixNano ?? rec?.observedTimeUnixNano) ?? iso(a['event.timestamp']) ?? new Date().toISOString()
        if (!metas.has(session)) {
          const cwd = firstString(rec?.attributes, 'workspace.host_paths') ?? firstString(rl?.resource?.attributes, 'workspace.host_paths') ?? ''
          metas.set(session, {
            session_id: session, event: 'seen', at,
            agent: source(res, eventName), agent_version: s(res['service.version'] ?? id['app.version'], 64),
            hostname: s(res['host.name'] ?? id['host.name'], 255), cwd: s(cwd, 1000),
            user_email: s(id['user.email'], 320)?.toLowerCase() ?? null,
          })
        } else {
          const m = metas.get(session)!
          if (at < (m.at ?? at)) m.at = at   // earliest time seen in this export
        }
        if (/(^|[._])tool_result$/.test(eventName)) {
          let mcp: string | null = null
          try {
            const p = typeof a['tool_parameters'] === 'string' ? JSON.parse(a['tool_parameters'] as string) : a['tool_parameters']
            mcp = s((p as Attrs | null)?.mcp_server_name, 200)
          } catch { /* not JSON */ }
          const seq = a['event.sequence']
          tools.push({
            event_key: seq != null && String(seq) !== ''
              ? `${session}:${seq}`
              : crypto.createHash('sha256').update(`${session}|${a['tool_name']}|${rec?.timeUnixNano ?? at}|${a['duration_ms'] ?? ''}`).digest('hex').slice(0, 40),
            session_id: session, prompt_id: s(id['prompt.id'], 200),
            tool: s(a['tool_name'], 200) ?? 'unknown', mcp_server: mcp,
            success: bool(a['success']),
            duration_ms: Number.isFinite(Number(a['duration_ms'])) ? Math.round(Number(a['duration_ms'])) : null,
            decision: s(a['decision_type'] ?? a['decision'], 32),
            error: a['error'] == null ? null : redact(String(a['error'])).slice(0, 500),
            at,
          })
        }
      }
    }
  }
  return { metas: Array.from(metas.values()), tools }
}

/** A string or the first entry of a string-array OTLP attribute (the shared map drops arrays). */
function firstString(attrs: any[] | undefined, key: string): string | null {
  const v = (attrs ?? []).find((a: any) => a?.key === key)?.value
  if (!v) return null
  if (typeof v.stringValue === 'string') return v.stringValue
  const first = v.arrayValue?.values?.[0]?.stringValue
  return typeof first === 'string' ? first : null
}

function nanoIso(n: unknown): string | null {
  if (n == null || n === '' || n === 0 || n === '0') return null
  try { return new Date(Number(BigInt(String(n)) / BigInt(1_000_000))).toISOString() } catch { return null }
}
