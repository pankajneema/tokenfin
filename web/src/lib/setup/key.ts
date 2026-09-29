/**
 * Setup Hub key provisioning (server-only).
 *
 * The Setup Hub injects a real, working key into every install link so the user
 * never copies one by hand. This module get-or-creates two reusable org-level
 * keys and returns their RAW values: an INGEST-only "setup-hub" key (OTLP/SDK)
 * and a READ-only "setup-hub-read" key (MCP).
 *
 * Idempotency: when KEY_ENCRYPTION_SECRET is configured (migration 022 columns),
 * the raw key is sealed at rest, so a returning admin gets the SAME key back
 * (decrypted). If encryption is unavailable we cannot re-reveal an old key, so we
 * mint a fresh one and deactivate the stale, unreadable "setup-hub" keys to avoid
 * accumulation. Never import in a 'use client' file.
 */
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { sealKey, openKey } from '@/lib/crypto/key-reveal'
import { scopesForKind } from '@/lib/rbac'
import { audit } from '@/lib/audit'

export const SETUP_KEY_NAME      = 'setup-hub'       // ingest-only: OTLP / SDK install links
export const SETUP_READ_KEY_NAME = 'setup-hub-read'  // read-only: MCP

/** Secondary reveal token suffix for the read key of a split CLI pair (cli/token → keys/reveal). */
export const READ_TOKEN_SUFFIX = '.read'

export interface SetupKeyPart {
  id: string
  raw: string
  masked: string
  projectId: string
  created: boolean
}

/**
 * The INGEST key is the top-level id/raw/masked (what install snippets embed for
 * OTLP). The separate READ key for MCP is under `.read`. Pre-split "setup-hub"
 * read+write keys (kind='legacy') are left active so existing installs keep working.
 */
export interface SetupKey extends SetupKeyPart {
  read: SetupKeyPart
}

function generateApiKey(projectId: string): string {
  const segment = projectId.replace(/-/g, '').slice(0, 4)
  return `tfk_prod_${segment}_${crypto.randomBytes(16).toString('hex')}`
}

function maskKey(raw: string): string {
  return `${raw.split('_').slice(0, 3).join('_')}_…${raw.slice(-4)}`
}

/** Resolve the org's first project, creating a "Default" one if none exists. */
async function resolveProjectId(orgId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('projects').select('id').eq('org_id', orgId)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (existing?.id) return existing.id as string

  const { data: created } = await admin
    .from('projects').insert({ org_id: orgId, name: 'Default', slug: 'default' })
    .select('id').single()
  return (created?.id as string | undefined) ?? null
}

async function getOrCreateKind(
  orgId: string, userId: string, name: string, kind: 'ingest' | 'read',
): Promise<SetupKeyPart> {
  const admin = createAdminClient()

  // 1. Reuse an existing, decryptable key of this kind.
  const { data: existing } = await admin
    .from('api_keys')
    .select('id, project_id, key_prefix, key_enc_cipher, key_enc_iv, key_enc_tag')
    .eq('org_id', orgId).eq('name', name).eq('kind', kind).eq('is_active', true)
    .order('created_at', { ascending: false })

  const rows = (existing ?? []) as Array<{
    id: string; project_id: string; key_prefix: string
    key_enc_cipher: string | null; key_enc_iv: string | null; key_enc_tag: string | null
  }>

  for (const k of rows) {
    if (k.key_enc_cipher && k.key_enc_iv && k.key_enc_tag) {
      try {
        const raw = openKey({ ciphertext: k.key_enc_cipher, iv: k.key_enc_iv, authTag: k.key_enc_tag })
        return { id: k.id, raw, masked: k.key_prefix, projectId: k.project_id, created: false }
      } catch { /* corrupt/rotated secret — fall through and mint a fresh one */ }
    }
  }

  // 2. Mint a fresh key.
  const projectId = await resolveProjectId(orgId)
  if (!projectId) throw new Error('No project available to attach the setup key')

  const raw     = generateApiKey(projectId)
  const keyHash = crypto.createHash('sha256').update(raw).digest('hex')
  let sealed: { ciphertext: string; iv: string; authTag: string } | null = null
  try { sealed = sealKey(raw) } catch { sealed = null }

  const payload: Record<string, unknown> = {
    org_id: orgId, project_id: projectId, name,
    // Setup-hub keys are ORG-LEVEL shared keys (selected by org+name+kind, reused
    // across admins) — user_id stays NULL so they are exempt from the per-member
    // unique index. created_by still records who made it.
    created_by: userId, user_id: null,
    key_hash: keyHash, key_prefix: maskKey(raw),
    env: 'production', scopes: scopesForKind(kind), kind, is_active: true,
  }
  if (sealed) {
    payload.key_enc_cipher = sealed.ciphertext
    payload.key_enc_iv     = sealed.iv
    payload.key_enc_tag    = sealed.authTag
  }

  const { data, error } = await admin.from('api_keys').insert(payload).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'setup key insert failed')

  // Deactivate stale, non-decryptable keys of this kind so they don't pile up.
  if (rows.length) {
    await admin.from('api_keys').update({ is_active: false }).in('id', rows.map(r => r.id))
  }

  await audit({
    orgId, actorUserId: userId, action: 'key.create', targetType: 'api_key', targetId: data.id as string,
    details: { via: 'setup_hub', name, kind, project_id: projectId },
  })

  return { id: data.id as string, raw, masked: maskKey(raw), projectId, created: true }
}

/** Get-or-create the org's setup-hub INGEST key (top level) + READ key (`.read`). */
export async function getOrCreateSetupKey(orgId: string, userId: string): Promise<SetupKey> {
  const ingest = await getOrCreateKind(orgId, userId, SETUP_KEY_NAME, 'ingest')
  const read   = await getOrCreateKind(orgId, userId, SETUP_READ_KEY_NAME, 'read')
  return { ...ingest, read }
}
