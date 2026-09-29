/**
 * withJobRun — records every scheduled job run in `job_runs` (migration 017),
 * logs it as structured JSON (lib/log) and reports failures (lib/monitoring).
 *
 *   export async function GET(req) {
 *     ...CRON_SECRET check (unchanged, fail closed)...
 *     return withJobRun('retention', async () => NextResponse.json({ ok: true }))
 *   }
 *
 * - The run row is inserted before `fn` starts (job_run_start also prunes rows
 *   older than 30 days) and finished afterwards with ok/duration/summary/error.
 * - ok = the returned Response has status < 400. The JSON body (≤16 KB) is the
 *   summary; the `error` field of a failing response becomes the run's error.
 * - If `fn` throws, the run is recorded as failed, the error is logged and sent
 *   to Sentry (when configured), and a generic 500 JSON is returned — no stack
 *   or DB detail ever reaches the caller.
 * - Recording is best effort: a missing table (017 not applied) or a DB blip
 *   never breaks the job itself.
 *
 * Server-only.
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/server'
import { log, sanitize, serializeError } from '@/lib/log'
import { captureException } from '@/lib/monitoring'

export const JOB_NAMES = ['alerts', 'retention', 'digest', 'reconcile', 'connectors', 'prices'] as const
export type JobName = typeof JOB_NAMES[number] | (string & {})

const MAX_SUMMARY_BYTES = 16 * 1024

type Recorder = Pick<SupabaseClient, 'rpc'>

/** Extracts a compact, scrubbed summary + error text from a job's JSON response. */
export async function summarize(res: Response): Promise<{ summary: Record<string, unknown> | null; error: string | null }> {
  let body: unknown = null
  try {
    const text = await res.clone().text()
    body = text ? JSON.parse(text) : null
  } catch { body = null }
  const obj = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
  let summary: Record<string, unknown> | null = obj ? sanitize(obj) as Record<string, unknown> : null
  if (summary && JSON.stringify(summary).length > MAX_SUMMARY_BYTES) {
    // Keep scalar counters, drop the bulky per-org arrays.
    const small: Record<string, unknown> = { truncated: true }
    for (const [k, v] of Object.entries(summary)) if (v === null || typeof v !== 'object') small[k] = v
    summary = small
  }
  const error = res.status >= 400
    ? (obj && typeof obj.error === 'string' ? obj.error : `HTTP ${res.status}`)
    : null
  return { summary: summary ? { status: res.status, ...summary } : { status: res.status }, error }
}

async function start(db: Recorder, job: string): Promise<number | null> {
  try {
    const { data, error } = await db.rpc('job_run_start', { p_job: job })
    if (error) { log.warn('job_runs start failed', { job, err: error }); return null }
    return typeof data === 'number' ? data : data != null ? Number(data) : null
  } catch (e) { log.warn('job_runs start failed', { job, err: e }); return null }
}

async function finish(db: Recorder, id: number | null, job: string, ok: boolean, summary: unknown, error: string | null) {
  if (id == null) return
  try {
    const { error: err } = await db.rpc('job_run_finish', { p_id: id, p_ok: ok, p_summary: summary ?? null, p_error: error })
    if (err) log.warn('job_runs finish failed', { job, err })
  } catch (e) { log.warn('job_runs finish failed', { job, err: e }) }
}

export async function withJobRun(
  job: JobName,
  fn: () => Promise<Response>,
  opts: { db?: Recorder; route?: string } = {},
): Promise<Response> {
  const route = opts.route ?? `/api/v1/cron/${job}`
  let db: Recorder | null = opts.db ?? null
  if (!db) { try { db = createAdminClient() } catch { db = null } }
  const t0 = Date.now()
  const id = db ? await start(db, job) : null
  log.info('job started', { route, job, run_id: id })

  try {
    const res = await fn()
    const duration_ms = Date.now() - t0
    const { summary, error } = await summarize(res)
    const ok = res.status < 400
    if (db) await finish(db, id, job, ok, summary, error)
    if (ok) log.info('job finished', { route, job, run_id: id, duration_ms, ok, summary })
    else {
      log.error('job failed', { route, job, run_id: id, duration_ms, ok, status: res.status, error })
      await captureException(new Error(`cron ${job} failed: ${error}`), { tags: { job, route, status: res.status } })
    }
    return res
  } catch (e) {
    const duration_ms = Date.now() - t0
    const se = serializeError(e)
    if (db) await finish(db, id, job, false, { status: 500 }, `${se.name}: ${se.message}`)
    log.error('job crashed', { route, job, run_id: id, duration_ms, ok: false, err: e })
    await captureException(e, { tags: { job, route } })
    return NextResponse.json({ error: `${job} job failed` }, { status: 500 })
  }
}
