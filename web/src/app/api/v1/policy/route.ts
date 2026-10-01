import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { lookupApiKey } from '@/lib/api/auth'
import { keyCanIngest, keyCanRead } from '@/lib/rbac'
import { getPolicy, POLICY_TTL_SECONDS } from '@/lib/policy'
import { TtlCache } from '@/lib/cache'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'

// One policy_fetches write per key per TTL per instance — enough to show
// "picked up by N SDKs" without a write on every poll.
const touched = new TtlCache<string, true>(10_000, POLICY_TTL_SECONDS * 1000)

/**
 * GET /api/v1/policy — the model routes / blocks the SDK wrappers enforce.
 * Auth: Bearer API key with the read OR ingest scope (the key an app already
 * has for ingest works). Response: {routes:[{from,to,match}], blocked_models, version, ttl_seconds}.
 * Cached 60 s; honours If-None-Match (304) with the version as ETag.
 */
export async function GET(req: NextRequest) {
  const r = await lookupApiKey(req)
  if (r.status !== 'ok') {
    return NextResponse.json({ error: r.status === 'none' ? 'Bearer API key required' : 'Invalid or expired API key' }, {
      status: 401, headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
    })
  }
  if (!keyCanRead(r.key.scopes) && !keyCanIngest(r.key.scopes)) {
    return NextResponse.json({ error: 'Forbidden', reason: 'API key needs the read or ingest scope' }, { status: 403 })
  }
  const admin = createAdminClient()
  let policy
  try {
    policy = await getPolicy(admin, r.key.orgId)
  } catch (e) {
    log.error('policy load failed', { route: '/api/v1/policy', org_id: r.key.orgId, err: e })
    // SDKs fail open; tell them to retry soon.
    return NextResponse.json({ error: 'temporarily unavailable' }, { status: 503, headers: { 'Retry-After': '30' } })
  }

  if (!touched.has(r.key.keyId)) {
    touched.set(r.key.keyId, true)
    const ua = (req.headers.get('user-agent') ?? '').slice(0, 200)
    void admin.rpc('policy_fetch_touch', { p_org: r.key.orgId, p_key: r.key.keyId, p_version: policy.version, p_ua: ua })
      .then(({ error }) => { if (error) log.warn('policy fetch not recorded', { err: error.message }) })
  }

  const etag = `"${policy.version}"`
  const headers = { ETag: etag, 'Cache-Control': `private, max-age=${POLICY_TTL_SECONDS}` }
  if (req.headers.get('if-none-match') === etag) return new NextResponse(null, { status: 304, headers })
  return NextResponse.json(policy, { headers })
}
