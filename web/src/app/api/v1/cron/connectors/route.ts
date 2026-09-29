import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { syncAllConnectors } from '@/lib/connectors/sync'
import { withJobRun } from '@/lib/jobs'
import { log } from '@/lib/log'

const ROUTE = '/api/v1/cron/connectors'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/v1/cron/connectors — daily pull of coding-tool usage (Claude Code
 * Analytics, Cursor, GitHub Copilot; last 35 days) and GitHub merged PRs (last
 * 60 days) for every connected org. Protected by CRON_SECRET (fail closed).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const expected = Buffer.from(`Bearer ${secret}`)
  const given    = Buffer.from(req.headers.get('authorization') || '')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  return withJobRun('connectors', async () => {
    try {
      const results = await syncAllConnectors(createAdminClient())
      return NextResponse.json({
        ok: true,
        connections: results.length,
        synced: results.filter(r => r.ok).length,
        rows: results.reduce((s, r) => s + r.rows, 0),
        failed: results.filter(r => !r.ok).map(r => ({ org_id: r.orgId, provider: r.provider, error: r.error })),
      })
    } catch (e) {
      log.error('sync failed', { route: ROUTE, err: e })
      return NextResponse.json({ error: 'connector sync failed' }, { status: 500 })
    }
  }, { route: ROUTE })
}
