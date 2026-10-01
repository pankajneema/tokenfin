import type { AgentId } from '@/lib/agent-configs/agents'

/** POST a pending change request. Returns an error message, or null on success. */
export async function submitChange(orgId: string, deviceRef: string, agent: AgentId, patch: Record<string, unknown>, reason: string): Promise<string | null> {
  const r = await fetch('/api/v1/agent-configs/changes', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ org_id: orgId, device_ref: deviceRef, agent, patch, reason }),
  })
  if (r.ok) return null
  const j = await r.json().catch(() => ({})) as { error?: string; details?: string[] }
  return [j.error ?? `HTTP ${r.status}`, ...(j.details ?? [])].join(' — ')
}
