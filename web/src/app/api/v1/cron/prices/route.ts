import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { LITELLM_PRICES_URL } from '@/lib/price-sync/compare'
import { runPriceSync } from '@/lib/price-sync/run'
import { withJobRun } from '@/lib/jobs'
import { log } from '@/lib/log'

const ROUTE = '/api/v1/cron/prices'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_BYTES = 15 * 1024 * 1024

/**
 * GET /api/v1/cron/prices — nightly price catalog sync. Compares
 * lib/mcp/pricing.ts with LiteLLM's public price list and records mismatches
 * and unpriced models seen in the last 7 days (price_sync_findings), notifying
 * affected workspaces' admins once per finding. Fail-closed on CRON_SECRET.
 *
 * Source: PRICE_SYNC_SOURCE_URL (default: LiteLLM on GitHub raw). Outside
 * production, `?source=fixture` uses the bundled test fixture instead.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const expected = Buffer.from(`Bearer ${secret}`)
  const given    = Buffer.from(req.headers.get('authorization') || '')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  return withJobRun('prices', async () => {
    let source: unknown
    const useFixture = req.nextUrl.searchParams.get('source') === 'fixture' && process.env.NODE_ENV !== 'production'
    try {
      if (useFixture) {
        source = (await import('@/lib/price-sync/fixtures/litellm-sample.json')).default
      } else {
        const url = process.env.PRICE_SYNC_SOURCE_URL || LITELLM_PRICES_URL
        const res = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: 'follow', cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const text = await res.text()
        if (text.length > MAX_BYTES) throw new Error('source too large')
        source = JSON.parse(text)
      }
    } catch (e) {
      log.error('fetch source failed', { route: ROUTE, err: e })
      return NextResponse.json({ error: 'price source unavailable' }, { status: 502 })
    }

    try {
      const result = await runPriceSync(createAdminClient(), source)
      return NextResponse.json({ ok: true, source: useFixture ? 'fixture' : 'litellm', ...result })
    } catch (e) {
      log.error('sync failed', { route: ROUTE, err: e })
      return NextResponse.json({ error: 'sync failed' }, { status: 500 })
    }
  }, { route: ROUTE })
}
