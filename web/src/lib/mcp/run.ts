import { createAdminClient } from '@/lib/supabase/server'
import { compressContent } from './compress'
import { ccrPut, ccrGet } from './ccr'
import { inputPrice } from './pricing'
import { judgeFaithfulness, judgeCorrectness } from '@/lib/eval/judge'
import { resolveJudge } from '@/lib/eval/config'
import type { KeyCtx } from './types'
import { selectAll } from '@/lib/supabase/paginate'
import { can } from '@/lib/rbac'
import { getOrgTimezone } from '@/lib/org-timezone'
import { daysAgoIn, shiftDay } from '@/lib/dates'
import { redact } from '@/lib/redact'
import { dashBreakdown, dashSessions, dashPrompts, dashSummary, type DashSession, type DashPrompt, type Page } from '@/lib/rollups'
import { resolveUserKeys, scopedFilterSets, mergeBreakdowns, mergePages, inScope } from './scope'
import { parseRange, parseDim, parseFilters, clampInt, forecastMonth } from './range'

const SESSION_ORDER = ['recent', 'cost', 'tokens'] as const
const PROMPT_ORDER  = ['cost', 'recent', 'tokens', 'requests'] as const
const pick = <T extends string>(v: unknown, allowed: readonly T[], def: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v as T : def

function sessionCmp(order: typeof SESSION_ORDER[number]) {
  return (a: DashSession, b: DashSession) =>
    order === 'cost' ? b.cost_usd - a.cost_usd : order === 'tokens' ? b.total_tokens - a.total_tokens : b.last_at.localeCompare(a.last_at)
}
function promptCmp(order: typeof PROMPT_ORDER[number]) {
  return (a: DashPrompt, b: DashPrompt) =>
    order === 'recent' ? b.last_at.localeCompare(a.last_at) : order === 'tokens' ? b.total_tokens - a.total_tokens
      : order === 'requests' ? b.requests - a.requests : b.cost_usd - a.cost_usd
}

/** Prompt text is returned only when capture is on (env + Settings → Privacy), and always redacted. */
async function captureOn(admin: ReturnType<typeof createAdminClient>, orgId: string): Promise<boolean> {
  if (process.env.CAPTURE_PROMPTS === '0') return false
  const { data } = await admin.from('organizations').select('capture_prompts').eq('id', orgId).maybeSingle()
  return (data as { capture_prompts?: boolean } | null)?.capture_prompts !== false
}

const scopeNote = (scoped: boolean) => scoped
  ? 'Scoped to your own usage (your role sees only your prompts, sessions and member spend).'
  : 'Org-wide (owner/admin).'

// Executes a single MCP tool, scoped to the caller's org. Every query filters by
// ctx.orgId — the authorization boundary — and per-user data (prompts, sessions,
// member spend) is further limited to the key owner unless they are owner/admin.
export async function runTool(name: string, args: Record<string, unknown>, ctx: KeyCtx): Promise<unknown> {
  const admin = createAdminClient()
  const days  = Math.min(Math.max(Number(args.days) || 30, 1), 365)
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)

  switch (name) {
    // ── Analytics ──
    case 'list_projects': {
      const { data } = await admin.from('projects').select('id, name, slug').eq('org_id', ctx.orgId).order('name')
      return { projects: data ?? [] }
    }
    case 'get_spend': {
      const { data } = await selectAll<{ model: string; bucket: string; cost_usd: number; total_tokens: number; request_count: number }>(() => admin.from('usage_agg').select('cost_usd, total_tokens, request_count').eq('org_id', ctx.orgId).gte('bucket', since))
      const rows = data ?? []
      return {
        period_days: days,
        cost_usd: +rows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0).toFixed(4),
        total_tokens: rows.reduce((s, r) => s + Number(r.total_tokens ?? 0), 0),
        requests: rows.reduce((s, r) => s + Number(r.request_count ?? 0), 0),
      }
    }
    case 'get_usage_by_model': {
      const { data } = await selectAll<{ model: string; bucket: string; cost_usd: number; total_tokens: number; request_count: number }>(() => admin.from('usage_agg').select('model, cost_usd, total_tokens, request_count').eq('org_id', ctx.orgId).gte('bucket', since))
      const byModel = new Map<string, { model: string; cost_usd: number; total_tokens: number; requests: number }>()
      for (const r of data ?? []) {
        const m = byModel.get(r.model) ?? { model: r.model, cost_usd: 0, total_tokens: 0, requests: 0 }
        m.cost_usd += Number(r.cost_usd ?? 0); m.total_tokens += Number(r.total_tokens ?? 0); m.requests += Number(r.request_count ?? 0)
        byModel.set(r.model, m)
      }
      return { period_days: days, models: Array.from(byModel.values()).map(m => ({ ...m, cost_usd: +m.cost_usd.toFixed(4) })).sort((a, b) => b.cost_usd - a.cost_usd) }
    }
    case 'get_daily_costs': {
      const { data } = await selectAll<{ model: string; bucket: string; cost_usd: number; total_tokens: number; request_count: number }>(() => admin.from('usage_agg').select('bucket, cost_usd').eq('org_id', ctx.orgId).gte('bucket', since))
      const byDay = new Map<string, number>()
      for (const r of data ?? []) byDay.set(r.bucket, (byDay.get(r.bucket) ?? 0) + Number(r.cost_usd ?? 0))
      return { period_days: days, daily: Array.from(byDay.entries()).map(([day, cost]) => ({ day, cost_usd: +cost.toFixed(4) })).sort((a, b) => a.day.localeCompare(b.day)) }
    }
    case 'get_budget_status': {
      const monthStart = new Date(); monthStart.setDate(1)
      const [{ data: limits }, { data: agg }] = await Promise.all([
        admin.from('limits').select('scope, period, budget_usd, warn_at, throttle_at, block_at').eq('org_id', ctx.orgId).eq('is_active', true),
        selectAll<{ model: string; bucket: string; cost_usd: number; total_tokens: number; request_count: number }>(() => admin.from('usage_agg').select('cost_usd').eq('org_id', ctx.orgId).gte('bucket', monthStart.toISOString().slice(0, 10))),
      ])
      const spend = (agg ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
      return {
        month_spend_usd: +spend.toFixed(4),
        limits: (limits ?? []).map(l => {
          const budget = Number(l.budget_usd ?? 0)
          const pct = budget > 0 ? +(spend / budget * 100).toFixed(1) : null
          const status = pct == null ? 'no_budget' : pct >= Number(l.block_at ?? 100) ? 'blocked' : pct >= Number(l.throttle_at ?? 90) ? 'throttled' : pct >= Number(l.warn_at ?? 70) ? 'warning' : 'ok'
          return { scope: l.scope, period: l.period, budget_usd: budget, pct_used: pct, status }
        }),
      }
    }

    // ── Rollup-backed analytics (org-local days) ──
    case 'get_breakdown': {
      const dim = parseDim(args.dim)
      const tz = await getOrgTimezone(ctx.orgId)
      const { from, to } = parseRange(args, daysAgoIn(0, tz))
      const limit = clampInt(args.limit, 20, 1, 100)
      const filters = parseFilters(args.filters)
      const scope = await resolveUserKeys(admin, ctx)
      // Members/viewers may see org totals by model/project/etc., but never
      // another person's spend: dim=member or a user_key filter is forced to "me".
      const scoped = scope !== null && (dim === 'member' || !!filters.user_key)
      const sets = scoped ? scopedFilterSets(filters, scope) : [filters]
      const parts = await Promise.all(sets.map(f => dashBreakdown(admin, ctx.orgId, from, to, dim, f, limit)))
      const merged = parts.length ? mergeBreakdowns(parts, limit) : { rows: [], other: null, total_keys: 0 }
      return {
        dim, from, to, timezone: tz, scope: scopeNote(scoped),
        rows: merged.rows.map(r => ({
          key: r.key || '(none)', cost_usd: r.cost_usd, metered_cost_usd: r.metered_cost_usd,
          notional_cost_usd: r.notional_cost_usd, requests: r.requests, total_tokens: r.total_tokens,
          input_tokens: r.input_tokens, output_tokens: r.output_tokens, cache_read_tokens: r.cache_read_tokens,
          active_days: r.active_days, users: r.users,
        })),
        other: merged.other, total_keys: merged.total_keys,
        note: 'metered_cost_usd is billable; notional_cost_usd is subscription usage priced at API rates (not a bill). Never add them together as a bill.',
      }
    }
    case 'get_sessions': {
      const tz = await getOrgTimezone(ctx.orgId)
      const { from, to } = parseRange(args, daysAgoIn(0, tz))
      const limit = clampInt(args.limit, 20, 1, 100)
      const offset = clampInt(args.offset, 0, 0, 10_000)
      const order = pick(args.order, SESSION_ORDER, 'recent')
      const filters = parseFilters(args.filters)
      const scope = await resolveUserKeys(admin, ctx)
      let page: Page<DashSession>
      if (scope === null) page = await dashSessions(admin, ctx.orgId, from, to, filters, { limit, offset, order })
      else {
        const parts = await Promise.all(scopedFilterSets(filters, scope)
          .map(f => dashSessions(admin, ctx.orgId, from, to, f, { limit: offset + limit, offset: 0, order })))
        page = mergePages(parts, r => r.session_id, sessionCmp(order), limit, offset)
      }
      return { from, to, timezone: tz, scope: scopeNote(scope !== null), total: page.total, sessions: page.rows }
    }
    case 'get_session': {
      const sessionId = String(args.session_id ?? '').trim()
      if (!sessionId || sessionId.length > 200) throw new Error('session_id is required (from get_sessions)')
      const scope = await resolveUserKeys(admin, ctx)
      const { data: s } = await admin.from('usage_sessions').select('*')
        .eq('org_id', ctx.orgId).eq('session_id', sessionId).maybeSingle()
      // Out-of-scope sessions look exactly like missing ones.
      if (!s || !inScope((s as { user_key?: string }).user_key, scope)) return { found: false, session_id: sessionId }
      const text = await captureOn(admin, ctx.orgId)
      const { data: evs } = await admin.from('usage_events')
        .select('created_at, model, input_tokens, output_tokens, cache_read_tokens, total_tokens, cost_usd, cost_basis, tool_name, agent_name, prompt_preview')
        .eq('org_id', ctx.orgId).eq('session_id', sessionId)
        .order('created_at', { ascending: true }).limit(200)
      return {
        found: true, scope: scopeNote(scope !== null), session: s,
        prompt_text: text ? 'redacted previews included' : 'prompt capture is off for this org',
        events: (evs ?? []).map(e => {
          const { prompt_preview, ...rest } = e as Record<string, unknown>
          return text ? { ...rest, prompt_preview: redact(prompt_preview as string | null) } : rest
        }),
        events_truncated: (evs ?? []).length === 200,
      }
    }
    case 'get_prompts': {
      const tz = await getOrgTimezone(ctx.orgId)
      const { from, to } = parseRange(args, daysAgoIn(0, tz))
      const limit = clampInt(args.limit, 20, 1, 100)
      const offset = clampInt(args.offset, 0, 0, 10_000)
      const order = pick(args.order, PROMPT_ORDER, 'cost')
      const filters = parseFilters(args.filters)
      const scope = await resolveUserKeys(admin, ctx)
      let page: Page<DashPrompt>
      if (scope === null) page = await dashPrompts(admin, ctx.orgId, from, to, filters, { limit, offset, order })
      else {
        const parts = await Promise.all(scopedFilterSets(filters, scope)
          .map(f => dashPrompts(admin, ctx.orgId, from, to, f, { limit: offset + limit, offset: 0, order })))
        page = mergePages(parts, r => r.prompt_key, promptCmp(order), limit, offset)
      }
      const wantText = args.include_text !== false
      const text = wantText && page.rows.length > 0 && await captureOn(admin, ctx.orgId)
      const previews = new Map<string, string>()
      if (text) {
        const keys = page.rows.map(r => r.prompt_key)
        const uuids = keys.filter(k => /^[0-9a-f-]{36}$/i.test(k))
        const [byCorr, byId] = await Promise.all([
          admin.from('usage_events').select('correlation_id, prompt_preview').eq('org_id', ctx.orgId)
            .in('correlation_id', keys).not('prompt_preview', 'is', null).limit(1000),
          uuids.length
            ? admin.from('usage_events').select('id, prompt_preview').eq('org_id', ctx.orgId)
              .in('id', uuids).not('prompt_preview', 'is', null).limit(1000)
            : Promise.resolve({ data: [] as { id: string; prompt_preview: string }[] }),
        ])
        for (const r of (byCorr.data ?? []) as { correlation_id: string; prompt_preview: string }[]) {
          if (!previews.has(r.correlation_id)) previews.set(r.correlation_id, r.prompt_preview)
        }
        for (const r of (byId.data ?? []) as { id: string; prompt_preview: string }[]) {
          if (!previews.has(r.id)) previews.set(r.id, r.prompt_preview)
        }
      }
      return {
        from, to, timezone: tz, scope: scopeNote(scope !== null), total: page.total,
        prompt_text: !wantText ? 'not requested' : text ? 'redacted previews included' : 'prompt capture is off for this org',
        prompts: page.rows.map(r => text ? { ...r, prompt_preview: redact(previews.get(r.prompt_key) ?? null) } : r),
      }
    }
    case 'get_mtd_and_forecast': {
      const tz = await getOrgTimezone(ctx.orgId)
      const today = daysAgoIn(0, tz)
      const monthStart = today.slice(0, 8) + '01'
      const trailingDays = clampInt(args.trailing_days, 7, 3, 30)
      const filters = parseFilters(args.filters)
      if (filters.user_key && ctx.scopeUserId !== null) {
        const scope = await resolveUserKeys(admin, ctx)
        if (!inScope(filters.user_key, scope)) throw new Error('You can only forecast your own spend (your role is scoped to your own usage).')
      }
      const [mtd, trailing] = await Promise.all([
        dashSummary(admin, ctx.orgId, monthStart, today, filters),
        dashSummary(admin, ctx.orgId, shiftDay(today, -trailingDays), shiftDay(today, -1), filters),
      ])
      return { timezone: tz, ...forecastMonth(today, mtd.series, trailing.series),
        note: 'Projection is a simple trailing average, not a commitment. metered = billable; notional = subscription usage at API rates (not a bill).' }
    }
    case 'get_insights': {
      if (!ctx.forward) return { available: false, note: 'Insights are not reachable from this server context.' }
      const url = `${ctx.forward.baseUrl}/api/v1/insights?org_id=${encodeURIComponent(ctx.orgId)}&days=${days}`
      let res: Response
      try {
        res = await fetch(url, { headers: { Authorization: ctx.forward.authorization, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(15_000) })
      } catch {
        return { available: false, note: 'Insights service did not respond.' }
      }
      if (res.status === 404) return { available: false, note: 'Insights are not enabled on this TokenFin deployment yet.' }
      if (!res.ok) throw new Error(`insights failed (${res.status})`)
      return res.json()
    }

    // ── Token saving ──
    case 'compress': {
      const content = String(args.content ?? '')
      if (!content) throw new Error('content is required')
      const { compressed, hash, tokensSaved, changed } = compressContent(content)
      if (!changed || !hash) return { compressed: content, hash: null, tokens_saved: 0, note: 'Content too small to compress.' }

      await ccrPut(hash, ctx.orgId, content) // reversible cache
      const model = typeof args.model === 'string' ? args.model : 'mcp'
      const costSaved = +(tokensSaved * inputPrice(model) / 1e6).toFixed(8)
      const { error: cmpErr } = await admin.from('usage_events').insert({
        org_id: ctx.orgId, project_id: ctx.projectId, api_key_id: ctx.keyId, user_id: ctx.userId, model,
        input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0,
        input_tokens_saved: tokensSaved, baseline_cost_usd: costSaved,
        tags: { source: 'mcp' }, metadata: { mcp_compress: true },
      })
      if (cmpErr) console.error('[mcp] compress savings insert failed:', cmpErr.message) // compression still succeeded
      return { compressed, hash, tokens_saved: tokensSaved, cost_saved: costSaved }
    }
    case 'retrieve': {
      const content = await ccrGet(String(args.hash ?? ''), ctx.orgId)
      return content == null ? { found: false, note: 'Original not found or expired.' } : { found: true, content }
    }
    case 'savings_stats': {
      const { data } = await selectAll<{ input_tokens_saved: number; baseline_cost_usd: number }>(() => admin.from('usage_events')
        .select('input_tokens_saved, baseline_cost_usd')
        .eq('org_id', ctx.orgId).gte('created_at', since).gt('input_tokens_saved', 0))
      const rows = data ?? []
      return {
        period_days: days,
        tokens_saved: rows.reduce((s, r) => s + Number(r.input_tokens_saved ?? 0), 0),
        cost_saved_usd: +rows.reduce((s, r) => s + Number(r.baseline_cost_usd ?? 0), 0).toFixed(4),
        compressions: rows.length,
      }
    }

    // ── Evaluation ──
    case 'evaluate': {
      // Spends the org's eval provider key and writes a score: owner/admin keys only.
      if (!can(ctx.role, 'prompts:view_all')) throw new Error('evaluate needs an owner or admin key.')
      const evaluator = args.evaluator === 'correctness' ? 'correctness' : 'faithfulness'
      const answer = String(args.answer ?? '')
      if (!answer) throw new Error('answer is required')
      const cfg = await resolveJudge(ctx.orgId)
      if (!cfg.key) throw new Error('No eval key configured for this org (set one in Evals settings).')
      const r = evaluator === 'faithfulness'
        ? await judgeFaithfulness(cfg, answer, String(args.context ?? ''))
        : await judgeCorrectness(cfg, String(args.question ?? ''), answer, String(args.reference ?? ''))
      await admin.from('eval_scores').insert({
        org_id: ctx.orgId, evaluator, target_type: 'span', target_id: null,
        score: r.score, passed: r.passed, rationale: r.rationale, judge_model: r.judgeModel,
      })
      return { evaluator, score: r.score, passed: r.passed, rationale: r.rationale }
    }
    case 'get_eval_summary': {
      const { data } = await admin.from('eval_scores')
        .select('evaluator, score, passed').eq('org_id', ctx.orgId).eq('evaluator', 'faithfulness').gte('created_at', since)
      const rows = (data ?? []).filter(r => r.score != null)
      const mean = rows.length ? +(rows.reduce((s, r) => s + Number(r.score), 0) / rows.length).toFixed(3) : null
      const hallucinationRate = rows.length ? +(rows.filter(r => r.passed === false).length / rows.length).toFixed(3) : null
      return { period_days: days, scored: rows.length, mean_faithfulness: mean, hallucination_rate: hallucinationRate }
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
