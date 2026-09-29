import type { Role } from '@/lib/rbac'

/** Resolved identity for an authenticated MCP request. */
export interface KeyCtx {
  keyId: string
  orgId: string
  projectId: string | null
  /** The key's owner: api_keys.user_id, else created_by (same rule as lib/api/auth.ts lookupApiKey). */
  userId: string | null
  scopes: string[]
  /** The owner's role in the org — every tool honours it. */
  role: Role
  /**
   * promptScope(role, userId): null = org-wide (owner/admin); otherwise the only
   * user whose prompts, sessions and per-member spend this caller may see.
   */
  scopeUserId: string | null
  /**
   * Set by the HTTP route so tools that delegate to another API route
   * (get_insights → GET /api/v1/insights) can call it as the same key.
   * Never logged, never returned.
   */
  forward?: { baseUrl: string; authorization: string }
}
