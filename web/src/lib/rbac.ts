/**
 * Role-Based Access Control — single source of truth.
 *
 * Roles (from members.role):
 *   owner   — full access, billing, delete org, change other owners
 *   admin   — manage all resources except billing and org deletion
 *   member  — read-only analytics + dashboard; cannot mutate
 *   viewer  — read-only, cannot see keys or member list
 *
 * Usage:
 *   import { can, type Role } from '@/lib/rbac'
 *   if (!can(role, 'keys:create')) return <Forbidden />
 */

export type Role = 'owner' | 'admin' | 'member' | 'viewer'

const OWNER_ADMIN  = ['owner', 'admin']  as const
const OWNER_ONLY   = ['owner']           as const
const ALL_ROLES    = ['owner', 'admin', 'member', 'viewer'] as const

export const PERMISSIONS = {
  /* Projects */
  'projects:create':       OWNER_ADMIN,
  'projects:edit':         OWNER_ADMIN,
  'projects:delete':       OWNER_ADMIN,

  /* Teams */
  'teams:manage':          OWNER_ADMIN,

  /* Org settings (name/slug) — owner only */
  'org:edit':              OWNER_ONLY,

  /* Model catalogue (org_models) */
  'models:manage':         OWNER_ADMIN,

  /* API Keys */
  'keys:view':             OWNER_ADMIN,
  'keys:create':           OWNER_ADMIN,
  'keys:delete':           OWNER_ADMIN,
  'keys:toggle':           OWNER_ADMIN,

  /* Members */
  'members:view':          OWNER_ADMIN,
  'members:invite':        OWNER_ADMIN,
  'members:remove':        OWNER_ONLY,
  'members:change_role':   OWNER_ONLY,

  /* Limits */
  'limits:write':          OWNER_ADMIN,

  /* Alerts */
  'alerts:write':          OWNER_ADMIN,

  /* Integrations */
  'integrations:manage':   OWNER_ADMIN,

  /* Billing — owner only, never admin */
  'billing:view':          OWNER_ONLY,
  'billing:edit':          OWNER_ONLY,

  /* MCP */
  'mcp:manage':            OWNER_ADMIN,

  /* Prompts / sessions — owners & admins see everyone's; members & viewers
     see only their own (see promptScope()). */
  'prompts:view_all':      OWNER_ADMIN,

  /* Analytics — everyone can read */
  'analytics:view':        ALL_ROLES,
  'dashboard:view':        ALL_ROLES,
} as const

export type Permission = keyof typeof PERMISSIONS

/** Returns true if `role` has the given permission. */
export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly string[]).includes(role)
}

/** Throws if role doesn't have the permission. Use in API routes. */
export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) {
    throw new ForbiddenError(`Role '${role}' cannot perform '${permission}'`)
  }
}

/**
 * promptScope — which user's prompts/sessions a caller may see.
 * Returns `null` when the role may see every user's prompts in the org
 * (owner/admin), otherwise the caller's own user id — pages must then filter
 * prompt/session queries with `.eq('user_id', scope)`.
 *
 * A non-admin with no user id (should not happen for sessions) gets a sentinel
 * that matches no row, so the page fails closed rather than showing everything.
 */
export const NO_USER_SCOPE = '00000000-0000-0000-0000-000000000000'
export function promptScope(role: Role | null | undefined, userId: string | null | undefined): string | null {
  if (role && can(role, 'prompts:view_all')) return null
  return userId || NO_USER_SCOPE
}

/**
 * Scopes for an API key's `kind`. New keys are split:
 *   ingest — write telemetry only (OTLP / SDK ingest)
 *   read   — analytics reads (MCP, CLI status)
 * Legacy keys carry ['read','write'] and keep working everywhere.
 */
export type KeyKind = 'ingest' | 'read' | 'legacy'
export function scopesForKind(kind: KeyKind): string[] {
  if (kind === 'ingest') return ['ingest']
  if (kind === 'read')   return ['read']
  return ['read', 'write']
}
export function kindForScopes(scopes: readonly string[]): KeyKind {
  const s = new Set(scopes)
  if (s.size === 1 && s.has('ingest')) return 'ingest'
  if (s.size === 1 && s.has('read'))   return 'read'
  return 'legacy'
}
/** True if the key may read analytics (legacy keys with no scopes recorded are allowed). */
export function keyCanRead(scopes: readonly string[] | null | undefined): boolean {
  const s = scopes ?? []
  return s.length === 0 || s.includes('read') || s.includes('admin')
}
/** True if the key may push telemetry. */
export function keyCanIngest(scopes: readonly string[] | null | undefined): boolean {
  const s = scopes ?? []
  return s.length === 0 || s.includes('write') || s.includes('ingest')
}

export class ForbiddenError extends Error {
  readonly status = 403
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

/** Human-readable role labels for the UI. */
export const ROLE_LABELS: Record<Role, string> = {
  owner:  'Owner',
  admin:  'Admin',
  member: 'Member',
  viewer: 'Viewer',
}

/** Role badge colors (CSS variable names). */
export const ROLE_COLORS: Record<Role, { bg: string; text: string }> = {
  owner:  { bg: 'var(--amber-bg)',     text: 'var(--amber)'   },
  admin:  { bg: 'var(--blue-bg)',      text: 'var(--blue)'    },
  member: { bg: 'var(--green-bg)',     text: 'var(--green)'   },
  viewer: { bg: 'var(--bg-tertiary)',  text: 'var(--fg-secondary)' },
}
