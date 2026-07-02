import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/api/auth'
import { judgeFaithfulness, judgeCorrectness, generate } from '@/lib/eval/judge'
import { resolveJudge } from '@/lib/eval/config'
import { z } from 'zod'

/**
 * POST /api/v1/evals/run — run an online evaluation.
 *  faithfulness (default): samples recent prompt_captures and scores hallucination
 *  (reference-free, grounded on `context` if present, else the prompt).
 * Writes eval_run + eval_scores; returns the summary (incl. hallucination_rate).
 * Requires migrations 014 + 018 and EVAL_JUDGE_KEY / ANTHROPIC_API_KEY.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const schema = z.object({
    org_id:     z.string().uuid(),
    evaluator:  z.enum(['faithfulness', 'correctness']).default('faithfulness'),
    days:       z.number().int().min(1).max(90).default(7),
    sample:     z.number().int().min(1).max(50).default(10),
    dataset_id: z.string().uuid().optional(),      // present → offline eval over a dataset
    model:      z.string().optional(),             // model to generate candidate answers (offline)
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  const { org_id, evaluator, days, sample, dataset_id, model: genModel } = parsed.data

  const guard = await requirePermission(org_id, 'alerts:write')
  if (guard instanceof NextResponse) return guard

  const cfg = await resolveJudge(org_id)
  if (!cfg.key) {
    return NextResponse.json({ error: 'No eval key — set your provider key in Evals settings (or EVAL_JUDGE_KEY).' }, { status: 400 })
  }

  const admin = createAdminClient()

  // ── Offline: generate answers for each example, then grade correctness vs reference ──
  if (dataset_id) {
    const model = genModel || 'claude-haiku-4-5'
    const { data: examples } = await admin
      .from('examples').select('id, input, reference_output')
      .eq('dataset_id', dataset_id).eq('org_id', org_id).limit(sample)
    const exs = (examples ?? []).filter(e => e.reference_output)
    if (exs.length === 0) return NextResponse.json({ error: 'Dataset has no examples with reference outputs.' }, { status: 400 })

    const { data: run } = await admin.from('eval_runs').insert({
      org_id, kind: 'offline', evaluator: 'correctness', dataset_id, judge_model: model,
      name: `correctness · dataset · ${new Date().toISOString().slice(0, 10)}`,
    }).select('id').single()
    const runId = run?.id
    const scores: number[] = []; let failures = 0, errors = 0
    for (const e of exs) {
      try {
        const q = (e.input as { text?: string })?.text ?? ''
        const answer = await generate(cfg, model, q)
        const r = await judgeCorrectness(cfg, q, answer, e.reference_output ?? '')
        scores.push(r.score); if (!r.passed) failures++
        await admin.from('eval_scores').insert({
          org_id, eval_run_id: runId, target_type: 'example', target_id: e.id,
          evaluator: 'correctness', score: r.score, passed: r.passed, rationale: r.rationale,
          model, judge_model: r.judgeModel,
        })
      } catch { errors++ }
    }
    const mean = scores.length ? +(scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(4) : null
    const summary = { count: scores.length, errors, mean_score: mean, fail_rate: scores.length ? +(failures / scores.length).toFixed(4) : null }
    if (runId) await admin.from('eval_runs').update({ summary }).eq('id', runId)
    return NextResponse.json({ eval_run_id: runId, evaluator: 'correctness', kind: 'offline', ...summary }, { status: 201 })
  }

  const since = new Date(Date.now() - days * 864e5).toISOString()
  const { data: caps } = await admin
    .from('prompt_captures')
    .select('id, model, prompt_text, response_text, context, cost_usd')
    .eq('org_id', org_id)
    .gte('created_at', since)
    .not('response_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(sample)

  const rows = caps ?? []
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No captured prompts to evaluate. Enable CAPTURE_PROMPTS on the gateway/MCP first.' }, { status: 400 })
  }

  const { data: run } = await admin.from('eval_runs').insert({
    org_id, kind: 'online', evaluator, name: `${evaluator} · ${new Date().toISOString().slice(0, 10)}`,
  }).select('id').single()
  const runId = run?.id

  const scores: number[] = []
  let failures = 0, errors = 0
  for (const c of rows) {
    try {
      const r = evaluator === 'faithfulness'
        ? await judgeFaithfulness(cfg, c.response_text ?? '', c.context || c.prompt_text || '')
        : await judgeCorrectness(cfg, c.prompt_text ?? '', c.response_text ?? '', c.context ?? '')
      scores.push(r.score)
      if (!r.passed) failures++
      await admin.from('eval_scores').insert({
        org_id, eval_run_id: runId, target_type: 'prompt_capture', target_id: c.id,
        evaluator, score: r.score, passed: r.passed, rationale: r.rationale,
        model: c.model, judge_model: r.judgeModel, cost_usd: Number(c.cost_usd ?? 0),
      })
    } catch { errors++ }
  }

  const mean = scores.length ? +(scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(4) : null
  const hallucinationRate = scores.length ? +(failures / scores.length).toFixed(4) : null
  const summary = { count: scores.length, errors, mean_score: mean, hallucination_rate: hallucinationRate }
  if (runId) await admin.from('eval_runs').update({ summary }).eq('id', runId)

  return NextResponse.json({ eval_run_id: runId, evaluator, ...summary }, { status: 201 })
}
