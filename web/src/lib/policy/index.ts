/**
 * SDK policy — what the TokenFin SDK wrappers enforce client-side
 * (GET /api/v1/policy). There is no proxy in the request path, so an active
 * model route or block only takes effect in processes that use
 * wrapAnthropic / wrapOpenAI (TS) or wrap_anthropic / wrap_openai (Python),
 * which fetch this every 60 s and fail open.
 *
 *   routes          active model_routes: rewrite `model` from → to before the call
 *                   (match "exact" = the whole id, "prefix" = id starts with from)
 *   blocked_models  active model_blocks (prefixes): the SDK throws
 *                   TokenFinPolicyError, only when the app opted in with enforcePolicy
 *   version         short hash of the above — changes whenever the policy does
 *
 * Server-only (service role).
 */
import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { TtlCache } from '@/lib/cache'

export interface PolicyRoute { from: string; to: string; match: 'exact' | 'prefix' }
export interface Policy {
  routes: PolicyRoute[]
  blocked_models: string[]
  version: string
  ttl_seconds: number
}

export const POLICY_TTL_SECONDS = 60
const cache = new TtlCache<string, Policy>(2_000, POLICY_TTL_SECONDS * 1000)

export function policyVersion(routes: PolicyRoute[], blocked: string[]): string {
  const canon = JSON.stringify({ r: routes.map(r => [r.from, r.to, r.match]).sort(), b: [...blocked].sort() })
  return crypto.createHash('sha256').update(canon).digest('hex').slice(0, 16)
}

export async function buildPolicy(admin: SupabaseClient, orgId: string): Promise<Policy> {
  const [{ data: routes, error: e1 }, { data: blocks, error: e2 }] = await Promise.all([
    admin.from('model_routes').select('*').eq('org_id', orgId).eq('is_active', true),
    admin.from('model_blocks').select('model').eq('org_id', orgId).eq('is_active', true),
  ])
  if (e1) throw new Error(`model_routes: ${e1.message}`)
  const rs: PolicyRoute[] = ((routes ?? []) as { from_model: string; to_model: string; match?: string | null }[])
    .map(r => ({ from: r.from_model, to: r.to_model, match: r.match === 'prefix' ? 'prefix' as const : 'exact' as const }))
    .sort((a, b) => a.from.localeCompare(b.from))
  // model_blocks arrives with migration 024; before that there are no blocks.
  const bs = e2 ? [] : Array.from(new Set(((blocks ?? []) as { model: string }[]).map(b => b.model))).sort()
  return { routes: rs, blocked_models: bs, version: policyVersion(rs, bs), ttl_seconds: POLICY_TTL_SECONDS }
}

/** Cached per org for 60 s (per server instance). */
export function getPolicy(admin: SupabaseClient, orgId: string): Promise<Policy> {
  return cache.getOrLoad(orgId, () => buildPolicy(admin, orgId))
}

/** Drop this instance's cached policy (after a route / block changes). */
export function invalidatePolicy(orgId: string): void {
  cache.delete(orgId)
}

// ── The same resolution the SDKs implement (kept here for tests and the UI) ──

const norm = (m: string) => m.trim().toLowerCase()

/** The route that applies to `model`: exact match first, then the longest prefix. */
export function resolveRoute(routes: readonly PolicyRoute[], model: string): PolicyRoute | null {
  const m = norm(model)
  const exact = routes.find(r => norm(r.from) === m)
  if (exact) return exact
  let best: PolicyRoute | null = null
  for (const r of routes) {
    if (r.match !== 'prefix' || !m.startsWith(norm(r.from))) continue
    if (!best || r.from.length > best.from.length) best = r
  }
  return best
}

export function isBlocked(blocked: readonly string[], model: string): boolean {
  const m = norm(model)
  return blocked.some(b => m.startsWith(norm(b)))
}
