import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { syncAll } from '@/lib/billing-sync/sync'
import crypto from 'crypto'
import { withJobRun } from '@/lib/jobs'
import { log } from '@/lib/log'

const ROUTE = '/api/v1/cron/reconcile'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/v1/cron/reconcile — daily provider bill sync. For every connected
 * Anthropic / OpenAI admin key, pulls the last 35 days of provider-reported
 * costs into provider_costs. Protected by CRON_SECRET (fail closed).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const expected = Buffer.from(`Bearer ${secret}`)
  const given    = Buffer.from(req.headers.get('authorization') || '')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  return withJobRun('reconcile', async () => {
    try {
      const results = await syncAll(createAdminClient())
      return NextResponse.json({
        ok: true,
        connections: results.length,
        synced: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).map(r => ({ org_id: r.orgId, provider: r.provider, error: r.error })),
      })
    } catch (e) {
      log.error('sync failed', { route: ROUTE, err: e })
      return NextResponse.json({ error: 'reconcile failed' }, { status: 500 })
    }
  }, { route: ROUTE })
}
