import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/v1/cron/retention — daily purge. Deletes monitoring data older than
 * each org's Settings → Data retention, plus expired prompt text and
 * compression cache. Protected by CRON_SECRET (Vercel Cron sends it).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const expected = Buffer.from(`Bearer ${secret}`)
  const given    = Buffer.from(req.headers.get('authorization') || '')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data, error } = await createAdminClient().rpc('purge_expired_data')
  if (error) {
    console.error('[cron/retention] purge failed:', error.message)
    return NextResponse.json({ error: 'purge failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, purged: data })
}
