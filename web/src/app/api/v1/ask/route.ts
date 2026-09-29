/**
 * POST /api/v1/ask  { question }  — "Ask your spend" from the ⌘K palette.
 *
 * Session auth via the shared org context (lib/org-context). Answers come from
 * lib/rollups (org-local days). Members/viewers are scoped to their own usage
 * (lib/rbac promptScope). If ANTHROPIC_API_KEY is set, questions the
 * deterministic parser can't place are mapped to an intent by Claude — only the
 * question text is sent, never usage data.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getOrgContext } from '@/lib/org-context'
import { createAdminClient } from '@/lib/supabase/server'
import { dashSummary, dashBreakdown, userKeyFor } from '@/lib/rollups'
import { promptScope } from '@/lib/rbac'
import { toZonedDate } from '@/lib/dates'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { ask, type AskData } from '@/lib/ask'
import { mapQuestionWithLLM } from '@/lib/ask/llm'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({ question: z.string().trim().min(1).max(300) })

export async function POST(req: NextRequest) {
  const ctx = await getOrgContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ctx.orgId) return NextResponse.json({ error: 'No organization' }, { status: 403 })

  let parsed
  try { parsed = bodySchema.safeParse(await req.json()) } catch { parsed = null }
  if (!parsed?.success) return NextResponse.json({ error: 'Body must be { question: string (1-300 chars) }' }, { status: 400 })

  const admin = createAdminClient()
  const orgId = ctx.orgId
  const scope = promptScope(ctx.role, ctx.user.id)
  const scopeUserKey = scope ? userKeyFor({ user_email: ctx.user.email, user_id: ctx.user.id }) : null

  let names: Map<string, string> | null = null
  const loadNames = async () => {
    if (names) return names
    const rows = await fetchAllRows<{ id: string; name: string }>((from, to) =>
      admin.from('projects').select('id, name').eq('org_id', orgId).order('id').range(from, to))
    names = new Map(rows.map(r => [r.id, r.name]))
    return names
  }

  const data: AskData = {
    summary: (from, to, filters) => dashSummary(admin, orgId, from, to, filters),
    breakdown: async (from, to, dim, filters, limit) => {
      const bd = await dashBreakdown(admin, orgId, from, to, dim, filters, limit)
      if (dim === 'project') await loadNames()
      return bd
    },
    projectName: id => names?.get(id) ?? id,
  }

  try {
    const result = await ask(parsed.data.question, data, { today: toZonedDate(new Date(), ctx.timezone), scopeUserKey },
      process.env.ANTHROPIC_API_KEY ? q => mapQuestionWithLLM(q) : undefined)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[ask]', e)
    return NextResponse.json({ error: 'Could not answer that right now' }, { status: 500 })
  }
}
