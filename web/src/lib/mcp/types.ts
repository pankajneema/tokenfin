/** Resolved identity for an authenticated MCP request. */
export interface KeyCtx {
  keyId: string
  orgId: string
  projectId: string | null
  scopes: string[]
}
