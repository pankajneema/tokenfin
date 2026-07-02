import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgMember, requirePermission, dbError } from '@/lib/api/auth'
import { sealKey } from '@/lib/crypto/key-reveal'
import { z } from 'zod'

/* GET /api/v1/eval-settings?org_id= → { configured, judge_model } (never returns the key) */
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const guard = await requireOrgMember(orgId)
  if (guard instanceof NextResponse) return guard
  const { data } = await createAdminClient()
    .from('org_eval_settings').select('key_cipher, judge_model').eq('org_id', orgId!).maybeSingle()
  return NextResponse.json({ configured: !!data?.key_cipher, judge_model: data?.judge_model ?? 'claude-haiku-4-5' })
}

/* PUT /api/v1/eval-settings { org_id, key?, judge_model? } — store the org's eval key (encrypted) */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const schema = z.object({
    org_id: z.string().uuid(),
    key: z.string().min(10).optional(),                 // provider API key (BYO)
    judge_model: z.string().min(1).max(80).optional(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  const guard = await requirePermission(parsed.data.org_id, 'billing:edit') // owner-only (spending)
  if (guard instanceof NextResponse) return guard

  const row: Record<string, unknown> = { org_id: parsed.data.org_id, updated_at: new Date().toISOString() }
  if (parsed.data.judge_model) row.judge_model = parsed.data.judge_model
  if (parsed.data.key) {
    const sealed = sealKey(parsed.data.key)
    row.key_cipher = sealed.ciphertext; row.key_iv = sealed.iv; row.key_tag = sealed.authTag
  }
  const { error } = await createAdminClient().from('org_eval_settings').upsert(row, { onConflict: 'org_id' })
  if (error) return dbError(error, 'PUT eval-settings')
  return NextResponse.json({ ok: true })
}

/* DELETE /api/v1/eval-settings?org_id= — remove the org's key (revert to env fallback) */
export async function DELETE(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const guard = await requirePermission(orgId, 'billing:edit')
  if (guard instanceof NextResponse) return guard
  const { error } = await createAdminClient()
    .from('org_eval_settings').update({ key_cipher: null, key_iv: null, key_tag: null }).eq('org_id', orgId!)
  if (error) return dbError(error, 'DELETE eval-settings')
  return NextResponse.json({ ok: true })
}
