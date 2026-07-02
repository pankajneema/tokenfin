import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/api/auth'
import { generate, judgePairwise } from '@/lib/eval/judge'
import { resolveJudge } from '@/lib/eval/config'
import { z } from 'zod'

/* POST /api/v1/evals/pairwise — A/B two models on one prompt, judge the winner.
   Optionally saves the prompt as a version if save_as is provided. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const schema = z.object({
    org_id:  z.string().uuid(),
    prompt:  z.string().min(1),
    model_a: z.string().min(1),
    model_b: z.string().min(1),
    save_as: z.string().max(120).optional(),   // optional prompt name → saves a version
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  const { org_id, prompt, model_a, model_b, save_as } = parsed.data

  const guard = await requirePermission(org_id, 'alerts:write')
  if (guard instanceof NextResponse) return guard
  const cfg = await resolveJudge(org_id)
  if (!cfg.key) return NextResponse.json({ error: 'No eval key — set your provider key in Evals settings (or EVAL_JUDGE_KEY).' }, { status: 400 })

  const admin = createAdminClient()
  let answerA = '', answerB = '', verdict
  try {
    ;[answerA, answerB] = await Promise.all([generate(cfg, model_a, prompt), generate(cfg, model_b, prompt)])
    verdict = await judgePairwise(cfg, prompt, answerA, answerB)
  } catch (e) {
    return NextResponse.json({ error: `pairwise failed: ${(e as Error).message}` }, { status: 502 })
  }

  await admin.from('eval_scores').insert({
    org_id, evaluator: 'pairwise', target_type: 'span', target_id: `${model_a} vs ${model_b}`,
    score: verdict.winner === 'A' ? 1 : verdict.winner === 'B' ? 0 : 0.5,
    rationale: verdict.rationale, model: verdict.winner === 'A' ? model_a : model_b, judge_model: verdict.judgeModel,
  })

  // Optional: persist the prompt as a new version.
  if (save_as) {
    let { data: p } = await admin.from('prompts').select('id').eq('org_id', org_id).eq('name', save_as).maybeSingle()
    if (!p) p = (await admin.from('prompts').insert({ org_id, name: save_as }).select('id').single()).data
    if (p) {
      const { count } = await admin.from('prompt_versions').select('id', { count: 'exact', head: true }).eq('prompt_id', p.id)
      await admin.from('prompt_versions').insert({ prompt_id: p.id, org_id, version: (count ?? 0) + 1, template: prompt })
    }
  }

  return NextResponse.json({
    winner: verdict.winner, rationale: verdict.rationale,
    model_a, model_b, answer_a: answerA, answer_b: answerB,
  })
}
