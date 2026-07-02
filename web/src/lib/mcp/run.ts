import { createAdminClient } from '@/lib/supabase/server'
import { compressContent } from './compress'
import { ccrPut, ccrGet } from './ccr'
import { inputPrice, computeCost } from './pricing'
import { judgeFaithfulness, judgeCorrectness } from '@/lib/eval/judge'
import { resolveJudge } from '@/lib/eval/config'
import type { KeyCtx } from './types'

const istBucket = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)

// Executes a single MCP tool, scoped to the caller's org. Every query filters by
// ctx.orgId — the authorization boundary.
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
      const { data } = await admin.from('usage_agg').select('cost_usd, total_tokens, request_count').eq('org_id', ctx.orgId).gte('bucket', since)
      const rows = data ?? []
      return {
        period_days: days,
        cost_usd: +rows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0).toFixed(4),
        total_tokens: rows.reduce((s, r) => s + Number(r.total_tokens ?? 0), 0),
        requests: rows.reduce((s, r) => s + Number(r.request_count ?? 0), 0),
      }
    }
    case 'get_usage_by_model': {
      const { data } = await admin.from('usage_agg').select('model, cost_usd, total_tokens, request_count').eq('org_id', ctx.orgId).gte('bucket', since)
      const byModel = new Map<string, { model: string; cost_usd: number; total_tokens: number; requests: number }>()
      for (const r of data ?? []) {
        const m = byModel.get(r.model) ?? { model: r.model, cost_usd: 0, total_tokens: 0, requests: 0 }
        m.cost_usd += Number(r.cost_usd ?? 0); m.total_tokens += Number(r.total_tokens ?? 0); m.requests += Number(r.request_count ?? 0)
        byModel.set(r.model, m)
      }
      return { period_days: days, models: Array.from(byModel.values()).map(m => ({ ...m, cost_usd: +m.cost_usd.toFixed(4) })).sort((a, b) => b.cost_usd - a.cost_usd) }
    }
    case 'get_daily_costs': {
      const { data } = await admin.from('usage_agg').select('bucket, cost_usd').eq('org_id', ctx.orgId).gte('bucket', since)
      const byDay = new Map<string, number>()
      for (const r of data ?? []) byDay.set(r.bucket, (byDay.get(r.bucket) ?? 0) + Number(r.cost_usd ?? 0))
      return { period_days: days, daily: Array.from(byDay.entries()).map(([day, cost]) => ({ day, cost_usd: +cost.toFixed(4) })).sort((a, b) => a.day.localeCompare(b.day)) }
    }
    case 'get_budget_status': {
      const monthStart = new Date(); monthStart.setDate(1)
      const [{ data: limits }, { data: agg }] = await Promise.all([
        admin.from('limits').select('scope, period, budget_usd, warn_at, throttle_at, block_at').eq('org_id', ctx.orgId).eq('is_active', true),
        admin.from('usage_agg').select('cost_usd').eq('org_id', ctx.orgId).gte('bucket', monthStart.toISOString().slice(0, 10)),
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

    // ── Token saving ──
    case 'compress': {
      const content = String(args.content ?? '')
      if (!content) throw new Error('content is required')
      const { compressed, hash, tokensSaved, changed } = compressContent(content)
      if (!changed || !hash) return { compressed: content, hash: null, tokens_saved: 0, note: 'Content too small to compress.' }

      await ccrPut(hash, ctx.orgId, content) // reversible cache
      const model = typeof args.model === 'string' ? args.model : 'mcp'
      const costSaved = +(tokensSaved * inputPrice(model) / 1e6).toFixed(8)
      await admin.from('usage_events').insert({
        org_id: ctx.orgId, project_id: ctx.projectId, api_key_id: ctx.keyId, model,
        input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0,
        input_tokens_saved: tokensSaved, baseline_cost_usd: costSaved,
        tags: { source: 'mcp' }, metadata: { mcp_compress: true },
      })
      return { compressed, hash, tokens_saved: tokensSaved, cost_saved: costSaved }
    }
    case 'retrieve': {
      const content = await ccrGet(String(args.hash ?? ''), ctx.orgId)
      return content == null ? { found: false, note: 'Original not found or expired.' } : { found: true, content }
    }
    case 'record_usage': {
      const model = String(args.model ?? '')
      if (!model) throw new Error('model is required')
      const inTok  = Math.max(0, Math.floor(Number(args.input_tokens) || 0))
      const outTok = Math.max(0, Math.floor(Number(args.output_tokens) || 0))
      const cost   = typeof args.cost_usd === 'number' ? args.cost_usd : computeCost(model, inTok, outTok)
      const bucket = istBucket()

      await admin.from('usage_events').insert({
        org_id: ctx.orgId, project_id: ctx.projectId, api_key_id: ctx.keyId, model,
        input_tokens: inTok, output_tokens: outTok, total_tokens: inTok + outTok,
        cost_usd: cost, tags: { source: 'mcp' }, metadata: { mcp: true },
      })

      // Roll into daily aggregates (analytics tools read usage_agg). Prefer the
      // RPC; fall back to a read-modify-write increment if it's unavailable.
      const { error } = await admin.rpc('upsert_usage_agg', {
        p_org_id: ctx.orgId, p_project_id: ctx.projectId, p_model: model,
        p_bucket: bucket, p_tokens: inTok + outTok, p_cost: cost, p_requests: 1,
      })
      if (error) {
        const { data: ex } = await admin.from('usage_agg')
          .select('total_tokens, cost_usd, request_count')
          .eq('org_id', ctx.orgId).eq('project_id', ctx.projectId).eq('model', model).eq('bucket', bucket).maybeSingle()
        await admin.from('usage_agg').upsert({
          org_id: ctx.orgId, project_id: ctx.projectId, model, bucket,
          total_tokens: (ex?.total_tokens ?? 0) + inTok + outTok,
          cost_usd: (ex?.cost_usd ?? 0) + cost,
          request_count: (ex?.request_count ?? 0) + 1,
        }, { onConflict: 'org_id,project_id,model,bucket' })
      }

      // Optional prompt capture (best-effort; needs migration 014).
      let captured = false
      if (typeof args.prompt === 'string' && args.prompt) {
        const { error: capErr } = await admin.from('prompt_captures').insert({
          org_id: ctx.orgId, project_id: ctx.projectId, model,
          prompt_text: String(args.prompt).slice(0, 100_000),
          response_text: typeof args.response === 'string' ? args.response.slice(0, 100_000) : null,
          input_tokens: inTok, output_tokens: outTok, cost_usd: cost,
        })
        captured = !capErr
      }
      return { recorded: true, model, total_tokens: inTok + outTok, cost_usd: cost, bucket, prompt_captured: captured }
    }
    case 'savings_stats': {
      const { data } = await admin.from('usage_events')
        .select('input_tokens_saved, baseline_cost_usd')
        .eq('org_id', ctx.orgId).gte('created_at', since).gt('input_tokens_saved', 0)
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
