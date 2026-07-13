import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requirePermission } from '@/lib/api/auth'
import { getOrCreateSetupKey } from '@/lib/setup/key'
import { z } from 'zod'

/**
 * POST /api/v1/keys/setup-hub  { org_id }
 *
 * Idempotent get-or-create of the org's "setup-hub" key (read+write). Session-
 * authenticated and admin-only (keys:create). Returns the RAW key so the Setup
 * Hub can bake it into every install link. The raw value only ever travels over
 * the admin's authenticated dashboard session — it is sealed at rest, never
 * logged, and never exposed via any GET.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const parsed = z.object({ org_id: z.string().uuid() }).safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'org_id required' }, { status: 422 })

  const guard = await requirePermission(parsed.data.org_id, 'keys:create')
  if (guard instanceof NextResponse) return guard

  try {
    const key = await getOrCreateSetupKey(parsed.data.org_id, guard.userId)
    return NextResponse.json({ id: key.id, key: key.raw, masked: key.masked, created: key.created })
  } catch (e) {
    console.error('[setup-hub] key provisioning failed:', e)
    return NextResponse.json({ error: 'Could not provision setup key' }, { status: 500 })
  }
}
