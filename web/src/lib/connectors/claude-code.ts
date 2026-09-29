/**
 * Anthropic Claude Code Analytics Admin API (read-only).
 *   GET /v1/organizations/usage_report/claude_code?starting_at=YYYY-MM-DD&limit=1000[&page=…]
 *   Headers: x-api-key (Admin key sk-ant-admin…), anthropic-version: 2023-06-01
 *   One UTC day per request; cursor pagination via has_more + next_page.
 *   Record: date, actor{type,email_address|api_key_name}, customer_type (api|subscription),
 *   terminal_type, core_metrics{num_sessions, lines_of_code{added,removed},
 *   commits_by_claude_code, pull_requests_by_claude_code}, tool_actions{<tool>{accepted,rejected}},
 *   model_breakdown[{model, tokens{input,output,cache_read,cache_creation}, estimated_cost{currency,amount(cents)}}]
 * Docs (verified 2026-09-29): https://platform.claude.com/docs/en/manage-claude/claude-code-analytics-api
 *
 * cost_basis: customer_type 'api' → vendor_reported (pay-as-you-go estimate);
 * 'subscription' → notional (Pro/Team seats; not a per-token bill).
 * ANTHROPIC_ADMIN_BASE_URL overrides the host — local mock tests only.
 */
import { requestJson } from './http'
import { daysIn, emptyRow, int, lowerEmail, mergeToolRows, num, str, utcDay, type CodingToolRow, type FetchWindow } from './types'

const baseUrl = () => (process.env.ANTHROPIC_ADMIN_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '')
const headers = (key: string) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' })
const MAX_PAGES_PER_DAY = 50
const DAY_CONCURRENCY = 4

export const CLAUDE_ADMIN_KEY_RE = /^sk-ant-admin[0-9]*-[A-Za-z0-9_-]{16,}$/

interface Page { data?: Record<string, unknown>[]; has_more?: boolean; next_page?: string | null }
type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? v as Obj : {})

export function actorKey(actor: unknown): string {
  const a = obj(actor)
  const email = lowerEmail(a.email_address)
  if (email) return email
  const name = str(a.api_key_name).trim()
  return name ? `apikey:${name}` : 'unknown'
}

/** Parse one usage_report/claude_code page into coding_tool_usage rows. */
export function parseClaudeCodePage(json: unknown, fallbackDay?: string): CodingToolRow[] {
  const rows: CodingToolRow[] = []
  for (const rec of (json as Page)?.data ?? []) {
    if (!rec || typeof rec !== 'object') continue
    const day = rec.date ? utcDay(str(rec.date)) : fallbackDay
    if (!day) continue
    const user = actorKey(rec.actor)
    const basis = str(rec.customer_type) === 'subscription' ? 'notional' as const : 'vendor_reported' as const
    const meta = { customer_type: str(rec.customer_type), terminal_type: str(rec.terminal_type) }

    const core = obj(rec.core_metrics)
    const loc  = obj(core.lines_of_code)
    let accepted = 0, rejected = 0
    for (const t of Object.values(obj(rec.tool_actions))) { accepted += int(obj(t).accepted); rejected += int(obj(t).rejected) }
    const act = emptyRow(day, user, '', basis)
    act.sessions      = int(core.num_sessions)
    act.lines_added   = int(loc.added)
    act.lines_removed = int(loc.removed)
    act.commits       = int(core.commits_by_claude_code)
    act.pull_requests = int(core.pull_requests_by_claude_code)
    act.accepted      = accepted
    act.suggested     = accepted + rejected
    act.raw           = { ...meta, tool_actions: rec.tool_actions ?? null }
    rows.push(act)

    for (const mb of Array.isArray(rec.model_breakdown) ? rec.model_breakdown : []) {
      const m = obj(mb); const tok = obj(m.tokens); const cost = obj(m.estimated_cost)
      const r = emptyRow(day, user, str(m.model) || 'unknown', basis)
      r.input_tokens  = int(tok.input) + int(tok.cache_creation)
      r.output_tokens = int(tok.output)
      r.cost_usd      = num(cost.amount) / 100          // cents → USD
      r.raw           = { ...meta, cache_read: int(tok.cache_read), cache_creation: int(tok.cache_creation), currency: str(cost.currency) || 'USD' }
      rows.push(r)
    }
  }
  return rows
}

async function fetchDay(key: string, day: string): Promise<CodingToolRow[]> {
  const out: CodingToolRow[] = []
  let page: string | null = null
  for (let i = 0; i < MAX_PAGES_PER_DAY; i++) {
    const q = new URLSearchParams({ starting_at: day, limit: '1000' })
    if (page) q.set('page', page)
    const json = await requestJson('claude_code_analytics', `${baseUrl()}/v1/organizations/usage_report/claude_code?${q}`,
      { headers: headers(key), secret: key }) as Page
    out.push(...parseClaudeCodePage(json, day))
    if (!json?.has_more || !json.next_page) break
    page = json.next_page
  }
  return out
}

export async function fetchClaudeCodeUsage(key: string, w: FetchWindow): Promise<CodingToolRow[]> {
  const days = daysIn(w)
  const all: CodingToolRow[] = []
  for (let i = 0; i < days.length; i += DAY_CONCURRENCY) {
    const batch = await Promise.all(days.slice(i, i + DAY_CONCURRENCY).map(d => fetchDay(key, d)))
    for (const b of batch) all.push(...b)
  }
  return mergeToolRows(all)
}

/** One small request to confirm the Admin key can read Claude Code analytics. */
export async function verifyClaudeCodeKey(key: string): Promise<void> {
  const q = new URLSearchParams({ starting_at: utcDay(Date.now() - 86400_000), limit: '1' })
  await requestJson('claude_code_analytics', `${baseUrl()}/v1/organizations/usage_report/claude_code?${q}`, { headers: headers(key), secret: key })
}
