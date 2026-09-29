/**
 * Cursor Admin API (team admin API key; read-only endpoints only).
 *   Base https://api.cursor.com, HTTP Basic auth with the API key as username.
 *   POST /teams/daily-usage-data   {startDate, endDate (epoch ms), page, pageSize ≤ 500}
 *        → data[{userId, day, date, email, isActive, acceptedLinesAdded, acceptedLinesDeleted,
 *          totalLinesAdded, totalLinesDeleted, totalApplies, totalAccepts, totalRejects,
 *          totalTabsShown, totalTabsAccepted, composerRequests, chatRequests, agentRequests,
 *          cmdkUsages, bugbotUsages, subscriptionIncludedReqs, apiKeyReqs, usageBasedReqs, mostUsedModel}],
 *          pagination{page, pageSize, totalPages, hasNextPage}
 *   POST /teams/filtered-usage-events {startDate, endDate, page, pageSize ≤ 1000}
 *        → usageEvents[{timestamp (epoch-ms string), userEmail, model, kind, isChargeable,
 *          tokenUsage{inputTokens, outputTokens, totalCents}, chargedCents}], pagination{numPages, currentPage, hasNextPage}
 *   GET  /teams/members → teamMembers[…]  (used to verify the key)
 *   Date range per request ≤ 30 days. Rate limits 20/min (daily usage), 60/min (events).
 * Docs (verified 2026-09-29): https://cursor.com/docs/account/teams/admin-api
 * UNVERIFIED: whether chargedCents includes included-in-plan requests (treated as billed amount).
 *
 * CURSOR_API_BASE_URL overrides the host — local mock tests only.
 */
import { ConnectorApiError, emptyRow, int, lowerEmail, mergeToolRows, num, str, utcDay, type CodingToolRow, type FetchWindow } from './types'
import { request, sleep } from './http'

const baseUrl = () => (process.env.CURSOR_API_BASE_URL || 'https://api.cursor.com').replace(/\/+$/, '')
const auth = (key: string) => ({ Authorization: 'Basic ' + Buffer.from(`${key}:`).toString('base64') })
const CHUNK_DAYS = 28
const MAX_PAGES = 100
const MAX_RETRIES = 3
/** Back-off base for 429s (tests shrink it). */
export const cursorRetry = { baseMs: 3_000 }

export const CURSOR_KEY_RE = /^[A-Za-z0-9_\-.]{20,256}$/

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? v as Obj : {})

/** POST with Retry-After aware retry on 429. */
async function post(key: string, path: string, body: unknown): Promise<Obj> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await request('cursor', `${baseUrl()}${path}`, { method: 'POST', headers: auth(key), json: body, secret: key })
      return obj(r.body)
    } catch (e) {
      if (!(e instanceof ConnectorApiError) || e.status !== 429 || attempt >= MAX_RETRIES) throw e
      await sleep(Math.min(30_000, (attempt + 1) * cursorRetry.baseMs))
    }
  }
}

/** Split [start,end) into ≤ CHUNK_DAYS windows (the API rejects > 30 days). */
export function chunkWindow(w: FetchWindow, days = CHUNK_DAYS): FetchWindow[] {
  const out: FetchWindow[] = []
  for (let t = w.start.getTime(); t < w.end.getTime(); t += days * 86400_000) {
    out.push({ start: new Date(t), end: new Date(Math.min(w.end.getTime(), t + days * 86400_000)) })
  }
  return out
}

const userKey = (email: unknown, id: unknown) => lowerEmail(email) || (str(id) ? `cursor:${str(id)}` : 'unknown')

export function parseCursorDailyUsage(json: unknown): CodingToolRow[] {
  const rows: CodingToolRow[] = []
  for (const d of (obj(json).data as unknown[] | undefined) ?? []) {
    const r0 = obj(d)
    const day = /^\d{4}-\d{2}-\d{2}$/.test(str(r0.day)) ? str(r0.day) : r0.date ? utcDay(num(r0.date)) : ''
    if (!day) continue
    const requests = int(r0.composerRequests) + int(r0.chatRequests) + int(r0.agentRequests) + int(r0.cmdkUsages) + int(r0.bugbotUsages)
    const accepted = int(r0.totalAccepts) + int(r0.totalTabsAccepted)
    const suggested = int(r0.totalAccepts) + int(r0.totalRejects) + int(r0.totalTabsShown)
    const lines = int(r0.acceptedLinesAdded) + int(r0.acceptedLinesDeleted)
    if (!r0.isActive && requests === 0 && suggested === 0 && lines === 0) continue
    const r = emptyRow(day, userKey(r0.email, r0.userId))
    r.requests      = requests
    r.lines_added   = int(r0.acceptedLinesAdded)
    r.lines_removed = int(r0.acceptedLinesDeleted)
    r.accepted      = accepted
    r.suggested     = suggested
    r.raw = {
      totalLinesAdded: int(r0.totalLinesAdded), totalLinesDeleted: int(r0.totalLinesDeleted),
      subscriptionIncludedReqs: int(r0.subscriptionIncludedReqs), apiKeyReqs: int(r0.apiKeyReqs),
      usageBasedReqs: int(r0.usageBasedReqs), mostUsedModel: str(r0.mostUsedModel) || null,
    }
    rows.push(r)
  }
  return rows
}

export function parseCursorUsageEvents(json: unknown): CodingToolRow[] {
  const rows: CodingToolRow[] = []
  for (const e of (obj(json).usageEvents as unknown[] | undefined) ?? []) {
    const ev = obj(e)
    const ts = num(ev.timestamp)
    if (!ts) continue
    const tok = obj(ev.tokenUsage)
    const r = emptyRow(utcDay(ts), userKey(ev.userEmail, ev.userId), str(ev.model) || 'unknown')
    r.requests      = 1
    r.input_tokens  = int(tok.inputTokens ?? ev.inputTokens) + int(tok.cacheWriteTokens ?? ev.cacheWriteTokens)
    r.output_tokens = int(tok.outputTokens ?? ev.outputTokens)
    const cents     = ev.chargedCents !== undefined ? num(ev.chargedCents) : num(tok.totalCents ?? ev.totalCents)
    r.cost_usd      = cents / 100
    r.raw           = { kind: str(ev.kind) }
    rows.push(r)
  }
  return rows
}

async function pagedPost(key: string, path: string, w: FetchWindow, pageSize: number, parse: (j: unknown) => CodingToolRow[]): Promise<CodingToolRow[]> {
  const out: CodingToolRow[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = await post(key, path, { startDate: w.start.getTime(), endDate: w.end.getTime() - 1, page, pageSize })
    out.push(...parse(json))
    const p = obj(json.pagination)
    const total = int(p.totalPages ?? p.numPages)
    if (!(p.hasNextPage === true || (total > 0 && page < total))) break
  }
  return out
}

export async function fetchCursorUsage(key: string, w: FetchWindow): Promise<CodingToolRow[]> {
  const all: CodingToolRow[] = []
  for (const cw of chunkWindow(w)) {
    all.push(...await pagedPost(key, '/teams/daily-usage-data', cw, 500, parseCursorDailyUsage))
    all.push(...await pagedPost(key, '/teams/filtered-usage-events', cw, 1000, parseCursorUsageEvents))
  }
  return mergeToolRows(all)
}

export async function verifyCursorKey(key: string): Promise<void> {
  await request('cursor', `${baseUrl()}/teams/members`, { headers: auth(key), secret: key })
}
