import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { log } from '@/lib/log'
import pkg from '../../../../package.json'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health — unauthenticated liveness + readiness probe.
 *
 *   200 { ok: true,  db: <latency_ms>, version: "0.1.0", migrations: 17 }
 *   503 { ok: false, db: null,         version: "0.1.0", migrations: null }
 *
 * `migrations` is the highest migration whose sentinel object exists (via the
 * service-role-only tf_schema_probe() from 017); null when undetectable (e.g.
 * 017 not applied yet). Results are cached in-process for 10s and sent with
 * Cache-Control: max-age=10, so load balancers polling every second cost at
 * most one DB round trip per 10s per instance. Never exposes errors, hosts or env.
 */

// One object per migration that created something detectable; add new ones here.
// 'table' | 'table.column' | 'function()'
const SENTINELS: [number, string][] = [
  [4,  'org_integrations'],
  [6,  'organizations.retention_days'],
  [7,  'productivity_daily'],
  [8,  'provider_costs'],
  [9,  'digest_runs'],
  [10, 'audit_log'],
  [11, 'usage_daily'],
  [12, 'api_keys.kind'],
  [13, 'coding_tool_usage'],
  [14, 'price_sync_findings'],
  [17, 'job_runs'],
  [18, 'spans.span_kind'],
]

const TTL_MS = 10_000
interface Health { ok: boolean; db: number | null; version: string; migrations: number | null }
let cached: { at: number; body: Health } | null = null
let inflight: Promise<Health> | null = null

async function probe(): Promise<Health> {
  const version = String((pkg as { version?: string }).version ?? 'unknown')
  let db: number | null = null
  let migrations: number | null = null
  try {
    const admin = createAdminClient()
    const t0 = performance.now()
    const { data, error } = await admin.rpc('tf_schema_probe', { p_names: SENTINELS.map(s => s[1]) })
    if (!error) {
      db = Math.round(performance.now() - t0)
      const present = new Set((data ?? []) as string[])
      for (const [n, name] of SENTINELS) if (present.has(name)) migrations = Math.max(migrations ?? 0, n)
    } else {
      // 017 not applied (function missing) — still measure DB reachability.
      const t1 = performance.now()
      const { error: e2 } = await admin.from('organizations').select('id', { head: true }).limit(1)
      if (!e2) db = Math.round(performance.now() - t1)
      else log.warn('health db probe failed', { route: '/api/health', err: e2 })
    }
  } catch (e) {
    log.warn('health db probe failed', { route: '/api/health', err: e })
  }
  return { ok: db !== null, db, version, migrations }
}

export async function GET() {
  const now = Date.now()
  if (!cached || now - cached.at >= TTL_MS) {
    // Share one in-flight probe between concurrent requests.
    inflight ??= probe().finally(() => { inflight = null })
    cached = { at: now, body: await inflight }
  }
  const age = Math.floor((now - cached.at) / 1000)
  return NextResponse.json(cached.body, {
    status: cached.body.ok ? 200 : 503,
    headers: { 'Cache-Control': `public, max-age=${Math.max(0, 10 - age)}`, 'X-Robots-Tag': 'noindex' },
  })
}
