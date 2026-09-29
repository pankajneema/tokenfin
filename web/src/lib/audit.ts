import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * Append-only audit trail for workspace changes (Settings → Audit log).
 * Never throws: a failed audit write is logged but never breaks the action.
 */
export type AuditAction =
  | 'key.create' | 'key.delete' | 'key.toggle' | 'key.reveal'
  | 'limit.create' | 'limit.update' | 'limit.delete'
  | 'project.create' | 'project.update' | 'project.delete'
  | 'team.create' | 'team.update' | 'team.delete'
  | 'member.invite' | 'member.join' | 'member.role_change' | 'member.remove'
  | 'org.update' | 'org.timezone' | 'org.privacy'
  | 'allocation.create' | 'allocation.update' | 'allocation.delete'
  | 'data.delete' | 'data.retention'
  | 'integration.connect' | 'integration.disconnect'
  | 'provider.connect' | 'provider.disconnect'
  | 'alert.create' | 'alert.update' | 'alert.delete'
  | 'price.update'

export async function audit(entry: {
  orgId: string
  actorUserId?: string | null
  action: AuditAction
  targetType?: string
  targetId?: string | null
  details?: Record<string, unknown>
}): Promise<void> {
  try {
    const admin = createAdminClient()
    let actorEmail: string | null = null
    if (entry.actorUserId) {
      const { data } = await admin.auth.admin.getUserById(entry.actorUserId)
      actorEmail = data?.user?.email ?? null
    }
    let ip: string | null = null
    try {
      const h = await headers()
      ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || null
    } catch { /* not in a request scope */ }

    const { error } = await admin.from('audit_log').insert({
      org_id:        entry.orgId,
      actor_user_id: entry.actorUserId ?? null,
      actor_email:   actorEmail,
      action:        entry.action,
      target_type:   entry.targetType ?? null,
      target_id:     entry.targetId ?? null,
      details:       entry.details ?? {},
      ip,
    })
    if (error) console.error('[audit] insert failed:', error.message)
  } catch (e) {
    console.error('[audit] failed:', (e as Error).message)
  }
}
