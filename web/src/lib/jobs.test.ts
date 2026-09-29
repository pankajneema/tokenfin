import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn(() => { throw new Error('no env') }), createClient: vi.fn() }))
vi.mock('@/lib/monitoring', () => ({ captureException: vi.fn(async () => null) }))

import { withJobRun, summarize } from './jobs'
import { captureException } from '@/lib/monitoring'

function fakeDb(opts: { startError?: boolean } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const db = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      if (fn === 'job_run_start') return opts.startError ? { data: null, error: { message: 'function missing', code: '42883' } } : { data: 41, error: null }
      return { data: null, error: null }
    }),
  }
  return { db: db as never, calls }
}

describe('withJobRun', () => {
  beforeEach(() => { vi.mocked(captureException).mockClear(); vi.spyOn(process.stdout, 'write').mockImplementation(() => true); vi.spyOn(process.stderr, 'write').mockImplementation(() => true) })

  it('records a successful run with its JSON summary', async () => {
    const { db, calls } = fakeDb()
    const res = await withJobRun('retention', async () => Response.json({ ok: true, purged: { usage_events: 3 } }), { db })
    expect(res.status).toBe(200)
    expect(calls.map(c => c.fn)).toEqual(['job_run_start', 'job_run_finish'])
    expect(calls[0].args).toEqual({ p_job: 'retention' })
    expect(calls[1].args).toEqual({ p_id: 41, p_ok: true, p_summary: { status: 200, ok: true, purged: { usage_events: 3 } }, p_error: null })
    expect(captureException).not.toHaveBeenCalled()
  })

  it('records a failing response and reports it', async () => {
    const { db, calls } = fakeDb()
    const res = await withJobRun('reconcile', async () => Response.json({ error: 'reconcile failed' }, { status: 500 }), { db })
    expect(res.status).toBe(500)
    expect(calls[1].args).toMatchObject({ p_ok: false, p_error: 'reconcile failed' })
    expect(captureException).toHaveBeenCalledOnce()
  })

  it('turns a thrown error into a generic 500 and records it', async () => {
    const { db, calls } = fakeDb()
    const res = await withJobRun('digest', async () => { throw new Error('db exploded at 10.0.0.5') }, { db })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'digest job failed' })     // no internals leak
    expect(calls[1].args).toMatchObject({ p_ok: false, p_error: 'Error: db exploded at 10.0.0.5' })
    expect(captureException).toHaveBeenCalledOnce()
  })

  it('still runs the job when recording is unavailable', async () => {
    const { db, calls } = fakeDb({ startError: true })
    const res = await withJobRun('alerts', async () => Response.json({ evaluated: 0 }), { db })
    expect(res.status).toBe(200)
    expect(calls.map(c => c.fn)).toEqual(['job_run_start'])            // no finish without an id
    const noDb = await withJobRun('alerts', async () => Response.json({ evaluated: 1 }))  // createAdminClient throws
    expect(noDb.status).toBe(200)
  })
})

describe('summarize', () => {
  it('keeps scalars and drops bulky arrays when too large, and scrubs secrets', async () => {
    const big = { orgs: 3, sent: 1, results: Array.from({ length: 50 }, (_, i) => ({ org_id: `o${i}`, note: 'x'.repeat(1000) })) }
    const { summary } = await summarize(Response.json(big))
    expect(summary).toEqual({ status: 200, truncated: true, orgs: 3, sent: 1 })
    const s2 = await summarize(Response.json({ ok: true, api_key: 'tfk_live_x' }))
    expect(s2.summary).toEqual({ status: 200, ok: true, api_key: '[redacted]' })
    const s3 = await summarize(new Response('not json', { status: 502 }))
    expect(s3).toEqual({ summary: { status: 502 }, error: 'HTTP 502' })
  })
})
