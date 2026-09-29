import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission, dbError } from '@/lib/api/auth'

/**
 * GET /api/v1/audit?org_id=…&action=…&before=<iso>&limit=100
 * Workspace audit trail, newest first. Owners and admins only.
 */
export async function GET(req: NextRequest) {
  const p      = req.nextUrl.searchParams
  const orgId  = p.get('org_id')
  const guard  = await requirePermission(orgId, 'members:view')
  if (guard instanceof NextResponse) return guard

  const limit  = Math.min(Math.max(Number(p.get('limit')) || 100, 1), 500)
  let q = createAdminClient()
    .from('audit_log')
    .select('id, actor_email, action, target_type, target_id, details, ip, created_at')
    .eq('org_id', orgId!)
    .order('created_at', { ascending: false })
    .limit(limit)
  const action = p.get('action')
  if (action) q = q.like('action', `${action.replace(/[%_]/g, '')}%`)
  const before = p.get('before')
  if (before && !Number.isNaN(Date.parse(before))) q = q.lt('created_at', before)

  const { data, error } = await q
  if (error) return dbError(error, 'GET audit')
  return NextResponse.json(data ?? [])
}
