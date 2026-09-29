import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sealKey, revealToken } from '@/lib/crypto/key-reveal'
import { generateApiKey, maskKey, hashKey } from '@/lib/api/keygen'

/**
 * POST /api/v1/cli/token  { label? }
 *
 * Mints a personal API key for the logged-in user's org and returns a SINGLE-USE
 * reveal token (never the raw key). Called by the browser from /cli/authorize
 * with the session cookie; the CLI then exchanges the token once at
 * POST /api/v1/keys/reveal over loopback. Same security model as provisioning.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body  = await req.json().catch(() => ({}))
  const label = typeof body?.label === 'string' && body.label.trim()
    ? body.label.trim().slice(0, 60)
    : 'TokenFin CLI'

  const admin = createAdminClient()

  // 1. Resolve the caller's org via membership.
  const { data: members } = await admin.from('members').select('org_id, role')
    .eq('user_id', user.id).order('joined_at', { ascending: true }).limit(1)
  const orgId = members?.[0]?.org_id as string | undefined
  const role  = (members?.[0]?.role as string | undefined) ?? 'viewer'
  if (!orgId) return NextResponse.json({ error: 'No organization membership. Finish onboarding first.' }, { status: 403 })

  // 2. Find (or create) a project to attach the key to.
  let { data: proj } = await admin.from('projects').select('id').eq('org_id', orgId).limit(1).maybeSingle()
  if (!proj) {
    // Only roles that may create projects get an auto-created Default project.
    if (role !== 'owner' && role !== 'admin') {
      return NextResponse.json({ error: 'No project exists yet. Ask an org owner or admin to create one.' }, { status: 403 })
    }
    const { data: created, error: projErr } = await admin.from('projects')
      .insert({ org_id: orgId, name: 'Default', slug: 'default' }).select('id').single()
    if (projErr || !created) return NextResponse.json({ error: 'Could not create a default project' }, { status: 500 })
    proj = created
  }

  // 3. Generate + seal the raw key BEFORE inserting, so a missing
  //    KEY_ENCRYPTION_SECRET fails cleanly without orphaning a key row.
  const env = 'production'
  const raw = generateApiKey(proj.id, env)
  let sealed
  try { sealed = sealKey(raw) } catch {
    return NextResponse.json({ error: 'Server missing KEY_ENCRYPTION_SECRET; cannot complete CLI login.' }, { status: 501 })
  }

  // 3b. Enforce "one active key per (member, project)": retire any prior active
  //     key for this user+project so the new one doesn't collide with the partial
  //     unique index api_keys_member_project_unique (org_id, project_id, user_id)
  //     WHERE user_id IS NOT NULL AND is_active. A repeat `tokenfin login` thus
  //     ROTATES the key instead of erroring. (The org-level setup-hub key has
  //     user_id = NULL, so it is not touched.)
  await admin.from('api_keys')
    .update({ is_active: false })
    .eq('org_id', orgId).eq('project_id', proj.id).eq('user_id', user.id).eq('is_active', true)

  // 4. Insert the key (hash + masked prefix only).
  const { data: keyRow, error: keyErr } = await admin.from('api_keys').insert({
    org_id: orgId, project_id: proj.id, user_id: user.id, created_by: user.id,
    name: label, key_hash: hashKey(raw), key_prefix: maskKey(raw),
    // Viewers are read-only: their CLI key cannot write/ingest.
    env, scopes: role === 'viewer' ? ['read'] : ['read', 'write'], is_active: true,
  }).select('id').single()
  if (keyErr || !keyRow) {
    console.error('[cli/token] key insert failed:', keyErr)
    return NextResponse.json({ error: 'Key creation failed' }, { status: 500 })
  }

  // 5. Single-use reveal record (roll back the key if this fails).
  const token = revealToken()
  const { error: revErr } = await admin.from('key_reveals').insert({
    token, key_id: keyRow.id, org_id: orgId, email: user.email ?? null,
    ciphertext: sealed.ciphertext, iv: sealed.iv, auth_tag: sealed.authTag,
    // CLI exchanges the token immediately over loopback — keep the window short.
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  })
  if (revErr) {
    await admin.from('api_keys').delete().eq('id', keyRow.id)
    console.error('[cli/token] reveal insert failed:', revErr)
    return NextResponse.json({ error: 'Could not create reveal token' }, { status: 500 })
  }

  return NextResponse.json({ token })
}
