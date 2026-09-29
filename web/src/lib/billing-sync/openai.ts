/**
 * OpenAI organization Costs API client (read-only).
 *  - GET /v1/organization/costs?start_time=<unix>&end_time=<unix>&bucket_width=1d
 *        &group_by=project_id&group_by=line_item&limit=…&page=…
 *  - Authorization: Bearer <Admin key (sk-admin-…)>
 * Response: { object:'page', data:[{ start_time, end_time, results:[{ amount:{value,currency},
 * line_item, project_id }] }], has_more, next_page }. amount.value is USD.
 * Docs: https://platform.openai.com/docs/api-reference/usage/costs
 *
 * OPENAI_ADMIN_BASE_URL overrides the host — for tests against a local mock only.
 */
import { getJson, mergeRows, num, str, utcDay, MAX_PAGES, type FetchWindow, type ProviderCostRow } from './types'

const baseUrl = () => (process.env.OPENAI_ADMIN_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '')
const headers = (key: string) => ({ Authorization: `Bearer ${key}` })

export const OPENAI_ADMIN_KEY_RE = /^sk-[A-Za-z0-9_-]{20,}$/

interface Page { data?: { start_time?: number; results?: Record<string, unknown>[] }[]; has_more?: boolean; next_page?: string | null }

const MODEL_RE = /^(ft:|ft-)?(gpt|o\d|chatgpt|text-embedding|codex|computer-use|dall-e|whisper|tts|omni|davinci|babbage|gpt-image)/i

/** "gpt-4o-2024-08-06, input" → "gpt-4o-2024-08-06"; non-model line items → ''. */
export function modelFromLineItem(lineItem: string): string {
  const head = lineItem.split(',')[0].trim()
  return MODEL_RE.test(head) ? head : ''
}

export function parseOpenAICosts(json: unknown): ProviderCostRow[] {
  const rows: ProviderCostRow[] = []
  for (const b of (json as Page)?.data ?? []) {
    if (typeof b?.start_time !== 'number') continue
    const day = utcDay(b.start_time * 1000)
    for (const r of b.results ?? []) {
      const amount = (r.amount ?? {}) as Record<string, unknown>
      const lineItem = str(r.line_item)
      rows.push({
        day,
        workspace_or_project: str(r.project_id),
        line_item:            lineItem,
        model:                modelFromLineItem(lineItem),
        cost_usd:             num(amount.value),
        input_tokens: 0, output_tokens: 0, cache_read_tokens: 0,
      })
    }
  }
  return rows
}

export async function fetchOpenAICosts(key: string, w: FetchWindow): Promise<ProviderCostRow[]> {
  const pages: unknown[] = []
  let page: string | null = null
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = new URLSearchParams([
      ['start_time', String(Math.floor(w.start.getTime() / 1000))],
      ['end_time',   String(Math.floor(w.end.getTime() / 1000))],
      ['bucket_width', '1d'], ['limit', '31'],
      ['group_by', 'project_id'], ['group_by', 'line_item'],
    ])
    if (page) q.set('page', page)
    const json = await getJson('openai', `${baseUrl()}/v1/organization/costs?${q}`, headers(key)) as Page
    pages.push(json)
    if (!json?.has_more || !json.next_page) break
    page = json.next_page
  }
  return mergeRows(pages.flatMap(parseOpenAICosts))
}

/** One small request to confirm the key works and has org cost access. Throws ProviderApiError. */
export async function verifyOpenAIKey(key: string): Promise<void> {
  const q = new URLSearchParams([['start_time', String(Math.floor(Date.now() / 1000) - 86400)], ['limit', '1']])
  await getJson('openai', `${baseUrl()}/v1/organization/costs?${q}`, headers(key))
}
