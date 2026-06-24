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
  'projects:delete':       OWNER_ADMIN,

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
