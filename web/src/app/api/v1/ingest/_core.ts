/**
 * Shared SDK ingest engine for POST /api/v1/ingest (one event) and
 * POST /api/v1/ingest/batch (up to 500 events).
 *
 * Per request, regardless of event count (warm caches):
 *   auth (cached 60s) → spend-limit check (cached limits/spend) →
 *   ONE array upsert into usage_events (ON CONFLICT (org_id, event_id) DO
 *   NOTHING, returning what was inserted) → one prompt-capture RPC (if any) →
 *   one usage_agg batch RPC. usage_daily/sessions/prompts rollups are kept by
 *   the usage_events trigger. Limit notifications and api_keys.last_used_at run
 *   after the response.
 */
import crypto from 'crypto'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { priceWithOverrides, getOrgPrices } from '@/lib/pricing-overrides'
import { reconcileClientCost } from '@/lib/mcp/pricing'
import { toZonedDate } from '@/lib/dates'
import { TtlCache } from '@/lib/cache'
import { redact, redactPreview } from '@/lib/redact'
import { evaluateLimitsAfterIngest } from '@/lib/alerts/limits-runner'
import { lookupIngestKey, touchKey, defer, resolveMemberIds, type KeyCtx } from '@/lib/otlp/auth'
import { resolveProjectId, upsertUsageEvents, upsertAggBatch, insertPromptCaptures, promptCaptureAllowed, PersistError } from '@/lib/otlp/persist'

export const MAX_BATCH = 500
/** Timestamps further in the future than this are clamped to "now". */
const MAX_CLOCK_SKEW_MS = 5 * 60_000
const MIN_TS = Date.UTC(2020, 0, 1)

/**
 * CLI agents that report through their own first-party plugin (OpenCode via
 * plugins/opencode). Only these may send cost_basis "notional", and their
 * cache/reasoning tokens are counted on top of input/output.
 */
export const AGENT_SOURCES = new Set(['opencode'])

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const str = (v: unknown) => (v == null ? '' : String(v))

// ── Auth ────────────────────────────────────────────────────────────────────

export type AuthResult = { ok: true; ctx: KeyCtx } | { ok: false; res: NextResponse }

export async function authIngest(req: NextRequest): Promise<AuthResult> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, res: NextResponse.json({ error: 'Authorization: Bearer <api_key> required' }, { status: 401 }) }
  }
  let found
  try { found = await lookupIngestKey(authHeader.slice(7).trim()) }
  catch (e: any) {
    console.error('[ingest] key lookup failed:', e?.message ?? e)
    return { ok: false, res: NextResponse.json({ error: 'temporarily unavailable' }, { status: 503, headers: { 'Retry-After': '5' } }) }
  }
  if (!found.ok) {
    const res = found.reason === 'invalid' ? NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
      : found.reason === 'inactive' ? NextResponse.json({ error: 'API key is inactive' }, { status: 403 })
      : found.reason === 'expired' ? NextResponse.json({ error: 'API key expired' }, { status: 403 })
      : NextResponse.json({ error: 'API key lacks the "write" scope required to ingest usage' }, { status: 403 })
    return { ok: false, res }
  }
  // Abuse protection only — monitoring is free and unlimited, there are no plans.
  const rl = await rateLimit(found.ctx.keyId)
  if (!rl.allowed) return { ok: false, res: rateLimitResponse(rl) }
  touchKey(found.ctx.keyId, found.row.last_used_at)
  return { ok: true, ctx: found.ctx }
}

// ── Spend limits ────────────────────────────────────────────────────────────

interface LimitRow { budget_usd: number | null; warn_at: number | null; throttle_at: number | null; block_at: number | null }
const limitCache = new TtlCache<string, LimitRow[]>(5_000, 30_000)
const spendCache = new TtlCache<string, number>(5_000, 10_000)

async function orgLimits(admin: SupabaseClient, orgId: string): Promise<LimitRow[]> {
  return limitCache.getOrLoad(orgId, async () => {
    const { data } = await admin.from('limits')
      .select('budget_usd, warn_at, throttle_at, block_at')
      .eq('org_id', orgId).eq('scope', 'org').eq('period', 'monthly').eq('is_active', true)
    return (data ?? []) as LimitRow[]
  })
}

/** Month-to-date spend (UTC month) via org_spend_since (whole days read usage_daily). */
async function monthSpend(admin: SupabaseClient, orgId: string, meteredOnly: boolean): Promise<number> {
  return spendCache.getOrLoad(`${orgId}|${meteredOnly}`, async () => {
    const now = new Date()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
    const { data, error } = await admin.rpc('org_spend_since', { p_org: orgId, p_since: monthStart, p_metered_only: meteredOnly })
    if (error) throw new Error(`org_spend_since failed: ${error.message}`)
    return Number(data ?? 0)
  })
}

/**
 * Worst decision across active monthly org limits. Blocking only counts
 * METERED spend: subscription (notional) usage must not block SDK traffic.
 */
export async function evaluateSpendLimit(admin: SupabaseClient, orgId: string): Promise<{ action: 'allow' | 'throttle' | 'block'; pct: number }> {
  const limits = await orgLimits(admin, orgId)
  if (!limits.length) return { action: 'allow', pct: 0 }
  const spend = await monthSpend(admin, orgId, true)
  const sev = { allow: 0, throttle: 1, block: 2 } as const
  let action: 'allow' | 'throttle' | 'block' = 'allow'
  let worst = 0
  for (const l of limits) {
    const budget = Number(l.budget_usd ?? 0)
    if (budget <= 0) continue
    const pct = (spend / budget) * 100
    const next = pct >= Number(l.block_at ?? 100) ? 'block' : pct >= Number(l.throttle_at ?? 90) ? 'throttle' : 'allow'
    if (sev[next] > sev[action]) action = next
    if (pct > worst) worst = pct
  }
  return { action, pct: worst }
}

export function limitResponse(state: { action: string; pct: number }): NextResponse | null {
  if (state.action === 'block') {
    return NextResponse.json({ error: 'Monthly spend limit reached — ingestion is blocked', pct: Math.round(state.pct) }, { status: 403 })
  }
  if (state.action === 'throttle') {
    return NextResponse.json({ error: 'Monthly spend throttle threshold reached — slow down', pct: Math.round(state.pct) }, { status: 429, headers: { 'Retry-After': '60' } })
  }
  return null
}

/**
 * Warning / alert notification when month-to-date spend crosses a limit
 * threshold (all usage, including subscription). One per org per type per day.
 * Runs after the response.
 */
export async function checkLimitsAndNotify(admin: SupabaseClient, orgId: string): Promise<void> {
  const limits = await orgLimits(admin, orgId)
  if (!limits.length) return
  const totalSpend = await monthSpend(admin, orgId, false)
  const today = new Date().toISOString().slice(0, 10)
  for (const limit of limits) {
    const budget = Number(limit.budget_usd ?? 0)
    if (budget <= 0) continue
    const pct = (totalSpend / budget) * 100
    const warnAt = Number(limit.warn_at ?? 70)
    const throttleAt = Number(limit.throttle_at ?? 90)
    const blockAt = Number(limit.block_at ?? 100)
    let notifType: string | null = null
    let title = ''
    let body = ''
    if (pct >= blockAt) {
      notifType = 'alert'
      title = 'Usage limit reached — review required'
      body = `Usage is at ${pct.toFixed(0)}% ($${totalSpend.toFixed(2)} of $${budget.toFixed(2)}). New requests may be blocked.`
    } else if (pct >= throttleAt) {
      notifType = 'warning'
      title = `High usage alert — ${pct.toFixed(0)}% of budget used`
      body = `You have crossed the ${throttleAt}% warning level. Usage is $${totalSpend.toFixed(2)} of $${budget.toFixed(2)}; review account and tool usage now.`
    } else if (pct >= warnAt) {
      notifType = 'warning'
      title = `Usage warning — ${pct.toFixed(0)}% of monthly budget used`
      body = `Monthly spend is $${totalSpend.toFixed(2)} (${pct.toFixed(0)}% of $${budget.toFixed(2)} budget).`
    }
    if (!notifType) continue
    const { data: existing } = await admin.from('notifications').select('id')
      .eq('org_id', orgId).eq('type', notifType).gte('created_at', today + 'T00:00:00Z').limit(1)
    if (existing?.length) continue
    await admin.from('notifications').insert({ org_id: orgId, title, body, type: notifType, is_read: false })
  }
}

// ── Validation / normalization ──────────────────────────────────────────────

/** body.timestamp → ISO. Accepts ISO strings, epoch ms and epoch seconds. */
export function eventTimestamp(v: unknown, now = Date.now()): { ok: true; iso: string } | { ok: false; error: string } {
  if (v == null || v === '') return { ok: true, iso: new Date(now).toISOString() }
  let ms: number
  if (typeof v === 'number' || (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()))) {
    const n = Number(v)
    ms = n < 1e11 ? n * 1000 : n        // seconds vs milliseconds
  } else if (typeof v === 'string') {
    ms = Date.parse(v)
  } else {
    return { ok: false, error: 'timestamp must be an ISO-8601 string or epoch seconds/milliseconds' }
  }
  if (!Number.isFinite(ms) || ms < MIN_TS) return { ok: false, error: 'timestamp is invalid or before 2020-01-01' }
  if (ms > now + MAX_CLOCK_SKEW_MS) ms = now   // client clock ahead: never book usage in the future
  return { ok: true, iso: new Date(ms).toISOString() }
}

export interface PreparedEvent {
  record: Record<string, unknown>
  prompt: Record<string, unknown> | null
  /** names the session: the agent's own title (explicit) or its first prompt */
  title: { session: string; text: string; origin: 'explicit' | 'prompt'; ts: string } | null
  summary: { model: string; total_tokens: number; cost_usd: number; bucket: string }
}

export type Prepared = { ok: true; ev: PreparedEvent } | { ok: false; status: number; error: string }

interface PrepareEnv {
  ctx: KeyCtx
  defaultProjectId: string | null
  validProjects: Set<string>
  prices: Awaited<ReturnType<typeof getOrgPrices>>
  members: Map<string, string>
  capture: boolean
  now: number
}

/** Validate + price one SDK event. Pure: all lookups are resolved in `env`. */
export function prepareEvent(body: Record<string, unknown>, idempotencyKey: string | null, env: PrepareEnv): Prepared {
  const { ctx } = env
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, status: 400, error: 'event must be a JSON object' }
  const model = str(body.model).trim()
  if (!model) return { ok: false, status: 400, error: 'model is required' }
  const n = (v: unknown) => Math.max(0, Number(v ?? 0) || 0)
  const meta = (body.metadata && typeof body.metadata === 'object' ? body.metadata : {}) as Record<string, unknown>
  const source = str(body.source ?? meta.source ?? 'direct') || 'direct'
  const agent = AGENT_SOURCES.has(source)
  const inputTok = n(body.input_tokens)
  const outputTok = n(body.output_tokens)
  const cacheReadTok = n(body.cache_read_tokens ?? body.cache_read_input_tokens)
  const cacheWriteTok = n(body.cache_write_tokens ?? body.cache_creation_input_tokens)
  const reasoningTok = n(body.reasoning_tokens ?? meta.reasoning_tokens)
  // CLI agents report cache and reasoning tokens SEPARATELY from input/output
  // (OpenCode: input excludes cache reads/writes, output excludes reasoning),
  // so a turn's real size — and its bill — includes them. SDK callers follow
  // OpenAI's convention (cached/reasoning already inside input/output).
  const split = inputTok + outputTok + (agent ? cacheReadTok + cacheWriteTok + reasoningTok : 0)
  // Accept total_tokens when input/output aren't split (70/30 estimate).
  const totalTok = split > 0 ? split : n(body.total_tokens)
  if (totalTok <= 0) return { ok: false, status: 400, error: 'input_tokens + output_tokens must be > 0' }
  const estimated = split <= 0
  const effectiveInput = estimated ? Math.round(totalTok * 0.7) : inputTok
  const effectiveOutput = estimated ? totalTok - Math.round(totalTok * 0.7) : outputTok
  const billableOutput = effectiveOutput + (agent ? reasoningTok : 0)

  const ts = eventTimestamp(body.timestamp ?? body.created_at, env.now)
  if (!ts.ok) return { ok: false, status: 400, error: ts.error }

  const projectId = str(body.project_id) || ctx.projectId || env.defaultProjectId
  if (!projectId) return { ok: false, status: 422, error: 'No project found for this org. Create a project in the dashboard first.' }
  if (!env.validProjects.has(projectId)) return { ok: false, status: 422, error: 'project_id does not belong to this organization' }

  // Server-side price (org override first); a client figure only for unknown models.
  const priced = priceWithOverrides(env.prices, model, { input: effectiveInput, output: billableOutput, cacheRead: cacheReadTok, cacheWrite: cacheWriteTok })
  // cost_basis: only a known CLI agent may say "notional" (subscription usage
  // priced at API rates — excluded from blocking spend limits). Its cost is
  // always the SERVER price from the tokens (incl. cache); the agent's own
  // figure (0 for OAuth subscriptions) is kept as vendor_cost_usd. Anything
  // else is metered and priced server-side exactly as before.
  const costBasis: 'metered' | 'notional' | null = agent
    ? (str(body.cost_basis ?? meta.cost_basis) === 'notional' ? 'notional' : 'metered')
    : null
  const cost = costBasis === 'notional'
    ? { cost: priced.cost, usedClient: false, client: reconcileClientCost(priced.cost, true, body.cost_usd).client }
    : reconcileClientCost(priced.cost, priced.priceKnown, body.cost_usd)

  const incomingTags = (body.tags && typeof body.tags === 'object' ? body.tags : {}) as Record<string, string>
  const toolName = str(body.tool ?? body.tool_name ?? meta.tool ?? source) || source
  const provider = str(body.provider ?? meta.provider) || null
  const actorId = str(body.actor_id ?? body.account_id ?? meta.actor_id) || null
  const actorName = str(body.actor_name ?? body.username ?? body.user_name ?? meta.actor_name) || null
  const userEmail = str(body.user_email ?? body.email ?? meta.user_email).trim() || null
  const sessionId = str(body.session_id ?? meta.session_id) || null
  const latencyRaw = Number(body.latency_ms ?? meta.latency_ms)
  const latencyMs = Number.isFinite(latencyRaw) && latencyRaw >= 0 ? Math.min(Math.round(latencyRaw), 2_147_483_647) : null
  const promptText = typeof body.prompt_text === 'string' ? body.prompt_text : null
  const correlationId = str(body.correlation_id ?? body.trace_id ?? meta.correlation_id) || null
  // CLI agents key a prompt by its id (like OTLP prompt.id), so every LLM call
  // of one prompt — and its prompt_captures row — share one prompt_hash.
  const promptHash = str(body.prompt_hash ?? meta.prompt_hash ?? (agent && correlationId ? correlationId : promptText ? sha256(promptText) : '')) || null
  const promptPreview = env.capture ? redactPreview(str(body.prompt_preview ?? meta.prompt_preview) || (promptText ? promptText : null)) : null
  const promptChars = Number(body.prompt_chars ?? meta.prompt_chars ?? (promptText ? promptText.length : 0)) || null
  const { prompt_text: _p, response_text: _r, ...safeMeta } = meta

  const userId = ctx.userId ?? (userEmail ? env.members.get(userEmail.toLowerCase()) ?? null : null)
  const eventId = `direct:${ctx.orgId}:${idempotencyKey ?? crypto.randomUUID()}`
  const bucket = toZonedDate(ts.iso, ctx.timezone)
  const record: Record<string, unknown> = {
    org_id: ctx.orgId, project_id: projectId, api_key_id: ctx.keyId, user_id: userId,
    model, input_tokens: effectiveInput, output_tokens: effectiveOutput, total_tokens: totalTok,
    cache_read_tokens: cacheReadTok, cache_write_tokens: cacheWriteTok, reasoning_tokens: reasoningTok,
    cost_usd: cost.cost, vendor_cost_usd: cost.client,
    ...(costBasis ? { cost_basis: costBasis } : {}),
    ...(str(body.repo ?? meta.repo) ? { repo: str(body.repo ?? meta.repo).slice(0, 300) } : {}),
    latency_ms: latencyMs, created_at: ts.iso,
    event_id: eventId, request_idempotency_key: idempotencyKey,
    source, tool_name: toolName, provider, actor_id: actorId, actor_name: actorName,
    user_email: userEmail, session_id: sessionId,
    correlation_id: correlationId,
    prompt_hash: promptHash, prompt_preview: promptPreview, prompt_chars: promptChars,
    tags: { ...incomingTags, source, tool: toolName, ...(provider ? { provider } : {}), ...(priced.priceKnown ? {} : { price_known: 'false' }) },
    metadata: {
      ...safeMeta,
      source, tool: toolName, provider, actor_id: actorId, actor_name: actorName,
      user_email: userEmail, session_id: sessionId, prompt_hash: promptHash,
      prompt_preview: promptPreview, prompt_chars: promptChars,
      input_tokens: effectiveInput, output_tokens: effectiveOutput, latency_ms: latencyMs,
      ...(cost.usedClient ? { cost_source: 'client' } : {}),
      ...(costBasis ? { cost_basis: costBasis } : {}),
    },
  }
  const prompt = env.capture && promptText ? {
    org_id: ctx.orgId, project_id: projectId, user_id: userId, model, prompt_hash: promptHash,
    prompt_text: promptText,
    response_text: typeof body.response_text === 'string' ? body.response_text : null,
    input_tokens: effectiveInput, output_tokens: effectiveOutput, cost_usd: cost.cost, created_at: ts.iso,
  } : null
  // Session name — only when prompt capture is allowed (a title is prompt content).
  const explicitTitle = str(body.session_title ?? meta.session_title).trim()
  const title = env.capture && sessionId && (explicitTitle || promptText?.trim())
    ? { session: sessionId, text: redact(explicitTitle || promptText!), origin: (explicitTitle ? 'explicit' : 'prompt') as 'explicit' | 'prompt', ts: ts.iso }
    : null
  return { ok: true, ev: { record, prompt, title, summary: { model, total_tokens: totalTok, cost_usd: cost.cost, bucket } } }
}

// ── Project validation (cached) ─────────────────────────────────────────────

const projectOk = new TtlCache<string, boolean>(20_000, 60_000)

async function validProjectsFor(admin: SupabaseClient, orgId: string, ids: string[]): Promise<Set<string>> {
  const ok = new Set<string>()
  const misses: string[] = []
  for (const id of Array.from(new Set(ids))) {
    const hit = projectOk.get(`${orgId}|${id}`)
    if (hit === undefined) misses.push(id)
    else if (hit) ok.add(id)
  }
  // Only well-formed uuids can match; anything else is simply not ours.
  const uuids = misses.filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
  if (uuids.length) {
    const { data, error } = await admin.from('projects').select('id').eq('org_id', orgId).in('id', uuids)
    if (error) throw new PersistError(`project lookup failed: ${error.message}`)
    const found = new Set((data ?? []).map((r: { id: string }) => r.id))
    for (const id of uuids) { projectOk.set(`${orgId}|${id}`, found.has(id)); if (found.has(id)) ok.add(id) }
  }
  return ok
}

// ── Engine ──────────────────────────────────────────────────────────────────

export type EventStatus = 'accepted' | 'duplicate' | 'error'
export interface EventResult {
  index: number
  status: EventStatus
  code: number
  error?: string
  event_id?: string
  summary?: PreparedEvent['summary']
}

/**
 * Validate, price and store a list of events in one round trip. Invalid events
 * are reported per index and don't block the valid ones.
 */
export async function ingestEvents(ctx: KeyCtx, events: Array<{ body: Record<string, unknown>; idempotencyKey: string | null }>): Promise<EventResult[]> {
  const admin = createAdminClient()
  const bodies = events.map(e => (e.body && typeof e.body === 'object' ? e.body : {}) as Record<string, unknown>)
  const [defaultProjectId, prices, members] = await Promise.all([
    resolveProjectId(admin, { orgId: ctx.orgId, projectId: null, defaultProjectId: ctx.defaultProjectId }),
    getOrgPrices(admin, ctx.orgId),
    ctx.userId ? Promise.resolve(new Map<string, string>())
      : resolveMemberIds(admin, ctx.orgId, bodies.map(b => str(b.user_email ?? b.email ?? (b.metadata as any)?.user_email) || null)),
  ])
  const projectIds = bodies.map(b => str(b.project_id) || ctx.projectId || defaultProjectId || '').filter(Boolean)
  // Key-bound and default projects are ours by construction.
  const known = [ctx.projectId, defaultProjectId].filter(Boolean) as string[]
  const validProjects = await validProjectsFor(admin, ctx.orgId, projectIds.filter(id => !known.includes(id)))
  for (const k of known) validProjects.add(k)

  const env: PrepareEnv = { ctx, defaultProjectId, validProjects, prices, members, capture: promptCaptureAllowed(ctx), now: Date.now() }
  const results: EventResult[] = []
  const prepared: Array<{ index: number; ev: PreparedEvent }> = []
  events.forEach((e, index) => {
    const p = prepareEvent(bodies[index], e.idempotencyKey, env)
    if (!p.ok) results[index] = { index, status: 'error', code: p.status, error: p.error }
    else prepared.push({ index, ev: p.ev })
  })

  const inserted = await upsertUsageEvents(admin, prepared.map(p => p.ev.record))
  const fresh = new Set(inserted.map(i => i.event_id))
  const claimed = new Set<string>()
  const freshEvents: PreparedEvent[] = []
  for (const { index, ev } of prepared) {
    const id = String(ev.record.event_id)
    // A repeated idempotency key inside one batch: the first copy wins.
    const isFresh = fresh.has(id) && !claimed.has(id)
    if (isFresh) { claimed.add(id); freshEvents.push(ev) }
    results[index] = isFresh
      ? { index, status: 'accepted', code: 201, event_id: id, summary: ev.summary }
      : { index, status: 'duplicate', code: 200, event_id: id, summary: ev.summary }
  }

  await Promise.all([
    insertPromptCaptures(admin, freshEvents.map(e => e.prompt).filter(Boolean) as Record<string, unknown>[]),
    nameSessionsFrom(admin, ctx.orgId, freshEvents),
    upsertAggBatch(admin, ctx.orgId, ctx.timezone, freshEvents.map(e => ({
      project_id: String(e.record.project_id), model: String(e.record.model), created_at: String(e.record.created_at),
      total_tokens: Number(e.record.total_tokens), cost_usd: Number(e.record.cost_usd), cost_basis: (e.record.cost_basis as string | undefined) ?? null,
    }))),
  ])
  if (freshEvents.length) defer(() => checkLimitsAndNotify(admin, ctx.orgId))
  if (freshEvents.length) defer(() => evaluateLimitsAfterIngest(admin, ctx.orgId))
  return results
}

/**
 * One title write per session per batch: the latest explicit title wins,
 * otherwise the earliest prompt (the database never lets a prompt title
 * replace an existing one). Best-effort.
 */
async function nameSessionsFrom(admin: SupabaseClient, orgId: string, evs: PreparedEvent[]): Promise<void> {
  const pick = new Map<string, NonNullable<PreparedEvent['title']>>()
  for (const t of evs.map(e => e.title).filter(Boolean) as NonNullable<PreparedEvent['title']>[]) {
    const cur = pick.get(t.session)
    const better = !cur
      || (t.origin === 'explicit' && (cur.origin !== 'explicit' || t.ts >= cur.ts))
      || (t.origin === 'prompt' && cur.origin === 'prompt' && t.ts < cur.ts)
    if (better) pick.set(t.session, t)
  }
  await Promise.all(Array.from(pick.values()).map(t =>
    admin.rpc('tf_set_session_title', { p_org: orgId, p_session: t.session, p_title: t.text, p_origin: t.origin })
      .then(({ error }) => { if (error) console.warn('[ingest] session title skipped:', error.message) })))
}

/** Spend-limit gate shared by both routes (null = proceed). */
export async function spendGate(ctx: KeyCtx): Promise<NextResponse | null> {
  try {
    return limitResponse(await evaluateSpendLimit(createAdminClient(), ctx.orgId))
  } catch (e: any) {
    console.error('[ingest] spend limit check failed:', e?.message ?? e)
    return NextResponse.json({ error: 'temporarily unavailable' }, { status: 503, headers: { 'Retry-After': '5' } })
  }
}
