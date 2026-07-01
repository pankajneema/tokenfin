/**
 * POST /api/v1/ingest
 *
 * Primary path: proxy to Go ingest service (INGEST_SERVICE_URL).
 * Fallback path: when Go service is unavailable, write directly to Supabase.
 *
 * Auth: Bearer <api_key>  (key stored hashed in api_keys table)
 *
 * Body: {
 *   model:         string   — e.g. "claude-sonnet-4-6"
 *   input_tokens:  number
 *   output_tokens: number
 *   cost_usd?:     number   — auto-computed if omitted
 *   project_id?:   string
 *   tags?:         Record<string,string>
 *   metadata?:     Record<string,unknown>
 * }
 */
import { NextResponse }                       from 'next/server'
import type { NextRequest }                   from 'next/server'
import { createAdminClient }                  from '@/lib/supabase/server'
import { rateLimit, rateLimitResponse }       from '@/lib/ratelimit'
import crypto                                 from 'crypto'

/* ── Pricing (per 1M tokens) ── */
const PRICE: Record<string, { in: number; out: number }> = {
  'claude-opus-4-8':              { in: 15.00, out: 75.00 },
  'claude-sonnet-4-6':            { in:  3.00, out: 15.00 },
  'claude-haiku-4-5-20251001':    { in:  0.80, out:  4.00 },
  'claude-haiku-4-5':             { in:  0.80, out:  4.00 },
  'gpt-4o':                       { in:  2.50, out: 10.00 },
  'gpt-4o-mini':                  { in:  0.15, out:  0.60 },
  'gpt-4-turbo':                  { in: 10.00, out: 30.00 },
  'gpt-3.5-turbo':                { in:  0.50, out:  1.50 },
  'gemini-1.5-pro':               { in:  1.25, out:  5.00 },
  'gemini-1.5-flash':             { in:  0.075, out: 0.30 },
}

function computeCost(model: string, inputTok: number, outputTok: number): number {
  const p = PRICE[model] ?? { in: 2.00, out: 8.00 }
  return (inputTok * p.in + outputTok * p.out) / 1_000_000
}

function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

/* ── Limit-check + notification (fire-and-forget after each ingest) ──────────
 * Reads active monthly org limits, compares against current-month spend, and
 * inserts a warning or alert notification if a threshold is crossed.
 * Deduplicates: only one notification per org per type per calendar day.
 * Called non-blocking — never delays or fails the ingest response.
 * ─────────────────────────────────────────────────────────────────────────── */
async function checkLimitsAndNotify(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string
): Promise<void> {
  // Fetch active monthly org-scoped limits
  const { data: limits } = await admin
    .from('limits')
    .select('budget_usd, warn_at, block_at')
    .eq('org_id', orgId)
    .eq('scope', 'org')
    .eq('period', 'monthly')
    .eq('is_active', true)

  if (!limits?.length) return

  // Current-month spend from usage_agg
  const monthStart = new Date()
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
  const { data: aggRows } = await admin
    .from('usage_agg')
    .select('cost_usd')
    .eq('org_id', orgId)
    .gte('bucket', monthStart.toISOString().slice(0, 10))

  const totalSpend = (aggRows ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
  const today = new Date().toISOString().slice(0, 10)

  for (const limit of limits) {
    const budget = Number(limit.budget_usd ?? 0)
    if (budget <= 0) continue

    const pct     = (totalSpend / budget) * 100
    const warnAt  = Number(limit.warn_at  ?? 70)
    const blockAt = Number(limit.block_at ?? 100)

    let notifType: string | null = null
    let title = ''
    let body  = ''

    if (pct >= blockAt) {
      notifType = 'alert'
      title     = 'Usage limit reached — requests may be blocked'
      body      = `Monthly spend $${totalSpend.toFixed(2)} has hit ${pct.toFixed(0)}% of your $${budget.toFixed(2)} budget.`
    } else if (pct >= warnAt) {
      notifType = 'warning'
      title     = `Usage warning — ${pct.toFixed(0)}% of monthly budget used`
      body      = `Monthly spend is $${totalSpend.toFixed(2)} (${pct.toFixed(0)}% of $${budget.toFixed(2)} budget).`
    }

    if (!notifType) continue

    // Deduplicate: skip if same type already fired today for this org
    const { data: existing } = await admin
      .from('notifications')
      .select('id')
      .eq('org_id', orgId)
      .eq('type', notifType)
      .gte('created_at', today + 'T00:00:00Z')
      .limit(1)

    if (existing?.length) continue

    await admin.from('notifications').insert({
      org_id:  orgId,
      title,
      body,
      type:    notifType,
      is_read: false,
    })
  }
}

/**
 * Evaluate active monthly org-scoped spend limits and decide whether this
 * request should be allowed, throttled, or blocked.
 *   - spend >= block_at%    → 'block'    (hard stop, 403)
 *   - spend >= throttle_at% → 'throttle' (back-pressure, 429)
 * Returns the worst (highest-severity) decision across all matching limits.
 */
async function evaluateSpendLimit(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string
): Promise<{ action: 'allow' | 'throttle' | 'block'; pct: number; budget: number }> {
  const { data: limits } = await admin
    .from('limits')
    .select('budget_usd, throttle_at, block_at')
    .eq('org_id', orgId)
    .eq('scope', 'org')
    .eq('period', 'monthly')
    .eq('is_active', true)

  if (!limits?.length) return { action: 'allow', pct: 0, budget: 0 }

  const monthStart = new Date()
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
  const { data: aggRows } = await admin
    .from('usage_agg')
    .select('cost_usd')
    .eq('org_id', orgId)
    .gte('bucket', monthStart.toISOString().slice(0, 10))

  const totalSpend = (aggRows ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)

  let action: 'allow' | 'throttle' | 'block' = 'allow'
  let worstPct = 0
  let worstBudget = 0
  const sev = { allow: 0, throttle: 1, block: 2 }

  for (const limit of limits) {
    const budget = Number(limit.budget_usd ?? 0)
    if (budget <= 0) continue
    const pct        = (totalSpend / budget) * 100
    const throttleAt = Number(limit.throttle_at ?? 90)
    const blockAt    = Number(limit.block_at ?? 100)

    let next: 'allow' | 'throttle' | 'block' = 'allow'
    if (pct >= blockAt) next = 'block'
    else if (pct >= throttleAt) next = 'throttle'

    if (sev[next] > sev[action]) action = next
    if (pct > worstPct) { worstPct = pct; worstBudget = budget }
  }

  return { action, pct: worstPct, budget: worstBudget }
}

/* ── Direct Supabase ingest (fallback) ── */
async function directIngest(apiKey: string, body: Record<string, unknown>) {
  const admin = createAdminClient()

  // 1. Look up API key
  const keyHash = hashKey(apiKey)
  const { data: keyRow } = await admin
    .from('api_keys')
    .select('id, org_id, project_id, is_active, expires_at, scopes')
    .eq('key_hash', keyHash)
    .single()

  if (!keyRow)           return NextResponse.json({ error: 'Invalid API key' },    { status: 401 })
  if (!keyRow.is_active) return NextResponse.json({ error: 'API key is inactive' }, { status: 403 })
  if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date())
    return NextResponse.json({ error: 'API key expired' }, { status: 403 })

  // 1b. Scope check — ingest writes usage, so the key must carry a write scope.
  // (Legacy keys with no scopes recorded are allowed through for compatibility.)
  const scopes = (keyRow.scopes as string[] | null) ?? []
  if (scopes.length > 0 && !scopes.includes('write') && !scopes.includes('ingest')) {
    return NextResponse.json(
      { error: 'API key lacks the "write" scope required to ingest usage' },
      { status: 403 }
    )
  }

  // 2. Rate limit — per API key, plan-aware
  const { data: org } = await admin
    .from('orgs')
    .select('plan')
    .eq('id', keyRow.org_id)
    .single()

  const rl = await rateLimit(keyRow.id, org?.plan ?? 'free')
  if (!rl.allowed) return rateLimitResponse(rl)

  // 3. Validate body
  const model       = String(body.model ?? '')
  const inputTok    = Number(body.input_tokens  ?? 0)
  const outputTok   = Number(body.output_tokens ?? 0)
  // Accept total_tokens as fallback when input/output aren't split (e.g. direct SDK usage)
  const totalTokFallback = Number(body.total_tokens ?? 0)
  const totalTok    = inputTok + outputTok > 0
    ? inputTok + outputTok
    : totalTokFallback
  // Derive split from total when only total was provided (70/30 estimate)
  const effectiveInput  = inputTok  > 0 ? inputTok  : Math.round(totalTok * 0.7)
  const effectiveOutput = outputTok > 0 ? outputTok : totalTok - Math.round(totalTok * 0.7)
  const costUsd     = typeof body.cost_usd === 'number' ? body.cost_usd : computeCost(model, effectiveInput, effectiveOutput)
  const projectId   = String(body.project_id ?? keyRow.project_id ?? '')
  const tags        = (body.tags    as Record<string,string>)   ?? {}
  const metadata    = (body.metadata as Record<string,unknown>) ?? {}

  if (!model)         return NextResponse.json({ error: 'model is required' }, { status: 400 })
  if (totalTok <= 0)  return NextResponse.json({ error: 'input_tokens + output_tokens must be > 0' }, { status: 400 })

  const orgId    = keyRow.org_id
  // Use IST (UTC+5:30) for date bucketing so Indian users see correct dates
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
  const bucket = new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10)

  // 3b. Enforce monthly spend limits BEFORE recording the event.
  const limitState = await evaluateSpendLimit(admin, orgId)
  if (limitState.action === 'block') {
    return NextResponse.json(
      { error: 'Monthly spend limit reached — ingestion is blocked', pct: Math.round(limitState.pct) },
      { status: 403 }
    )
  }
  if (limitState.action === 'throttle') {
    return NextResponse.json(
      { error: 'Monthly spend throttle threshold reached — slow down', pct: Math.round(limitState.pct) },
      { status: 429, headers: { 'Retry-After': '60' } }
    )
  }

  // Resolve project_id — usage_events.project_id is NOT NULL.
  // If not provided in body or API key, fall back to the org's first project.
  let resolvedProjectId: string | null = projectId || null
  if (!resolvedProjectId) {
    const { data: firstProject } = await admin
      .from('projects')
      .select('id')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    resolvedProjectId = firstProject?.id ?? null
  }
  if (!resolvedProjectId) {
    return NextResponse.json(
      { error: 'No project found for this org. Create a project in the dashboard first.' },
      { status: 422 }
    )
  }

  // 4. Insert usage event
  const { error: evtErr } = await admin.from('usage_events').insert({
    org_id:        orgId,
    project_id:    resolvedProjectId,
    api_key_id:    keyRow.id,   // attribute usage to the key that sent it
    model,
    input_tokens:  effectiveInput,
    output_tokens: effectiveOutput,
    total_tokens:  totalTok,
    cost_usd:      costUsd,
    tags,
    metadata,
  })
  if (evtErr) {
    console.error('[ingest direct] usage_events insert error:', evtErr)
    return NextResponse.json({ error: 'Failed to record event' }, { status: 500 })
  }

  // 5. Upsert usage_agg
  const { error: aggErr } = await admin.rpc('upsert_usage_agg', {
    p_org_id:        orgId,
    p_project_id:    resolvedProjectId,
    p_model:         model,
    p_bucket:        bucket,
    p_tokens:        totalTok,
    p_cost:          costUsd,
    p_requests:      1,
  })

  // Fallback: increment manually if the RPC is unavailable.
  // NOTE: a plain .upsert() is last-write-wins and would OVERWRITE the day's
  // running totals — so we read the existing row and add to it instead.
  if (aggErr) {
    console.error('[ingest direct] upsert_usage_agg RPC failed, using fallback:', aggErr)
    const { data: existing } = await admin
      .from('usage_agg')
      .select('total_tokens, cost_usd, request_count')
      .eq('org_id', orgId)
      .eq('project_id', resolvedProjectId)
      .eq('model', model)
      .eq('bucket', bucket)
      .maybeSingle()

    await admin.from('usage_agg').upsert({
      org_id:        orgId,
      project_id:    resolvedProjectId,
      model,
      bucket,
      total_tokens:  (existing?.total_tokens  ?? 0) + totalTok,
      cost_usd:      (existing?.cost_usd       ?? 0) + costUsd,
      request_count: (existing?.request_count ?? 0) + 1,
    }, {
      onConflict: 'org_id,project_id,model,bucket',
      ignoreDuplicates: false,
    })
  }

  // 6. Update last_used_at on key
  await admin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id)

  // 7. Check limits & fire notifications (non-blocking — never fails the request)
  checkLimitsAndNotify(admin, orgId).catch(() => {})

  return NextResponse.json({
    ok:           true,
    model,
    total_tokens: totalTok,
    cost_usd:     +costUsd.toFixed(6),
    bucket,
    source:       'direct',
  })
}

/* ════════════════════════════════════════════════════════════ */

// Only proxy to Go ingest service when INGEST_SERVICE_URL is explicitly configured.
// If unset (local dev default), always write directly to Supabase — no port 8001 attempts.
const GO_INGEST_URL = process.env.INGEST_SERVICE_URL
  ? process.env.INGEST_SERVICE_URL.replace(/\/$/, '') + '/v1/ingest'
  : null

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Authorization: Bearer <api_key> required' }, { status: 401 })
  }

  const rawKey = authHeader.slice(7).trim()

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Proxy to Go service only when explicitly configured
  if (GO_INGEST_URL) {
    try {
      const controller = new AbortController()
      const timer      = setTimeout(() => controller.abort(), 4_000)

      const upstream = await fetch(GO_INGEST_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body:    JSON.stringify(body),
        signal:  controller.signal,
      })
      clearTimeout(timer)

      const text = await upstream.text()
      if (text && text.trim().startsWith('{')) {
        return new NextResponse(text, {
          status:  upstream.status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      console.info('[ingest] Go service returned invalid body, falling back to Supabase')
    } catch {
      console.info('[ingest] Go service unavailable, falling back to Supabase')
    }
  }

  return directIngest(rawKey, body)
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'ingest', path: 'direct+proxy' })
}
