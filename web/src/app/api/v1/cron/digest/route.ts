import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { runDigestForOrg, type DigestResult } from '@/lib/digest/run'
import crypto from 'crypto'
import { withJobRun } from '@/lib/jobs'
import { log } from '@/lib/log'

const ROUTE = '/api/v1/cron/digest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/v1/cron/digest — weekly digest for every org (last complete ISO
 * week vs the one before). Scheduled Mondays. Idempotent per org per week
 * (digest_runs), so re-runs and overlapping schedulers never double-send.
 * Protected by CRON_SECRET (fail closed). Optional ?org=<uuid> to scope a run.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const expected = Buffer.from(`Bearer ${secret}`)
  const given    = Buffer.from(req.headers.get('authorization') || '')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  return withJobRun('digest', async () => {
    const admin = createAdminClient()
    const orgFilter = req.nextUrl.searchParams.get('org')
    let q = admin.from('organizations').select('id')
    if (orgFilter) q = q.eq('id', orgFilter)
    const { data: orgs, error } = await q
    if (error) {
      log.error('org list failed', { route: ROUTE, err: error })
      return NextResponse.json({ error: 'org list failed' }, { status: 500 })
    }

    const emailByUser = new Map<string, string>()
    try {
      for (let page = 1; page <= 50; page++) {
        const { data: list } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
        const users = list?.users ?? []
        for (const u of users) if (u.email) emailByUser.set(u.id, u.email)
        if (users.length < 1000) break
      }
    } catch {}

    const results: DigestResult[] = []
    for (const { id } of (orgs ?? []) as { id: string }[]) {
      try { results.push(await runDigestForOrg(admin, id, emailByUser)) }
      catch (e) { results.push({ org_id: id, week: '', status: 'error', error: (e as Error).message }) }
    }

    const count = (s: DigestResult['status']) => results.filter(r => r.status === s).length
    return NextResponse.json({
      orgs: results.length, sent: count('sent'), already_sent: count('already_sent'),
      empty: count('empty'), errors: count('error'),
      results: results.filter(r => r.status !== 'empty'),
    })
  }, { route: ROUTE })
}
