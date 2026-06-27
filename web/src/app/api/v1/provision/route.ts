import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/api/auth'
import { sealKey, revealToken } from '@/lib/crypto/key-reveal'
import crypto from 'crypto'
import { z } from 'zod'

function db() { return createAdminClient() }

function generateApiKey(projectId: string, env: string): string {
  const envShort = env === 'production' ? 'prod' : env === 'staging' ? 'stg' : 'dev'
  const segment  = projectId.replace(/-/g, '').slice(0, 4)
  return `tfk_${envShort}_${segment}_${crypto.randomBytes(16).toString('hex')}`
}
function maskKey(raw: string): string {
  return `${raw.split('_').slice(0, 3).join('_')}_…${raw.slice(-4)}`
}

/**
 * POST /api/v1/provision — bulk onboard members and (optionally) auto-generate
 * an API key per member per project. Each key is retrievable exactly once via a
 * secure reveal link, so members never have to log in and create tokens, and
 * keys are never shared insecurely.
 *
 * Body: {
 *   org_id, role, env, team_id?, project_ids: string[],
 *   emails: string[], auto_key?: boolean,
 *   service_accounts?: { name: string, project_id: string }[]
 * }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const schema = z.object({
    org_id:      z.string().uuid(),
    role:        z.enum(['admin', 'member', 'viewer']).default('member'),
    env:         z.enum(['production', 'staging', 'development']).default('production'),
    team_id:     z.string().uuid().optional().nullable(),
    project_ids: z.array(z.string().uuid()).default([]),
    emails:      z.array(z.string().email()).default([]),
    auto_key:    z.boolean().default(true),
    service_accounts: z.array(z.object({
      name: z.string().min(1).max(80),
      project_id: z.string().uuid(),
    })).default([]),
  })
    .refine(d => d.emails.length > 0 || d.service_accounts.length > 0, {
      message: 'Provide at least one email or service account', path: ['emails'],
    })
    .refine(d => !d.auto_key || d.project_ids.length > 0 || d.service_accounts.length > 0, {
      message: 'auto_key requires at least one project', path: ['project_ids'],
    })

  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  const { org_id, role, env, team_id, project_ids, emails, auto_key, service_accounts } = parsed.data

  const guard = await requirePermission(org_id, 'members:invite')
  if (guard instanceof NextResponse) return guard
  const actorId = guard.userId

  const admin  = db()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tokenfin.curiousdevs.com'

  // Cache existing auth users so we can attribute keys to user_id when the
  // person already has an account (enables per-user analytics immediately).
  const { data: authList } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const userByEmail = new Map((authList?.users ?? []).map(u => [u.email?.toLowerCase(), u.id]))

  // Helper: create a key + a one-time reveal record. Returns the reveal URL.
  async function createKeyWithReveal(opts: {
    projectId: string; name: string; email?: string; userId?: string | null; serviceAccount?: boolean
  }): Promise<{ ok: true; reveal_url: string; project_id: string } | { ok: false; project_id: string; error: string }> {
    const raw     = generateApiKey(opts.projectId, env)
    const keyHash = crypto.createHash('sha256').update(raw).digest('hex')
    const { data: keyRow, error: keyErr } = await admin.from('api_keys').insert({
      org_id, project_id: opts.projectId, team_id: team_id ?? null,
      user_id: opts.userId ?? null, created_by: actorId,
      name: opts.name, key_hash: keyHash, key_prefix: maskKey(raw),
      env, scopes: ['read', 'write'], is_active: true,
      is_service_account: opts.serviceAccount ?? false,
    }).select('id').single()
    if (keyErr || !keyRow) return { ok: false, project_id: opts.projectId, error: keyErr?.message ?? 'insert failed' }

    const token  = revealToken()
    const sealed = sealKey(raw)
    const { error: revErr } = await admin.from('key_reveals').insert({
      token, key_id: keyRow.id, org_id, email: opts.email ?? null,
      ciphertext: sealed.ciphertext, iv: sealed.iv, auth_tag: sealed.authTag,
    })
    if (revErr) {
      await admin.from('api_keys').delete().eq('id', keyRow.id) // roll back the orphaned key
      return { ok: false, project_id: opts.projectId, error: revErr.message }
    }
    return { ok: true, reveal_url: `${appUrl}/keys/reveal/${token}`, project_id: opts.projectId }
  }

  const memberResults: Array<{ email: string; invited: boolean; keys: unknown[] }> = []

  for (const rawEmail of emails) {
    const email = rawEmail.trim().toLowerCase()
    if (!email) continue

    // 1. Invite (best-effort) + record the invitation row.
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${appUrl}/auth/callback?next=/accept-invitation`,
      data: { org_id, invited_by: actorId },
    })
    await admin.from('invitations').upsert({
      org_id, invited_by: actorId, email, role, status: 'pending',
      expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    }, { onConflict: 'org_id,email' })

    // 2. Auto-provision a key per selected project.
    const keys: unknown[] = []
    if (auto_key) {
      for (const projectId of project_ids) {
        keys.push(await createKeyWithReveal({
          projectId, name: `${email} (${env})`, email, userId: userByEmail.get(email) ?? null,
        }))
      }
    }
    memberResults.push({ email, invited: !inviteErr, keys })
  }

  // 3. Service accounts (non-human agents) — no invite, just a key + reveal link.
  const serviceResults = []
  for (const sa of service_accounts) {
    const r = await createKeyWithReveal({ projectId: sa.project_id, name: sa.name, serviceAccount: true })
    serviceResults.push({ name: sa.name, ...r })
  }

  return NextResponse.json({
    members: memberResults,
    service_accounts: serviceResults,
    summary: {
      members_invited: memberResults.filter(m => m.invited).length,
      keys_created: memberResults.flatMap(m => m.keys).filter((k: any) => k?.ok).length
        + serviceResults.filter((s: any) => s.ok).length,
    },
  }, { status: 201 })
}
