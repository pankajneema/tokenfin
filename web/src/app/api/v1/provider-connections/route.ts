import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgMember, requirePermission, dbError } from '@/lib/api/auth'
import { sealKey } from '@/lib/crypto/key-reveal'
import { audit } from '@/lib/audit'
import { ANTHROPIC_ADMIN_KEY_RE } from '@/lib/billing-sync/anthropic'
import { OPENAI_ADMIN_KEY_RE } from '@/lib/billing-sync/openai'
import { syncAll, syncConnection, verifyProviderKey, type ConnectionRow } from '@/lib/billing-sync/sync'
import { ProviderApiError, keyHint, BILLING_PROVIDERS, type BillingProvider } from '@/lib/billing-sync/types'
import { CLAUDE_ADMIN_KEY_RE } from '@/lib/connectors/claude-code'
import { CURSOR_KEY_RE } from '@/lib/connectors/cursor'
import { GITHUB_ORG_RE, GITHUB_TOKEN_RE } from '@/lib/connectors/copilot'
import { REPO_RE } from '@/lib/connectors/github'
import { syncAllConnectors, syncConnector, verifyConnector, type ConnectorConfig, type ConnectorConnection } from '@/lib/connectors/sync'
import { ConnectorApiError, CONNECTOR_PROVIDERS, connectorKeyHint, isConnectorProvider, type ConnectorProvider } from '@/lib/connectors/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const PUBLIC_COLS = 'id, provider, key_hint, status, last_synced_at, last_error, created_at, config'
const ALL_PROVIDERS = [...BILLING_PROVIDERS, ...CONNECTOR_PROVIDERS] as [string, ...string[]]
const isBilling = (p: string): p is BillingProvider => (BILLING_PROVIDERS as readonly string[]).includes(p)

/* GET /api/v1/provider-connections?org_id=… — masked; never returns key material. */
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const guard = await requireOrgMember(orgId)
  if (guard instanceof NextResponse) return guard
  const { data, error } = await createAdminClient()
    .from('provider_connections').select(PUBLIC_COLS).eq('org_id', orgId!).order('provider')
  if (error) return dbError(error, 'GET provider-connections')
  return NextResponse.json(data ?? [])
}

const configSchema = z.object({
  github_org: z.string().trim().regex(GITHUB_ORG_RE, 'Invalid GitHub organization name').optional(),
  repos:      z.array(z.string().trim().regex(REPO_RE, 'Repos must look like owner/name')).max(100).optional(),
}).strict()

/*
 * POST /api/v1/provider-connections                   { org_id, provider, admin_key, config? } — connect (owner only)
 * POST /api/v1/provider-connections?action=sync       { org_id, provider? }                     — sync now (owner/admin)
 * POST /api/v1/provider-connections?action=github_map { org_id, login, user_key }               — map a GitHub login (owner/admin)
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const action = req.nextUrl.searchParams.get('action')
  if (action === 'sync') return syncNow(body)
  if (action === 'github_map') return mapGithubUser(body)

  const parsed = z.object({
    org_id:    z.string().uuid(),
    provider:  z.enum(ALL_PROVIDERS),
    admin_key: z.string().trim().min(20).max(512),
    config:    configSchema.optional(),
  }).safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  const { org_id, provider, admin_key } = parsed.data

  const guard = await requirePermission(org_id, 'org:edit')
  if (guard instanceof NextResponse) return guard

  if (isConnectorProvider(provider)) return connectConnector(org_id, provider, admin_key, parsed.data.config ?? {}, guard.userId)

  if (provider === 'anthropic' && !ANTHROPIC_ADMIN_KEY_RE.test(admin_key))
    return NextResponse.json({ error: 'Anthropic needs an Admin API key (starts with sk-ant-admin). Regular API keys cannot read cost reports.' }, { status: 422 })
  if (provider === 'openai' && !OPENAI_ADMIN_KEY_RE.test(admin_key))
    return NextResponse.json({ error: 'OpenAI needs an Admin key (starts with sk-admin-).' }, { status: 422 })
  const billingProvider = provider as BillingProvider

  // Test the key with one small read before saving it.
  try {
    await verifyProviderKey(billingProvider, admin_key)
  } catch (e) {
    const status = e instanceof ProviderApiError ? e.status : 0
    const hint = status === 401 || status === 403
      ? 'The provider rejected this key — make sure it is an organization Admin key with access to cost reports.'
      : `Could not reach the provider to verify the key: ${(e as Error).message}`
    return NextResponse.json({ error: hint }, { status: 422 })
  }

  let key_enc
  try { key_enc = sealKey(admin_key) } catch (e) {
    console.error('[provider-connections] seal failed:', (e as Error).message)
    return NextResponse.json({ error: 'Server encryption is not configured (KEY_ENCRYPTION_SECRET)' }, { status: 500 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.from('provider_connections')
    .upsert({ org_id, provider, key_enc, key_hint: keyHint(admin_key), status: 'pending', last_error: null, created_by: guard.userId },
      { onConflict: 'org_id,provider' })
    .select('id, org_id, provider, key_enc')
    .single()
  if (error) return dbError(error, 'POST provider-connections')

  // First sync right away so the reconciliation page has data.
  const result = await syncConnection(admin, data as ConnectionRow)
  const { data: pub } = await admin.from('provider_connections').select(PUBLIC_COLS).eq('id', data.id).single()
  return NextResponse.json({ connection: pub, sync: { ok: result.ok, rows: result.rows, error: result.error ?? null } }, { status: 201 })
}

/** Format rules per coding-tool connector; returns an error message or null. */
function checkConnectorInput(provider: ConnectorProvider, key: string, config: ConnectorConfig): string | null {
  switch (provider) {
    case 'claude_code_analytics':
      return CLAUDE_ADMIN_KEY_RE.test(key) ? null : 'Claude Code Analytics needs an Anthropic Admin API key (starts with sk-ant-admin).'
    case 'cursor':
      return CURSOR_KEY_RE.test(key) ? null : 'Paste a Cursor team Admin API key (Cursor dashboard → Settings → Advanced → Admin API keys).'
    case 'github_copilot':
      if (!GITHUB_TOKEN_RE.test(key)) return 'Paste a GitHub token (github_pat_… or ghp_…).'
      return config.github_org ? null : 'Enter the GitHub organization name whose Copilot metrics to read.'
    case 'github':
      return GITHUB_TOKEN_RE.test(key) ? null : 'Paste a fine-grained GitHub token (github_pat_…) with Pull requests: read on the repos.'
  }
}

async function connectConnector(org_id: string, provider: ConnectorProvider, key: string, config: ConnectorConfig, userId: string) {
  const bad = checkConnectorInput(provider, key, config)
  if (bad) return NextResponse.json({ error: bad }, { status: 422 })

  try {
    await verifyConnector(provider, key, config)
  } catch (e) {
    const status = e instanceof ConnectorApiError ? e.status : 0
    const hint = status === 401 || status === 403
      ? 'The vendor rejected this key — check that it is an admin/org-level key with read access.'
      : status === 404
        ? 'Not found — check the organization / repository name and that the token can see it.'
        : `Could not reach the vendor to verify the key: ${(e as Error).message}`
    return NextResponse.json({ error: hint }, { status: 422 })
  }

  let key_enc
  try { key_enc = sealKey(key) } catch (e) {
    console.error('[provider-connections] seal failed:', (e as Error).message)
    return NextResponse.json({ error: 'Server encryption is not configured (KEY_ENCRYPTION_SECRET)' }, { status: 500 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.from('provider_connections')
    .upsert({ org_id, provider, key_enc, key_hint: connectorKeyHint(provider, key), config, status: 'pending', last_error: null, created_by: userId },
      { onConflict: 'org_id,provider' })
    .select('id, org_id, provider, key_enc, config')
    .single()
  if (error) return dbError(error, 'POST provider-connections (connector)')
  await audit({ orgId: org_id, actorUserId: userId, action: 'provider.connect', targetType: 'provider_connection', targetId: data.id, details: { provider, ...config } })

  const result = await syncConnector(admin, data as ConnectorConnection)
  const { data: pub } = await admin.from('provider_connections').select(PUBLIC_COLS).eq('id', data.id).single()
  return NextResponse.json({
    connection: pub,
    sync: { ok: result.ok, rows: result.rows, error: result.error ?? null, warnings: result.warnings },
  }, { status: 201 })
}

async function syncNow(body: unknown) {
  const parsed = z.object({
    org_id:   z.string().uuid(),
    provider: z.enum(ALL_PROVIDERS).optional(),
  }).safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  const guard = await requirePermission(parsed.data.org_id, 'integrations:manage')
  if (guard instanceof NextResponse) return guard

  const { org_id: orgId, provider } = parsed.data
  const admin = createAdminClient()
  const results: { provider: string; ok: boolean; rows: number; error: string | null; warnings?: string[] }[] = []
  try {
    if (!provider || isBilling(provider)) {
      let b = await syncAll(admin, { orgId })
      if (provider) b = b.filter(r => r.provider === provider)
      results.push(...b.map(r => ({ provider: r.provider, ok: r.ok, rows: r.rows, error: r.error ?? null })))
    }
    if (!provider || isConnectorProvider(provider)) {
      const c = await syncAllConnectors(admin, { orgId, provider: provider && isConnectorProvider(provider) ? provider : undefined })
      results.push(...c.map(r => ({ provider: r.provider, ok: r.ok, rows: r.rows, error: r.error ?? null, warnings: r.warnings })))
    }
  } catch (e) {
    return dbError(e, 'sync provider-connections')
  }
  const { data: pub } = await admin.from('provider_connections').select(PUBLIC_COLS).eq('org_id', orgId).order('provider')
  return NextResponse.json({ results, connections: pub ?? [] })
}

async function mapGithubUser(body: unknown) {
  const parsed = z.object({
    org_id:   z.string().uuid(),
    login:    z.string().trim().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, 'Invalid GitHub login'),
    user_key: z.string().trim().email().max(320),
  }).safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  const guard = await requirePermission(parsed.data.org_id, 'integrations:manage')
  if (guard instanceof NextResponse) return guard
  const row = { org_id: parsed.data.org_id, login: parsed.data.login.toLowerCase(), user_key: parsed.data.user_key.toLowerCase() }
  const { error } = await createAdminClient().from('github_user_map').upsert(row, { onConflict: 'org_id,login' })
  if (error) return dbError(error, 'POST github_user_map')
  return NextResponse.json({ ok: true, mapping: row })
}

/*
 * DELETE /api/v1/provider-connections?org_id=…&provider=…   (owner only). Keeps synced history unless purge=1.
 * DELETE /api/v1/provider-connections?action=github_map&org_id=…&login=…  (owner/admin)
 */
export async function DELETE(req: NextRequest) {
  const sp       = req.nextUrl.searchParams
  const orgId    = sp.get('org_id')
  if (sp.get('action') === 'github_map') {
    const login = (sp.get('login') ?? '').trim().toLowerCase()
    if (!login) return NextResponse.json({ error: 'login is required' }, { status: 400 })
    const guard = await requirePermission(orgId, 'integrations:manage')
    if (guard instanceof NextResponse) return guard
    const { error } = await createAdminClient().from('github_user_map').delete().eq('org_id', orgId!).eq('login', login)
    if (error) return dbError(error, 'DELETE github_user_map')
    return NextResponse.json({ ok: true })
  }

  const provider = sp.get('provider')
  if (!provider || !(ALL_PROVIDERS as readonly string[]).includes(provider))
    return NextResponse.json({ error: `provider must be one of ${ALL_PROVIDERS.join(', ')}` }, { status: 400 })
  const guard = await requirePermission(orgId, 'org:edit')
  if (guard instanceof NextResponse) return guard

  const admin = createAdminClient()
  const { error } = await admin.from('provider_connections').delete().eq('org_id', orgId!).eq('provider', provider)
  if (error) return dbError(error, 'DELETE provider-connections')
  if (isConnectorProvider(provider))
    await audit({ orgId: orgId!, actorUserId: guard.userId, action: 'provider.disconnect', targetType: 'provider_connection', details: { provider } })
  if (sp.get('purge') === '1') {
    const purge = isBilling(provider)
      ? admin.from('provider_costs').delete().eq('org_id', orgId!).eq('provider', provider)
      : provider === 'github'
        ? admin.from('merged_prs').delete().eq('org_id', orgId!)
        : admin.from('coding_tool_usage').delete().eq('org_id', orgId!).eq('tool', provider)
    const { error: e2 } = await purge
    if (e2) return dbError(e2, 'DELETE purge history')
  }
  return NextResponse.json({ ok: true })
}
