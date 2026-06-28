/** Resolved identity for an authenticated MCP request. */
export interface KeyCtx {
  orgId: string
  projectId: string | null
  scopes: string[]
}
