/**
 * Combine coding_tools_summary() rows (vendor connectors + TokenFin telemetry)
 * into per-tool and per-developer views. Pure — unit tested.
 *
 * Overlap rule: Claude Code can arrive twice (Analytics API pull AND TokenFin's
 * own OTel capture). For a developer who has Analytics API rows, the telemetry
 * Claude Code row is shown but excluded from that developer's totals.
 */
import { ORG_USER_KEY, TOOL_LABEL } from './types'

export interface ToolSummaryRow {
  tool: string; user_key: string
  cost_vendor: number | string; cost_notional: number | string
  requests: number | string; sessions: number | string; input_tokens: number | string; output_tokens: number | string
  lines_added: number | string; lines_removed: number | string; accepted: number | string; suggested: number | string
  commits: number | string; pull_requests: number | string; active_days: number | string
}

export interface Metrics {
  costVendor: number; costNotional: number; requests: number; sessions: number
  tokens: number; linesAdded: number; linesRemoved: number
  accepted: number; suggested: number; commits: number; prs: number
}
export interface ToolAgg extends Metrics { tool: string; label: string; developers: number; acceptRate: number | null; orgLevelCost: number }
export interface DevToolCell extends Metrics { tool: string; label: string; excluded: boolean; acceptRate: number | null }
export interface DevRow extends Metrics { key: string; label: string; sub: string; mapped: boolean; acceptRate: number | null; tools: DevToolCell[] }
export interface CodingToolsView {
  tools: ToolAgg[]
  developers: DevRow[]
  totals: Metrics & { acceptRate: number | null; developers: number }
  unmappedLogins: string[]
}

const N = (v: unknown) => Number(v ?? 0) || 0
const zero = (): Metrics => ({ costVendor: 0, costNotional: 0, requests: 0, sessions: 0, tokens: 0, linesAdded: 0, linesRemoved: 0, accepted: 0, suggested: 0, commits: 0, prs: 0 })
const METRIC_KEYS = Object.keys(zero()) as (keyof Metrics)[]
function add<T extends Metrics>(m: T, r: Metrics): T {
  for (const k of METRIC_KEYS) m[k] += r[k]
  return m
}
const fromRow = (r: ToolSummaryRow): Metrics => ({
  costVendor: N(r.cost_vendor), costNotional: N(r.cost_notional), requests: N(r.requests), sessions: N(r.sessions),
  tokens: N(r.input_tokens) + N(r.output_tokens), linesAdded: N(r.lines_added), linesRemoved: N(r.lines_removed),
  accepted: N(r.accepted), suggested: N(r.suggested), commits: N(r.commits), prs: N(r.pull_requests),
})
export const acceptRate = (m: Pick<Metrics, 'accepted' | 'suggested'>) => (m.suggested > 0 ? Math.min(1, m.accepted / m.suggested) : null)
export const toolLabel = (t: string) => TOOL_LABEL[t] ?? t

export function buildCodingToolsView(
  rows: ToolSummaryRow[],
  people: Map<string, { name: string; email: string }>,   // keyed by lowercased email
): CodingToolsView {
  const tools = new Map<string, ToolAgg>()
  const devs = new Map<string, { cells: DevToolCell[] }>()
  const unmapped = new Set<string>()

  for (const r of rows) {
    const m = fromRow(r)
    const t = tools.get(r.tool) ?? { ...zero(), tool: r.tool, label: toolLabel(r.tool), developers: 0, acceptRate: null, orgLevelCost: 0 }
    add(t, m)
    if (r.user_key === ORG_USER_KEY) t.orgLevelCost += m.costVendor + m.costNotional
    else t.developers++
    tools.set(r.tool, t)
    if (r.user_key === ORG_USER_KEY) continue
    if (r.user_key.startsWith('github:')) unmapped.add(r.user_key.slice(7))
    const d = devs.get(r.user_key) ?? { cells: [] }
    d.cells.push({ ...m, tool: r.tool, label: toolLabel(r.tool), excluded: false, acceptRate: acceptRate(m) })
    devs.set(r.user_key, d)
  }

  const developers: DevRow[] = []
  for (const [key, { cells }] of Array.from(devs.entries())) {
    const hasApi = cells.some(c => c.tool === 'claude_code_analytics')
    const total = zero()
    for (const c of cells) {
      c.excluded = hasApi && c.tool === 'otel:claude_code'
      if (!c.excluded) add(total, c)
    }
    const p = people.get(key)
    const isGh = key.startsWith('github:')
    developers.push({
      ...total, key, mapped: !isGh,
      label: p?.name ?? (isGh ? `@${key.slice(7)}` : key),
      sub: p ? p.email : isGh ? 'GitHub login — map it to an email below' : key === 'unknown' ? '' : 'not an org member',
      acceptRate: acceptRate(total),
      tools: cells.sort((a, b) => (b.costVendor + b.costNotional) - (a.costVendor + a.costNotional)),
    })
  }
  developers.sort((a, b) => (b.costVendor + b.costNotional) - (a.costVendor + a.costNotional) || b.requests - a.requests)

  // Grand totals = developer totals (overlap removed) + org-level spend rows.
  const totals = developers.reduce((acc, d) => add(acc, d), zero())
  for (const t of Array.from(tools.values())) totals.costVendor += t.orgLevelCost
  return {
    tools: Array.from(tools.values()).map(t => ({ ...t, acceptRate: acceptRate(t) }))
      .sort((a, b) => (b.costVendor + b.costNotional) - (a.costVendor + a.costNotional) || b.requests - a.requests),
    developers,
    totals: { ...totals, acceptRate: acceptRate(totals), developers: developers.length },
    unmappedLogins: Array.from(unmapped).sort(),
  }
}
