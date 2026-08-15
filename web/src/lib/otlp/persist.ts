/**
 * Write usage rows idempotently.
 *
 * usage_events has a UNIQUE(event_id); we upsert with ignoreDuplicates so a
 * replay (same payload, or the same spend arriving later via a pull poll) is a
 * no-op. Only rows that were actually inserted roll into usage_agg — so the
 * daily aggregates never double-count on replay either.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { KeyCtx } from './auth'
import type { UsageRow } from './normalize'

// IST bucket — matches the ingest + analytics convention so days don't split.
const istBucket = (isoTs: string) =>
  new Date(new Date(isoTs).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10)

async function resolveProjectId(admin: SupabaseClient, orgId: string, projectId: string | null): Promise<string | null> {
  if (projectId) return projectId
  const { data } = await admin
    .from('projects').select('id').eq('org_id', orgId)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  return (data?.id as string | undefined) ?? null
}

export interface PersistResult { inserted: number; duplicate: number }

export async function persistRows(admin: SupabaseClient, ctx: KeyCtx, rows: UsageRow[]): Promise<PersistResult> {
  const res: PersistResult = { inserted: 0, duplicate: 0 }
  if (!rows.length) return res
  const projectId = await resolveProjectId(admin, ctx.orgId, ctx.projectId)

  for (const r of rows) {
    const total = r.input_tokens + r.output_tokens
    const record: Record<string, unknown> = {
      org_id: ctx.orgId, project_id: projectId, api_key_id: ctx.keyId, user_id: ctx.userId,
      model: r.model,
      input_tokens: r.input_tokens, output_tokens: r.output_tokens, total_tokens: total,
      cost_usd: r.cost_usd, created_at: r.ts,
      event_id: r.event_id, source: r.source, mode: 'push',
      provider_request_id: r.provider_request_id, correlation_id: r.correlation_id,
      cache_read_tokens: r.cache_read_tokens, cache_write_tokens: r.cache_write_tokens,
      reasoning_tokens: r.reasoning_tokens, cost_basis: r.cost_basis,
      user_email: r.user_email, session_id: r.session_id,
      tags: { source: r.source },
      // prompt_hash: both analytics/prompts and my-usage read this exact key
      // to group "prompt patterns" — it was previously written as `prompt_id`,
      // a name neither consumer ever looked for, so this data existed but was
      // invisible. Claude Code's OTel logs carry no prompt TEXT (by design,
      // for privacy), so this groups by conversation/session — not true
      // prompt-content similarity — but that's a real, useful "cost per task"
      // view, and is exactly what was silently missing before.
      metadata: { otlp: true, prompt_hash: r.correlation_id },
    }

    let inserted: any[] | null = null
    let { data, error } = await admin.from('usage_events')
      .upsert(record, { onConflict: 'event_id', ignoreDuplicates: true }).select('id')
    if (error && /api_key_id/.test(error.message)) {
      // Deployed DB without migration 016 — retry without the column.
      const { api_key_id: _drop, ...legacy } = record
      ;({ data, error } = await admin.from('usage_events')
        .upsert(legacy, { onConflict: 'event_id', ignoreDuplicates: true }).select('id'))
    }
    if (error) throw new Error(`usage_events upsert failed: ${error.message}`)
    inserted = data

    if (!inserted || inserted.length === 0) { res.duplicate++; continue }  // conflict → skip agg
    res.inserted++

    // Roll only fresh, METERED rows into daily aggregates. usage_agg has no
    // cost_basis column, so notional (subscription) dollars must never enter it
    // — every usage_agg-derived total (spend, budget, analytics) stays a real
    // bill. Notional usage still lives in usage_events for its own lane.
    if (projectId && r.cost_basis !== 'notional') {
      await admin.rpc('upsert_usage_agg', {
        p_org_id: ctx.orgId, p_project_id: projectId, p_model: r.model,
        p_bucket: istBucket(r.ts), p_tokens: total, p_cost: r.cost_usd, p_requests: 1,
      })
    }
  }
  return res
}
