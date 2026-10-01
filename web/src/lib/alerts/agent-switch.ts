/**
 * Auto model switch for CLI agents (Claude Code, OpenCode, Codex, Gemini CLI).
 *
 * TokenFin is not in those agents' request path, so the SDK policy can't reach
 * them. Instead, a switch_model action queues a pending change request
 * (agent_config_changes, migration 022) that sets the agent's model on every
 * affected device; the CLI applies it on its next `tokenfin config pull` /
 * sync. Same allow-list as the Agents page (lib/agent-configs/allowlist.ts),
 * so nothing outside the `model` field can be touched. Server-only.
 *
 * Affected device = a synced device whose configured model matches the limit's
 * model filter (aliases like "opus" / "sonnet" count when the filter names that
 * family), limited to the limit's member / team.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { validatePatch, getPath } from '@/lib/agent-configs/allowlist'
import { isAgentId, type AgentId } from '@/lib/agent-configs/agents'
import { modelMatches, normModel } from './model-limits'

const ALIASES = ['opus', 'sonnet', 'haiku'] as const

/** Does an agent's configured model belong to the limited model family? */
export function agentModelMatches(prefix: string, configured: string): boolean {
  if (modelMatches(prefix, configured)) return true
  const c = normModel(configured)
  const p = normModel(prefix)
  // Claude Code aliases: "opus", "opusplan", "sonnet[1m]", …
  return ALIASES.some(a => c.startsWith(a) && p.includes(a))
}

/** The merge patch that sets `agent`'s model to `to`, given its current value. */
export function modelPatch(agent: AgentId, current: string, to: string): Record<string, unknown> | null {
  if (agent === 'gemini_cli') return { model: { name: to } }
  if (agent === 'opencode') {
    // OpenCode ids are provider/model: keep the current provider when `to` has none.
    const slash = current.indexOf('/')
    return { model: to.includes('/') || slash < 0 ? to : `${current.slice(0, slash)}/${to}` }
  }
  return { model: to }
}

const currentModel = (agent: AgentId, config: unknown): string | null => {
  const s = (config as { settings?: unknown } | null)?.settings
  const v = agent === 'gemini_cli' ? (getPath(s, 'model.name') ?? getPath(s, 'model')) : getPath(s, 'model')
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export interface AgentSwitchResult { queued: number; skipped: number; devices: string[] }

export async function requestAgentModelSwitch(admin: SupabaseClient, p: {
  orgId: string; fromModel: string; toModel: string; userIds: string[] | null; reason: string
}): Promise<AgentSwitchResult> {
  const out: AgentSwitchResult = { queued: 0, skipped: 0, devices: [] }
  let q = admin.from('agent_devices').select('id, user_id, hostname').eq('org_id', p.orgId)
  if (p.userIds) {
    if (!p.userIds.length) return out
    q = q.in('user_id', p.userIds)
  }
  const { data: devices, error } = await q
  if (error || !devices?.length) return out   // table missing (before 022) or no devices
  const byId = new Map((devices as { id: string; hostname: string | null }[]).map(d => [d.id, d]))
  const { data: configs } = await admin.from('agent_configs').select('device_ref, agent, config')
    .eq('org_id', p.orgId).in('device_ref', Array.from(byId.keys()))
  const { data: pending } = await admin.from('agent_config_changes').select('device_ref, agent, patch')
    .eq('org_id', p.orgId).eq('status', 'pending').in('device_ref', Array.from(byId.keys()))
  const pendingKey = new Set(((pending ?? []) as { device_ref: string; agent: string; patch: unknown }[])
    .map(c => `${c.device_ref}|${c.agent}|${JSON.stringify(c.patch)}`))

  const rows: Record<string, unknown>[] = []
  for (const c of (configs ?? []) as { device_ref: string; agent: string; config: unknown }[]) {
    if (!isAgentId(c.agent)) continue
    const cur = currentModel(c.agent, c.config)
    if (!cur || !agentModelMatches(p.fromModel, cur) || normModel(cur) === normModel(p.toModel)) { out.skipped++; continue }
    const patch = modelPatch(c.agent, cur, p.toModel)
    if (!patch || !validatePatch(c.agent, patch).ok) { out.skipped++; continue }
    if (pendingKey.has(`${c.device_ref}|${c.agent}|${JSON.stringify(patch)}`)) { out.skipped++; continue }
    rows.push({
      org_id: p.orgId, device_ref: c.device_ref, agent: c.agent, patch, reason: p.reason.slice(0, 500),
      requested_by: null, requested_by_email: 'TokenFin (automatic limit action)', status: 'pending',
    })
    out.devices.push(byId.get(c.device_ref)?.hostname ?? c.device_ref)
  }
  if (rows.length) {
    const { error: e } = await admin.from('agent_config_changes').insert(rows)
    if (!e) out.queued = rows.length
  }
  return out
}
