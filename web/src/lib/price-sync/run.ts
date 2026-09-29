import type { SupabaseClient } from '@supabase/supabase-js'
import { priceFor } from '@/lib/mcp/pricing'
import { fetchAllRows, selectAll } from '@/lib/supabase/paginate'
import { comparePrices, effective, lookupUpstream, parseLiteLLM } from './compare'

/**
 * Nightly price catalog sync (called by /api/v1/cron/prices). Records
 *  • price_mismatch — our table vs the public LiteLLM catalog differs by > 1%
 *  • unpriced_seen  — a model priced with the fallback rate in the last 7 days
 * into price_sync_findings (org-independent; `orgs` = workspaces that used the
 * model recently, which scopes who sees and is notified about it). Findings no
 * longer observed are marked resolved. Each finding notifies the owners/admins
 * of its workspaces in-app once.
 */

export interface FindingRow {
  id: string; model: string; kind: 'price_mismatch' | 'unpriced_seen'
  ours: Record<string, unknown>; theirs: Record<string, unknown>; orgs: string[]
  first_seen: string; last_seen: string; notified_at: string | null; resolved_at: string | null
}

export interface SyncResult {
  upstream_models: number; mismatches: number; unpriced: number
  new_findings: number; resolved: number; notified_users: number
}

const DAYS = 7

export async function runPriceSync(admin: SupabaseClient, sourceJson: unknown, now = new Date()): Promise<SyncResult> {
  const upstream = parseLiteLLM(sourceJson)
  if (upstream.size === 0) throw new Error('price source returned no usable models')

  const since = new Date(now.getTime() - DAYS * 86_400_000).toISOString()
  const usage = await fetchAllRows<{ org_id: string; model: string; events: number; unpriced: number }>((a, b) =>
    admin.rpc('price_sync_model_usage', { p_since: since }).range(a, b))

  // Which workspaces used each upstream model id (dated ids fold into their upstream family).
  const orgsByUpstream = new Map<string, Set<string>>()
  const unpriced = new Map<string, { orgs: Set<string>; events: number }>()
  for (const u of usage) {
    const hit = lookupUpstream(upstream, u.model)
    if (hit) {
      const s = orgsByUpstream.get(hit.key) ?? new Set<string>()
      s.add(u.org_id); orgsByUpstream.set(hit.key, s)
    }
    if (Number(u.unpriced) > 0) {
      const m = unpriced.get(u.model) ?? { orgs: new Set<string>(), events: 0 }
      m.orgs.add(u.org_id); m.events += Number(u.unpriced); unpriced.set(u.model, m)
    }
  }

  type Desired = { model: string; kind: FindingRow['kind']; ours: Record<string, unknown>; theirs: Record<string, unknown>; orgs: string[] }
  const desired: Desired[] = []
  for (const m of comparePrices(upstream, priceFor)) {
    desired.push({
      model: m.model, kind: 'price_mismatch', ours: { ...m.ours }, orgs: Array.from(orgsByUpstream.get(m.model) ?? []).sort(),
      theirs: { ...m.theirs, fields: m.fields, source: 'litellm' },
    })
  }
  for (const [model, u] of Array.from(unpriced.entries())) {
    const up = lookupUpstream(upstream, model)
    desired.push({
      model, kind: 'unpriced_seen', orgs: Array.from(u.orgs).sort(),
      ours: { fallback: effective(priceFor(model)), events_7d: u.events },
      theirs: up ? { ...up.price, matched: up.key, source: 'litellm' } : {},
    })
  }

  const { data: existing } = await selectAll<FindingRow>(() => admin.from('price_sync_findings')
    .select('id, model, kind, ours, theirs, orgs, first_seen, last_seen, notified_at, resolved_at'))
  const byKey = new Map(existing.map(f => [`${f.kind}\u0001${f.model}`, f]))
  const nowIso = now.toISOString()

  // Upsert observed findings (first_seen / notified_at keep their stored values).
  for (let i = 0; i < desired.length; i += 500) {
    const chunk = desired.slice(i, i + 500).map(d => ({ ...d, last_seen: nowIso, resolved_at: null }))
    const { error } = await admin.from('price_sync_findings').upsert(chunk, { onConflict: 'model,kind' })
    if (error) throw new Error(`upsert findings: ${error.message}`)
  }
  const wanted = new Set(desired.map(d => `${d.kind}\u0001${d.model}`))
  const stale = existing.filter(f => !f.resolved_at && !wanted.has(`${f.kind}\u0001${f.model}`)).map(f => f.id)
  for (let i = 0; i < stale.length; i += 200) {
    await admin.from('price_sync_findings').update({ resolved_at: nowIso }).in('id', stale.slice(i, i + 200))
  }
  const newCount = desired.filter(d => !byKey.has(`${d.kind}\u0001${d.model}`)).length

  // In-app notification, once per finding, to owners/admins of the workspaces that use the model.
  const pending = desired.filter(d => d.orgs.length > 0 && !byKey.get(`${d.kind}\u0001${d.model}`)?.notified_at)
  let notified = 0
  if (pending.length) {
    const orgIds = Array.from(new Set(pending.flatMap(d => d.orgs)))
    const admins: { org_id: string; user_id: string }[] = []
    for (let i = 0; i < orgIds.length; i += 200) {
      const { data } = await selectAll<{ org_id: string; user_id: string }>(() => admin.from('members')
        .select('id, org_id, user_id').in('org_id', orgIds.slice(i, i + 200)).in('role', ['owner', 'admin']))
      admins.push(...data)
    }
    const rows: { org_id: string; user_id: string; type: string; title: string; body: string }[] = []
    for (const d of pending) {
      const { title, body } = describeFinding(d)
      for (const a of admins) if (d.orgs.includes(a.org_id)) rows.push({ org_id: a.org_id, user_id: a.user_id, type: 'price_sync', title, body })
    }
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from('notifications').insert(rows.slice(i, i + 500))
      if (error) throw new Error(`notify: ${error.message}`)
    }
    notified = rows.length
    for (const kind of ['price_mismatch', 'unpriced_seen'] as const) {
      const ms = pending.filter(d => d.kind === kind).map(d => d.model)
      for (let i = 0; i < ms.length; i += 200) {
        await admin.from('price_sync_findings').update({ notified_at: nowIso }).eq('kind', kind).in('model', ms.slice(i, i + 200))
      }
    }
  }

  return {
    upstream_models: upstream.size,
    mismatches: desired.filter(d => d.kind === 'price_mismatch').length,
    unpriced: desired.filter(d => d.kind === 'unpriced_seen').length,
    new_findings: newCount, resolved: stale.length, notified_users: notified,
  }
}

const money = (n: unknown) => (typeof n === 'number' ? `$${+n.toFixed(4)}` : '—')

export function describeFinding(d: { model: string; kind: FindingRow['kind']; ours: Record<string, unknown>; theirs: Record<string, unknown> }): { title: string; body: string } {
  if (d.kind === 'unpriced_seen') {
    const t = d.theirs as { in?: number; out?: number; matched?: string }
    const hint = t.in != null ? ` The public LiteLLM catalog lists ${t.matched} at ${money(t.in)} in / ${money(t.out)} out per 1M tokens.` : ''
    return {
      title: `Unpriced model in use: ${d.model}`,
      body: `Usage of ${d.model} is being priced with the fallback rate, so its cost may be wrong. Add a custom price under Models.${hint}`,
    }
  }
  const o = d.ours as { in?: number; out?: number }
  const t = d.theirs as { in?: number; out?: number; fields?: string[] }
  return {
    title: `Price check: ${d.model} differs from the public catalog`,
    body: `TokenFin prices ${d.model} at ${money(o.in)} in / ${money(o.out)} out per 1M tokens; LiteLLM lists ${money(t.in)} / ${money(t.out)} (differs: ${(t.fields ?? []).join(', ')}). Verify with the provider and set a custom price if needed.`,
  }
}
