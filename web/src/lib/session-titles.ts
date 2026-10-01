/**
 * Session names (migration 021, table session_titles): the agent's own title
 * (OpenCode) or the first line of the session's first captured prompt.
 * Server-only (service-role client).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export async function sessionTitles(admin: SupabaseClient, orgId: string, sessionIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = Array.from(new Set(sessionIds.filter(Boolean)))
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin.from('session_titles').select('session_id, title')
      .eq('org_id', orgId).in('session_id', ids.slice(i, i + 200))
    if (error) break                          // before migration 021: no names, nothing breaks
    for (const r of data ?? []) out.set(r.session_id as string, r.title as string)
  }
  return out
}

/** Short, stable label for a session without a title: "Session 3f9c2a". */
export const untitledLabel = (sessionId: string) => `Session ${sessionId.replace(/[^a-z0-9]/gi, '').slice(0, 6) || sessionId.slice(0, 6)}`
