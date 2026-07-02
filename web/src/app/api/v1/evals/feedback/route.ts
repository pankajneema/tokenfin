import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgMember, dbError } from '@/lib/api/auth'
import { z } from 'zod'

/* POST /api/v1/evals/feedback — human annotation (thumbs/label) → eval_scores(evaluator='human') */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const schema = z.object({
    org_id:      z.string().uuid(),
    target_type: z.enum(['prompt_capture', 'span', 'eval_score']).default('prompt_capture'),
    target_id:   z.string(),
    score:       z.number().min(0).max(1).optional(),
    passed:      z.boolean().optional(),
    rationale:   z.string().max(2000).optional(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  // Any org member can leave feedback (reviewers aren't necessarily admins).
  const guard = await requireOrgMember(parsed.data.org_id)
  if (guard instanceof NextResponse) return guard

  const { error } = await createAdminClient().from('eval_scores').insert({
    org_id: parsed.data.org_id, evaluator: 'human',
    target_type: parsed.data.target_type, target_id: parsed.data.target_id,
    score: parsed.data.score ?? null, passed: parsed.data.passed ?? null,
    rationale: parsed.data.rationale ?? null,
  })
  if (error) return dbError(error, 'POST feedback')
  return NextResponse.json({ ok: true }, { status: 201 })
}
