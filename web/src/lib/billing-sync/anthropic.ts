/**
 * Anthropic Usage & Cost Admin API client (read-only).
 *  - GET /v1/organizations/cost_report   — daily cost; `amount` is a decimal STRING in cents
 *  - GET /v1/organizations/usage_report/messages?bucket_width=1d — daily tokens
 * Headers: x-api-key (Admin key, sk-ant-admin…), anthropic-version: 2023-06-01.
 * Pagination: has_more + next_page → `page`. 1d buckets: limit max 31.
 * Docs: https://platform.claude.com/docs/en/build-with-claude/usage-cost-api
 *
 * ANTHROPIC_ADMIN_BASE_URL overrides the host — for tests against a local mock only.
 */
import { getJson, mergeRows, num, str, utcDay, MAX_PAGES, type FetchWindow, type ProviderCostRow } from './types'

const baseUrl = () => (process.env.ANTHROPIC_ADMIN_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '')
const headers = (key: string) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' })

export const ANTHROPIC_ADMIN_KEY_RE = /^sk-ant-admin[0-9]*-[A-Za-z0-9_-]{16,}$/

interface Page { data?: { starting_at?: string; results?: Record<string, unknown>[] }[]; has_more?: boolean; next_page?: string | null }

/** Parse one cost_report page. Cents → USD. line_item = description (or cost_type). */
export function parseAnthropicCostReport(json: unknown): ProviderCostRow[] {
  const rows: ProviderCostRow[] = []
  for (const b of (json as Page)?.data ?? []) {
    if (!b?.starting_at) continue
    const day = utcDay(b.starting_at)
    for (const r of b.results ?? []) {
      rows.push({
        day,
        workspace_or_project: str(r.workspace_id),
        line_item:            str(r.description) || str(r.cost_type),
        model:                str(r.model),
        cost_usd:             num(r.amount) / 100,
        input_tokens: 0, output_tokens: 0, cache_read_tokens: 0,
      })
    }
  }
  return rows
}

/** Parse one usage_report/messages page into zero-cost token rows (line_item 'usage:tokens'). */
export function parseAnthropicUsageReport(json: unknown): ProviderCostRow[] {
  const rows: ProviderCostRow[] = []
  for (const b of (json as Page)?.data ?? []) {
    if (!b?.starting_at) continue
    const day = utcDay(b.starting_at)
    for (const r of b.results ?? []) {
      const cc = (r.cache_creation ?? {}) as Record<string, unknown>
      rows.push({
        day,
        workspace_or_project: str(r.workspace_id),
        line_item:            'usage:tokens',
        model:                str(r.model),
        cost_usd:             0,
        // Input = uncached + cache writes (billed as input); cache reads tracked separately.
        input_tokens:         num(r.uncached_input_tokens) + num(cc.ephemeral_5m_input_tokens) + num(cc.ephemeral_1h_input_tokens),
        output_tokens:        num(r.output_tokens),
        cache_read_tokens:    num(r.cache_read_input_tokens),
      })
    }
  }
  return rows
}

async function paged(path: string, params: URLSearchParams, key: string): Promise<unknown[]> {
  const pages: unknown[] = []
  let page: string | null = null
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = new URLSearchParams(params)
    if (page) q.set('page', page)
    const json = await getJson('anthropic', `${baseUrl()}${path}?${q}`, headers(key)) as Page
    pages.push(json)
    if (!json?.has_more || !json.next_page) return pages
    page = json.next_page
  }
  return pages
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

export async function fetchAnthropicCosts(key: string, w: FetchWindow): Promise<ProviderCostRow[]> {
  const common = [['starting_at', iso(w.start)], ['ending_at', iso(w.end)], ['bucket_width', '1d'], ['limit', '31']]
  const costQ  = new URLSearchParams([...common, ['group_by[]', 'workspace_id'], ['group_by[]', 'description']])
  const usageQ = new URLSearchParams([...common, ['group_by[]', 'workspace_id'], ['group_by[]', 'model']])
  const [costPages, usagePages] = await Promise.all([
    paged('/v1/organizations/cost_report', costQ, key),
    paged('/v1/organizations/usage_report/messages', usageQ, key),
  ])
  return mergeRows([
    ...costPages.flatMap(parseAnthropicCostReport),
    ...usagePages.flatMap(parseAnthropicUsageReport),
  ])
}

/** One small request to confirm the key works and has Admin/cost access. Throws ProviderApiError. */
export async function verifyAnthropicKey(key: string): Promise<void> {
  const end = new Date(); const start = new Date(end.getTime() - 86400_000)
  const q = new URLSearchParams([['starting_at', iso(start)], ['ending_at', iso(end)], ['limit', '1']])
  await getJson('anthropic', `${baseUrl()}/v1/organizations/cost_report?${q}`, headers(key))
}
