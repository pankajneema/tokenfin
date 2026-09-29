/**
 * Write usage rows idempotently, in batches.
 *
 * One OTLP export (or SDK batch) costs a fixed number of round trips no matter
 * how many records it carries:
 *   1. one array upsert into usage_events, ON CONFLICT (org_id, event_id) DO
 *      NOTHING, returning the ids that were actually inserted;
 *   2. one insert_prompt_captures RPC for any prompt text (if allowed);
 *   3. one upsert_usage_agg_batch RPC for the fresh metered rows.
 * usage_daily / usage_sessions / usage_daily_prompts are maintained by the
 * usage_events trigger (migration 011), so they need no call here.
 *
 * A replay (same payload, or the same spend arriving later) inserts nothing and
 * therefore never rolls into any aggregate twice. event_ids are prefixed with
 * the org id so one tenant can never collide with (and suppress) another's.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PromptEvent } from './normalize'
import type { KeyCtx } from './auth'
import { resolveMemberIds } from './auth'
import type { UsageRow, ApiErrorEvent } from './normalize'
import type { ProductivityDelta } from './metrics'
import { getOrgPrices, priceWithOverrides } from '@/lib/pricing-overrides'
import { toZonedDate } from '@/lib/dates'
import { TtlCache } from '@/lib/cache'
import { redact, redactPreview } from '@/lib/redact'

/** A storage failure the exporter should retry (receivers answer 503). */
export class PersistError extends Error {}

// Columns added by migration 007 — dropped on retry if the DB predates it.
const ENRICH_COLS = ['vendor_cost_usd', 'repo', 'query_source', 'agent_name', 'skill_name', 'mcp_server']
const ATTRIBUTION_COLS = ['actor_id', 'actor_name', 'tool_name', 'provider', 'prompt_hash', 'prompt_preview', 'prompt_chars', 'request_idempotency_key']

/** `org:<id>` scoping for event ids; already-scoped ids are left alone. */
export function scopedEventId(orgId: string, id: string): string {
  return id.startsWith(`${orgId}:`) || id.includes(`:${orgId}:`) ? id : `${orgId}:${id}`
}

/** Prompt text may be stored only if the org allows it and the operator hasn't disabled it. */
export function promptCaptureAllowed(ctx: Pick<KeyCtx, 'capturePrompts'>): boolean {
  return process.env.CAPTURE_PROMPTS !== '0' && ctx.capturePrompts !== false
}

const projectCache = new TtlCache<string, string | null>(5_000, 60_000)

/** Key's project, else the org's first project (cached). */
export async function resolveProjectId(admin: SupabaseClient, ctx: Pick<KeyCtx, 'orgId' | 'projectId' | 'defaultProjectId'>): Promise<string | null> {
  if (ctx.projectId) return ctx.projectId
  if (ctx.defaultProjectId !== undefined && ctx.defaultProjectId !== null) return ctx.defaultProjectId
  return projectCache.getOrLoad(ctx.orgId, async () => {
    const { data } = await admin
      .from('projects').select('id').eq('org_id', ctx.orgId)
      .order('created_at', { ascending: true }).limit(1).maybeSingle()
    return (data?.id as string | undefined) ?? null
  }, v => (v ? 60_000 : 5_000))
}

type Rec = Record<string, unknown>

/**
 * Array upsert with the rolling-migration fallbacks (older databases without
 * the 007 / attribution columns keep ingesting). Returns inserted rows.
 */
export async function upsertUsageEvents(admin: SupabaseClient, records: Rec[]): Promise<Array<{ id: string; event_id: string | null }>> {
  if (!records.length) return []
  const run = (recs: Rec[]) => admin.from('usage_events')
    .upsert(recs, { onConflict: 'org_id,event_id', ignoreDuplicates: true })
    .select('id, event_id')
  const strip = (cols: string[]) => records.map(r => { const c = { ...r }; for (const k of cols) delete c[k]; return c })

  let { data, error } = await run(records)
  if (error && /api_key_id/.test(error.message)) ({ data, error } = await run(strip(['api_key_id'])))
  if (error && new RegExp(ENRICH_COLS.join('|')).test(error.message)) ({ data, error } = await run(strip(ENRICH_COLS)))
  if (error && new RegExp(ATTRIBUTION_COLS.join('|')).test(error.message)) ({ data, error } = await run(strip([...ATTRIBUTION_COLS, ...ENRICH_COLS])))
  if (error) throw new PersistError(`usage_events upsert failed: ${error.message}`)
  return (data ?? []) as Array<{ id: string; event_id: string | null }>
}

export interface AggInput { project_id: string | null; model: string; created_at: string; total_tokens: number; cost_usd: number; cost_basis?: string | null }

/**
 * Roll fresh METERED rows into usage_agg with one batched RPC. usage_agg has no
 * cost_basis column, so notional (subscription) dollars never enter it — every
 * usage_agg-derived total stays a real bill. Rows are pre-summed per
 * (project, model, day) because one INSERT can't touch a row twice.
 */
export async function upsertAggBatch(admin: SupabaseClient, orgId: string, tz: string | undefined, rows: AggInput[]): Promise<number> {
  const acc = new Map<string, { p_org_id: string; p_project_id: string; p_model: string; p_bucket: string; p_tokens: number; p_cost: number; p_requests: number }>()
  for (const r of rows) {
    if (!r.project_id || r.cost_basis === 'notional') continue
    const bucket = toZonedDate(r.created_at, tz)
    const k = `${r.project_id}|${r.model}|${bucket}`
    const cur = acc.get(k)
    if (cur) { cur.p_tokens += r.total_tokens; cur.p_cost = +(cur.p_cost + r.cost_usd).toFixed(8); cur.p_requests++ }
    else acc.set(k, { p_org_id: orgId, p_project_id: r.project_id, p_model: r.model, p_bucket: bucket, p_tokens: r.total_tokens, p_cost: r.cost_usd, p_requests: 1 })
  }
  if (!acc.size) return 0
  const { error } = await admin.rpc('upsert_usage_agg_batch', { rows: Array.from(acc.values()) })
  // The events are already stored and a retry would skip them as duplicates, so
  // an aggregate failure is logged rather than failing the request.
  if (error) console.error('[ingest] upsert_usage_agg_batch failed:', error.message)
  return acc.size
}

/** Batched, deduped prompt capture (redacted). Never fails ingest. */
export async function insertPromptCaptures(admin: SupabaseClient, rows: Rec[]): Promise<number> {
  if (!rows.length) return 0
  const clean = rows.map(r => ({
    ...r,
    prompt_text: redact(String(r.prompt_text ?? '')),
    ...(r.response_text != null ? { response_text: redact(String(r.response_text)) } : {}),
  }))
  const { data, error } = await admin.rpc('insert_prompt_captures', { p_rows: clean })
  if (error) { console.error('[ingest] prompt capture failed:', error.message); return 0 }
  return Number(data ?? 0)
}

export interface PersistResult { inserted: number; duplicate: number }

export async function persistRows(admin: SupabaseClient, ctx: KeyCtx, rows: UsageRow[]): Promise<PersistResult> {
  const res: PersistResult = { inserted: 0, duplicate: 0 }
  if (!rows.length) return res
  const [projectId, orgPrices, members] = await Promise.all([
    resolveProjectId(admin, ctx),
    getOrgPrices(admin, ctx.orgId),
    // Shared/org keys carry no user: attribute by the reported email instead.
    ctx.userId ? Promise.resolve(new Map<string, string>()) : resolveMemberIds(admin, ctx.orgId, rows.map(r => r.user_email)),
  ])
  const capture = promptCaptureAllowed(ctx)

  const records: Rec[] = []
  const byEventId = new Map<string, { rec: Rec; row: UsageRow }>()
  for (const r0 of rows) {
    // Re-price with the org's custom override (longest prefix) when one
    // matches; otherwise keep the server-side list price the row came with.
    let r = r0
    let priceKnown = r0.price_known ?? true
    if (r0.billable) {
      const priced = priceWithOverrides(orgPrices, r0.model, r0.billable)
      priceKnown = priced.priceKnown
      if (priced.overridePrefix) r = { ...r0, cost_usd: priced.cost }
    }
    const eventId = scopedEventId(ctx.orgId, r.event_id)
    if (byEventId.has(eventId)) continue   // same record twice in one export
    // Anthropic (Claude Code) reports cache tokens separately from input_tokens,
    // so a turn's real size includes them. Codex/OpenAI cached input is already
    // inside input_tokens, so it is not added twice.
    const total = r.input_tokens + r.output_tokens
      + (r.source === 'claude_code' ? r.cache_read_tokens + r.cache_write_tokens : 0)
    const email = (r.user_email ?? '').trim().toLowerCase()
    const preview = capture ? redactPreview(r.prompt_preview) : null
    const record: Rec = {
      org_id: ctx.orgId, project_id: projectId, api_key_id: ctx.keyId,
      user_id: ctx.userId ?? (email ? members.get(email) ?? null : null),
      model: r.model,
      input_tokens: r.input_tokens, output_tokens: r.output_tokens, total_tokens: total,
      cost_usd: r.cost_usd, created_at: r.ts, latency_ms: r.latency_ms ?? null,
      event_id: eventId, source: r.source, mode: 'push',
      provider_request_id: r.provider_request_id, correlation_id: r.correlation_id,
      cache_read_tokens: r.cache_read_tokens, cache_write_tokens: r.cache_write_tokens,
      reasoning_tokens: r.reasoning_tokens, cost_basis: r.cost_basis,
      user_email: r.user_email, session_id: r.session_id,
      actor_id: r.actor_id ?? null, actor_name: r.actor_name ?? null,
      tool_name: r.tool_name ?? r.source, provider: r.provider ?? null,
      // Readers group "prompt patterns" by prompt_hash; OTLP logs carry the
      // prompt/conversation id there (no text), which groups cost per task.
      prompt_hash: r.prompt_hash ?? r.correlation_id,
      prompt_preview: preview, prompt_chars: r.prompt_chars ?? null,
      // Allocation tags first, so the fixed keys below always win.
      tags: {
        ...(r.extra_tags ?? {}),
        source: r.source, tool: r.tool_name ?? r.source, provider: r.provider ?? null,
        ...(priceKnown ? {} : { price_known: 'false' }),
      },
      vendor_cost_usd: r.vendor_cost_usd ?? null,
      repo: r.repo ?? null,
      query_source: r.query_source ?? null,
      agent_name: r.agent_name ?? null,
      skill_name: r.skill_name ?? null,
      mcp_server: r.mcp_server ?? null,
      // Normalized dimensions in metadata too, so exports and prompt analytics
      // stay useful on databases without the optional columns.
      metadata: {
        otlp: true,
        prompt_hash: r.correlation_id,
        prompt_preview: preview,
        prompt_chars: r.prompt_chars ?? null,
        input_tokens: r.input_tokens,
        output_tokens: r.output_tokens,
        session_id: r.session_id,
        user_email: r.user_email,
        source: r.source,
        actor_id: r.actor_id ?? null,
        actor_name: r.actor_name ?? null,
        tool_name: r.tool_name ?? r.source,
        provider: r.provider ?? null,
        latency_ms: r.latency_ms ?? null,
      },
    }
    records.push(record)
    byEventId.set(eventId, { rec: record, row: r })
  }

  const inserted = await upsertUsageEvents(admin, records)
  const fresh = new Set(inserted.map(i => i.event_id))
  res.inserted = inserted.length
  res.duplicate = rows.length - inserted.length

  const freshRows = Array.from(byEventId.entries()).filter(([id]) => fresh.has(id)).map(([, v]) => v)
  const prompts = capture
    ? freshRows.filter(({ row }) => row.prompt_text).map(({ rec, row }) => ({
        org_id: ctx.orgId, project_id: projectId, user_id: rec.user_id ?? null, model: row.model,
        prompt_hash: row.prompt_hash ?? row.correlation_id, prompt_text: row.prompt_text,
        input_tokens: row.input_tokens, output_tokens: row.output_tokens, cost_usd: rec.cost_usd, created_at: row.ts,
      }))
    : []
  await Promise.all([
    insertPromptCaptures(admin, prompts),
    upsertAggBatch(admin, ctx.orgId, ctx.timezone, freshRows.map(({ rec }) => ({
      project_id: projectId, model: String(rec.model), created_at: String(rec.created_at),
      total_tokens: Number(rec.total_tokens), cost_usd: Number(rec.cost_usd), cost_basis: rec.cost_basis as string,
    }))),
  ])
  return res
}

/**
 * Store CLI-agent user prompts (one row per prompt id, redacted). Tokens and
 * cost are not on the prompt event; readers join them from usage_events by
 * prompt_hash. One RPC; prompts already stored are skipped server-side.
 */
export async function persistPrompts(admin: SupabaseClient, ctx: KeyCtx, prompts: PromptEvent[]): Promise<number> {
  if (!promptCaptureAllowed(ctx) || prompts.length === 0) return 0
  const projectId = await resolveProjectId(admin, ctx)
  return insertPromptCaptures(admin, prompts.map(p => ({
    org_id: ctx.orgId,
    project_id: projectId,
    user_id: ctx.userId,
    model: '',   // filled from the joined api_request events when displayed
    prompt_hash: p.prompt_id,
    prompt_text: p.prompt_text,
    context: p.source,
    created_at: p.ts,
  })))
}

/** Atomically add productivity increments (upsert_productivity, migration 007). */
export async function persistProductivity(admin: SupabaseClient, ctx: KeyCtx, deltas: ProductivityDelta[]): Promise<number> {
  const results = await Promise.all(deltas.map(d => admin.rpc('upsert_productivity', {
    p_org: ctx.orgId, p_user_key: d.user_key, p_user_id: d.user_id, p_repo: d.repo, p_day: d.day,
    p_lines_added: Math.round(d.lines_added), p_lines_removed: Math.round(d.lines_removed),
    p_commits: Math.round(d.commits), p_prs: Math.round(d.pull_requests),
    p_accepted: Math.round(d.edits_accepted), p_rejected: Math.round(d.edits_rejected),
    p_active: +d.active_seconds.toFixed(3), p_sessions: Math.round(d.sessions),
  })))
  const failed = results.find(r => r.error)
  if (failed?.error) throw new PersistError(`upsert_productivity failed: ${failed.error.message}`)
  return deltas.length
}

/** Count api_error events per user·model·day (increment_api_errors, migration 007). */
export async function persistApiErrors(admin: SupabaseClient, ctx: KeyCtx, events: ApiErrorEvent[]): Promise<number> {
  const results = await Promise.all(events.map(e => admin.rpc('increment_api_errors', {
    p_org: ctx.orgId, p_user_key: e.user_key, p_model: e.model, p_day: e.day, p_errors: e.errors,
  })))
  let n = 0
  results.forEach((r, i) => {
    if (r.error) console.error('[otlp] api_errors_daily increment failed:', r.error.message)
    else n += events[i].errors
  })
  return n
}
