/**
 * Pull connectors for coding-AI vendors (Claude Code Analytics, Cursor, GitHub
 * Copilot) and GitHub merged PRs. Server-only. Connections live in
 * provider_connections (key sealed with lib/crypto/key-reveal); non-secret
 * settings (GitHub org, repo list) in provider_connections.config.
 */

export type CodingTool = 'claude_code_analytics' | 'cursor' | 'github_copilot'
export type ConnectorProvider = CodingTool | 'github'
export const CODING_TOOLS: readonly CodingTool[] = ['claude_code_analytics', 'cursor', 'github_copilot']
export const CONNECTOR_PROVIDERS: readonly ConnectorProvider[] = [...CODING_TOOLS, 'github']
export const isConnectorProvider = (p: string): p is ConnectorProvider =>
  (CONNECTOR_PROVIDERS as readonly string[]).includes(p)

export const TOOL_LABEL: Record<string, string> = {
  claude_code_analytics: 'Claude Code (Analytics API)',
  cursor:                'Cursor',
  github_copilot:        'GitHub Copilot',
  github:                'GitHub (merged PRs)',
  'otel:claude_code':    'Claude Code (TokenFin telemetry)',
  'otel:codex_cli':      'Codex CLI (TokenFin telemetry)',
  'otel:gemini_cli':     'Gemini CLI (TokenFin telemetry)',
  'otel:opencode':       'OpenCode (TokenFin telemetry)',
}

export type CostBasis = 'vendor_reported' | 'notional'

/** One coding_tool_usage row (minus org_id/tool, added by sync). */
export interface CodingToolRow {
  day:           string   // YYYY-MM-DD (UTC)
  user_key:      string   // lowercased email | 'github:<login>' | '(organization)'
  model:         string   // '' = activity row
  requests:      number
  sessions:      number
  input_tokens:  number
  output_tokens: number
  lines_added:   number
  lines_removed: number
  accepted:      number
  suggested:     number
  commits:       number
  pull_requests: number
  cost_usd:      number
  cost_basis:    CostBasis
  raw:           Record<string, unknown>
}

export const ORG_USER_KEY = '(organization)'

export function emptyRow(day: string, user_key: string, model = '', cost_basis: CostBasis = 'vendor_reported'): CodingToolRow {
  return {
    day, user_key, model, cost_basis, raw: {},
    requests: 0, sessions: 0, input_tokens: 0, output_tokens: 0, lines_added: 0, lines_removed: 0,
    accepted: 0, suggested: 0, commits: 0, pull_requests: 0, cost_usd: 0,
  }
}

const SUM_FIELDS = ['requests', 'sessions', 'input_tokens', 'output_tokens', 'lines_added', 'lines_removed',
  'accepted', 'suggested', 'commits', 'pull_requests', 'cost_usd'] as const

/**
 * Sum rows sharing the coding_tool_usage unique key (one upsert batch may not
 * touch a row twice). Mixed cost bases keep 'vendor_reported' (anything billed
 * wins) and the split is kept in raw.cost_by_basis.
 */
export function mergeToolRows(rows: CodingToolRow[]): CodingToolRow[] {
  const m = new Map<string, CodingToolRow & { _basis: Record<string, number> }>()
  for (const r of rows) {
    const k = [r.day, r.user_key, r.model].join('\u0000')
    const cur = m.get(k)
    if (!cur) { m.set(k, { ...r, raw: { ...r.raw }, _basis: { [r.cost_basis]: r.cost_usd } }); continue }
    for (const f of SUM_FIELDS) cur[f] += r[f]
    cur._basis[r.cost_basis] = (cur._basis[r.cost_basis] ?? 0) + r.cost_usd
    if (cur.cost_basis !== r.cost_basis) cur.cost_basis = 'vendor_reported'
    const parts = (cur.raw.parts as unknown[] | undefined) ?? [cur.raw]
    cur.raw = { parts: [...parts, r.raw] }
  }
  return Array.from(m.values()).map(({ _basis, ...r }) => {
    if (Object.keys(_basis).length > 1) r.raw = { ...r.raw, cost_by_basis: _basis }
    return { ...r, cost_usd: +r.cost_usd.toFixed(6) }
  })
}

export interface FetchWindow { start: Date; end: Date }

export class ConnectorApiError extends Error {
  constructor(public provider: ConnectorProvider, public status: number, message: string) {
    super(message)
    this.name = 'ConnectorApiError'
  }
}

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN
  return Number.isFinite(n) ? n : 0
}
export const int = (v: unknown): number => Math.round(num(v))
export const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
export const utcDay = (d: string | number | Date): string => new Date(d).toISOString().slice(0, 10)
export const lowerEmail = (v: unknown): string => str(v).trim().toLowerCase()

/** Every UTC day in [start, end), oldest first. */
export function daysIn(w: FetchWindow): string[] {
  const out: string[] = []
  const t0 = Date.UTC(w.start.getUTCFullYear(), w.start.getUTCMonth(), w.start.getUTCDate())
  for (let t = t0; t < w.end.getTime(); t += 86400_000) out.push(utcDay(t))
  return out
}

/** Masked secret hint for display: a short family prefix + last 4. */
export function connectorKeyHint(provider: ConnectorProvider, key: string): string {
  const k = key.trim()
  const prefix =
    k.startsWith('sk-ant-admin') ? 'sk-ant-admin…'
    : k.startsWith('github_pat_') ? 'github_pat_…'
    : /^gh[pousr]_/.test(k) ? k.slice(0, 4) + '…'
    : k.startsWith('key_') ? 'key_…'
    : provider === 'cursor' ? 'cursor…' : '…'
  return prefix + k.slice(-4)
}
