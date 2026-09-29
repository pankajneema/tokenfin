/**
 * GitHub Copilot usage metrics + billing (GitHub token; org name in config).
 *   GET /orgs/{org}/copilot/metrics/reports/users-1-day?day=YYYY-MM-DD
 *       → {download_links[], report_day} (204 = no report). Links are pre-signed
 *         NDJSON files, one record per user: day, user_id, user_login,
 *         user_initiated_interaction_count, code_generation_activity_count,
 *         code_acceptance_activity_count, loc_added_sum, loc_deleted_sum,
 *         loc_suggested_to_add_sum, ai_credits_used, used_* flags, totals_by_*.
 *       Token: classic `read:org` (or fine-grained org "Copilot metrics: read").
 *   GET /orgs/{org}/copilot/metrics/reports/organization-28-day/latest  (key verification)
 *   GET /organizations/{org}/settings/billing/usage?year=&month=
 *       → usageItems[{date, product, sku, quantity, unitType, pricePerUnit,
 *         grossAmount, discountAmount, netAmount, …}] — org-level only; Copilot
 *         items are kept as a '(organization)' spend row per day. Needs org
 *         admin / billing read; a 403/404 here is a warning, not a failure.
 *   Headers: Authorization: Bearer, Accept: application/vnd.github+json,
 *   X-GitHub-Api-Version: 2026-03-10.
 * Docs (verified 2026-09-29): docs.github.com/en/rest/copilot/copilot-usage-metrics,
 *   docs.github.com/en/copilot/reference/copilot-usage-metrics/copilot-usage-metrics,
 *   docs.github.com/en/rest/billing/usage
 * UNVERIFIED: exact NDJSON line layout of downloaded reports (we accept NDJSON or a JSON array);
 *   per-user dollar cost (ai_credits_used is kept in raw, not priced).
 *
 * GITHUB_API_BASE_URL overrides the host — local mock tests only.
 */
import { request } from './http'
import { ConnectorApiError, daysIn, emptyRow, int, mergeToolRows, num, str, ORG_USER_KEY, type CodingToolRow, type FetchWindow } from './types'

export const githubBaseUrl = () => (process.env.GITHUB_API_BASE_URL || 'https://api.github.com').replace(/\/+$/, '')
export const githubHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2026-03-10',
})
export const GITHUB_TOKEN_RE = /^(github_pat_[A-Za-z0-9_]{20,255}|gh[pousr]_[A-Za-z0-9]{20,255})$/
export const GITHUB_ORG_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/

const DAY_CONCURRENCY = 4
type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? v as Obj : {})

export interface FetchResult { rows: CodingToolRow[]; warnings: string[] }

/** Parse an NDJSON (or JSON array) users-1-day report file. */
export function parseCopilotUserReport(text: string, fallbackDay: string): CodingToolRow[] {
  let records: unknown[] = []
  const t = text.trim()
  if (t.startsWith('[')) { try { records = JSON.parse(t) } catch { records = [] } }
  else records = t.split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } })
  const rows: CodingToolRow[] = []
  for (const rec of records) {
    const u = obj(rec)
    const login = str(u.user_login).trim().toLowerCase()
    if (!login) continue
    const day = /^\d{4}-\d{2}-\d{2}$/.test(str(u.day)) ? str(u.day) : fallbackDay
    const r = emptyRow(day, `github:${login}`)
    r.requests      = int(u.user_initiated_interaction_count)
    r.accepted      = int(u.code_acceptance_activity_count)
    r.suggested     = int(u.code_generation_activity_count)
    r.lines_added   = int(u.loc_added_sum)
    r.lines_removed = int(u.loc_deleted_sum)
    const flags: Obj = {}
    for (const [k, v] of Object.entries(u)) if (k.startsWith('used_') && typeof v === 'boolean') flags[k] = v
    r.raw = { user_id: u.user_id ?? null, ai_credits_used: num(u.ai_credits_used), loc_suggested_to_add_sum: int(u.loc_suggested_to_add_sum), ...flags }
    rows.push(r)
  }
  return rows
}

/** Copilot line items from the billing usage report → one org-level row per day. */
export function parseCopilotBilling(json: unknown, days: Set<string>): CodingToolRow[] {
  const rows: CodingToolRow[] = []
  for (const it of (obj(json).usageItems as unknown[] | undefined) ?? []) {
    const i = obj(it)
    if (!str(i.product).toLowerCase().includes('copilot')) continue
    const day = str(i.date).slice(0, 10)
    if (!days.has(day)) continue
    const r = emptyRow(day, ORG_USER_KEY)
    r.cost_usd = num(i.netAmount)
    r.raw = { sku: str(i.sku), quantity: num(i.quantity), unitType: str(i.unitType), grossAmount: num(i.grossAmount), discountAmount: num(i.discountAmount) }
    rows.push(r)
  }
  return rows
}

async function fetchUserDay(token: string, org: string, day: string): Promise<CodingToolRow[]> {
  let res
  try {
    res = await request('github_copilot', `${githubBaseUrl()}/orgs/${encodeURIComponent(org)}/copilot/metrics/reports/users-1-day?day=${day}`,
      { headers: githubHeaders(token), secret: token })
  } catch (e) {
    if (e instanceof ConnectorApiError && e.status === 404) return []   // no report for that day
    throw e
  }
  if (res.status === 204) return []
  const links = (obj(res.body).download_links as unknown[] | undefined)?.filter((l): l is string => typeof l === 'string') ?? []
  const out: CodingToolRow[] = []
  for (const link of links) {
    // Signed links are https; plain http is only allowed against a local test mock.
    if (!link.startsWith('https://') && !(process.env.GITHUB_API_BASE_URL && link.startsWith('http://127.0.0.1'))) continue
    // Pre-signed URL: never send the GitHub token to the storage host.
    const f = await request('github_copilot', link, { follow: true, parseJson: false, secret: token })
    out.push(...parseCopilotUserReport(f.text, day))
  }
  return out
}

export async function fetchCopilotUsage(token: string, org: string, w: FetchWindow): Promise<FetchResult> {
  const days = daysIn(w)
  const warnings: string[] = []
  const all: CodingToolRow[] = []
  for (let i = 0; i < days.length; i += DAY_CONCURRENCY) {
    const batch = await Promise.all(days.slice(i, i + DAY_CONCURRENCY).map(d => fetchUserDay(token, org, d)))
    for (const b of batch) all.push(...b)
  }

  // Billing: one request per calendar month in the window.
  const months = Array.from(new Set(days.map(d => d.slice(0, 7))))
  const daySet = new Set(days)
  for (const ym of months) {
    const [y, m] = ym.split('-')
    try {
      const r = await request('github_copilot', `${githubBaseUrl()}/organizations/${encodeURIComponent(org)}/settings/billing/usage?year=${+y}&month=${+m}`,
        { headers: githubHeaders(token), secret: token })
      // Only this month's days: never double-count if the API ignores the month filter.
      all.push(...parseCopilotBilling(r.body, new Set(Array.from(daySet).filter(d => d.startsWith(ym)))))
    } catch (e) {
      if (e instanceof ConnectorApiError && (e.status === 403 || e.status === 404)) {
        warnings.push('Copilot billing not readable with this token (needs org admin billing access) — spend shows $0.')
        break
      }
      throw e
    }
  }
  return { rows: mergeToolRows(all), warnings }
}

export async function verifyCopilotToken(token: string, org: string): Promise<void> {
  await request('github_copilot', `${githubBaseUrl()}/orgs/${encodeURIComponent(org)}/copilot/metrics/reports/organization-28-day/latest`,
    { headers: githubHeaders(token), secret: token })
}
