/**
 * The ONLY config fields a dashboard user may change on someone's machine.
 *
 * A change is a JSON merge patch (RFC 7386) against the agent's main config
 * file (`config.settings` in a snapshot), plus TokenFin "virtual" operations
 * under the reserved `$tokenfin` key that the CLI translates into its own
 * canonical writers (never into free-form values):
 *   $tokenfin.repair     — rewrite the TokenFin telemetry block with the key
 *                          stored on that machine (the server never has it)
 *   $tokenfin.statusline — Claude Code: install / remove the TokenFin status line
 *   $tokenfin.plugin     — OpenCode: install / remove the TokenFin plugin
 *
 * Anything else is rejected, server-side here AND again by the CLI before it
 * writes (cli/lib/agentconfig.js ALLOW — keep the two lists identical).
 * Deliberately absent: arbitrary env vars, hooks, MCP servers, statusLine
 * commands, and permissions.defaultMode = bypassPermissions — all of which
 * would let a dashboard user run code on someone else's machine.
 * Pure — safe in client components.
 */
import type { AgentId } from './agents'

export type FieldKind =
  | 'model' | 'bool' | 'enum' | 'flag' | 'prompt_env'
  | 'rules'        // Claude Code permission rule list (array, replaced whole)
  | 'dirs'         // path list (array, replaced whole)
  | 'oc_action'    // OpenCode permission action: ask | allow | deny
  | 'oc_bash'      // OpenCode permission.bash: action, or {pattern: action} (replaced whole)
  | 'hook_ops'     // Claude Code hook operations (see HookOp)

export interface FieldSpec {
  path:     string
  label:    string
  kind:     FieldKind
  options?: readonly string[]
  help:     string
  /** The value replaces the whole target (never merged key by key). */
  replace?: boolean
  /** Not shown in the simple "Edit settings" form (has its own tab). */
  advanced?: boolean
}

/** Fixed hook templates the dashboard may add. No free-form commands. */
export const HOOK_TEMPLATES = { 'tokenfin-session': 'TokenFin session hooks (SessionStart + SessionEnd → session metadata)' } as const
export type HookOp =
  | { op: 'disable' | 'enable' | 'delete'; id: string }
  | { op: 'add_template'; template: keyof typeof HOOK_TEMPLATES }
export const OC_ACTIONS = ['ask', 'allow', 'deny'] as const

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,119}$/
export const CLAUDE_PERMISSION_MODES = ['default', 'acceptEdits', 'plan'] as const

const REPAIR: FieldSpec = { path: '$tokenfin.repair', label: 'Repair TokenFin connection', kind: 'flag', help: 'Rewrite the TokenFin telemetry block with the key stored on that machine.' }

export const ALLOW: Record<AgentId, FieldSpec[]> = {
  claude_code: [
    { path: 'model', label: 'Default model', kind: 'model', help: 'settings.json "model" (e.g. sonnet, opus, claude-sonnet-4-5).' },
    { path: 'env.OTEL_LOG_USER_PROMPTS', label: 'Prompt capture', kind: 'prompt_env', help: 'Send prompt text with each turn (env.OTEL_LOG_USER_PROMPTS = "1").' },
    { path: 'permissions.defaultMode', label: 'Permission mode', kind: 'enum', options: CLAUDE_PERMISSION_MODES, help: 'permissions.defaultMode. bypassPermissions can only be set on the machine itself.' },
    { path: '$tokenfin.statusline', label: 'TokenFin status line', kind: 'bool', help: 'Show today / month-to-date spend in Claude Code\'s status bar. Never replaces a custom status line.' },
    { path: 'permissions.allow', label: 'Allow rules', kind: 'rules', replace: true, advanced: true, help: 'Tool calls that run without asking.' },
    { path: 'permissions.ask', label: 'Ask rules', kind: 'rules', replace: true, advanced: true, help: 'Tool calls that always ask.' },
    { path: 'permissions.deny', label: 'Deny rules', kind: 'rules', replace: true, advanced: true, help: 'Tool calls that are always refused (deny wins over ask and allow).' },
    { path: 'permissions.additionalDirectories', label: 'Additional directories', kind: 'dirs', replace: true, advanced: true, help: 'Extra working directories Claude Code may access.' },
    { path: '$tokenfin.hooks', label: 'Hooks', kind: 'hook_ops', advanced: true, help: 'Enable / disable / delete existing hooks, or add a fixed TokenFin template.' },
    REPAIR,
  ],
  opencode: [
    { path: 'model', label: 'Model', kind: 'model', help: 'opencode.json "model" (provider/model).' },
    { path: 'small_model', label: 'Small model', kind: 'model', help: 'opencode.json "small_model", used for titles and summaries.' },
    { path: '$tokenfin.plugin', label: 'TokenFin plugin', kind: 'bool', help: 'The TokenFin capture plugin in ~/.config/opencode/plugin/.' },
    { path: 'permission.edit', label: 'Edit permission', kind: 'oc_action', advanced: true, help: 'File edits: ask, allow or deny.' },
    { path: 'permission.webfetch', label: 'Web fetch permission', kind: 'oc_action', advanced: true, help: 'webfetch tool: ask, allow or deny.' },
    { path: 'permission.bash', label: 'Bash permission', kind: 'oc_bash', replace: true, advanced: true, help: 'One action for every command, or a pattern → action map (the last matching pattern wins).' },
    REPAIR,
  ],
  codex_cli: [
    { path: 'model', label: 'Model', kind: 'model', help: 'config.toml top-level "model".' },
    { path: 'otel.log_user_prompt', label: 'Prompt capture', kind: 'bool', help: '[otel] log_user_prompt.' },
    REPAIR,
  ],
  gemini_cli: [
    { path: 'model.name', label: 'Model', kind: 'model', help: 'settings.json model.name.' },
    { path: 'telemetry.logPrompts', label: 'Prompt capture', kind: 'bool', help: 'telemetry.logPrompts.' },
    REPAIR,
  ],
}

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Paths whose value replaces the whole target (never descended / merged). */
export const ATOMIC: ReadonlySet<string> = new Set(
  Object.values(ALLOW).flat().filter(f => f.replace).map(f => f.path),
)

/**
 * Leaf paths of a merge patch: nested plain objects are descended; anything
 * else is a leaf. ATOMIC paths are leaves even when their value is an object
 * (OpenCode permission.bash maps are replaced whole, not merged).
 */
export function flattenPatch(patch: Record<string, unknown>, prefix = ''): { path: string; value: unknown }[] {
  const out: { path: string; value: unknown }[] = []
  for (const [k, v] of Object.entries(patch)) {
    const p = prefix ? `${prefix}.${k}` : k
    if (isPlain(v) && Object.keys(v).length > 0 && !ATOMIC.has(p)) out.push(...flattenPatch(v, p))
    else out.push({ path: p, value: v })
  }
  return out
}

// "Bash(git push:*)", "Edit(src/**)", "WebFetch(domain:example.com)", "mcp__github__create_issue", "Read"
const RULE_RE = /^[A-Za-z][A-Za-z0-9_-]{0,80}(\([^\n\r\0]{0,300}\))?$/
const PATH_RE = /^[^\n\r\0]{1,500}$/
const HOOK_ID_RE = /^[0-9a-f]{12}$/
const strList = (v: unknown, re: RegExp, max: number) =>
  Array.isArray(v) && v.length <= max && v.every(x => typeof x === 'string' && re.test(x)) && new Set(v).size === v.length

function checkHookOps(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 50) return 'must be a list of 1-50 hook operations'
  for (const raw of v) {
    const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
    const keys = Object.keys(o).sort().join(',')
    if (o.op === 'disable' || o.op === 'enable' || o.op === 'delete') {
      if (keys !== 'id,op' || typeof o.id !== 'string' || !HOOK_ID_RE.test(o.id)) return `${String(o.op)} needs exactly {op, id} with a 12-hex hook id`
    } else if (o.op === 'add_template') {
      if (keys !== 'op,template' || !Object.prototype.hasOwnProperty.call(HOOK_TEMPLATES, String(o.template))) return `unknown hook template ${String(o.template)}`
    } else return `unsupported hook op ${String(o.op)}`
  }
  return null
}

function checkValue(spec: FieldSpec, v: unknown): string | null {
  switch (spec.kind) {
    case 'rules':      return v === null || strList(v, RULE_RE, 500) ? null : 'must be a list of unique permission rules like Bash(git push:*) or Edit(src/**)'
    case 'dirs':       return v === null || strList(v, PATH_RE, 100) ? null : 'must be a list of unique single-line paths'
    case 'oc_action':  return v === null || (typeof v === 'string' && (OC_ACTIONS as readonly string[]).includes(v)) ? null : 'must be ask, allow or deny'
    case 'oc_bash': {
      if (v === null || (typeof v === 'string' && (OC_ACTIONS as readonly string[]).includes(v))) return null
      if (!isPlain(v)) return 'must be ask / allow / deny or a {pattern: action} map'
      const e = Object.entries(v)
      if (e.length > 500) return 'too many patterns'
      return e.every(([k, a]) => k.length > 0 && k.length <= 300 && !/[\n\r\0]/.test(k) && (OC_ACTIONS as readonly string[]).includes(a as string))
        ? null : 'each pattern must be single-line (≤300 chars) and map to ask, allow or deny'
    }
    case 'hook_ops':   return checkHookOps(v)
    case 'model':      return v === null || (typeof v === 'string' && MODEL_RE.test(v)) ? null : 'must be a model id (letters, digits, . _ - : / @) or null'
    case 'bool':       return typeof v === 'boolean' ? null : 'must be true or false'
    case 'flag':       return v === true ? null : 'must be true'
    case 'prompt_env': return v === '1' || v === null ? null : 'must be "1" (on) or null (off)'
    case 'enum':       return v === null || (typeof v === 'string' && (spec.options ?? []).includes(v)) ? null : `must be one of ${(spec.options ?? []).join(', ')} or null`
  }
}

export type PatchCheck = { ok: true; fields: { path: string; value: unknown }[] } | { ok: false; errors: string[] }

/** Validate a change request against the allow-list. */
export function validatePatch(agent: AgentId, patch: unknown): PatchCheck {
  if (!isPlain(patch)) return { ok: false, errors: ['patch must be a JSON object'] }
  if (JSON.stringify(patch).length > 4096) return { ok: false, errors: ['patch too large'] }
  const specs = new Map(ALLOW[agent].map(s => [s.path, s]))
  const leaves = flattenPatch(patch)
  if (leaves.length === 0) return { ok: false, errors: ['patch is empty'] }
  const errors: string[] = []
  for (const { path, value } of leaves) {
    const spec = specs.get(path)
    if (!spec) { errors.push(`${path}: not an editable field`); continue }
    const e = checkValue(spec, value)
    if (e) errors.push(`${path}: ${e}`)
  }
  return errors.length ? { ok: false, errors } : { ok: true, fields: leaves }
}

/** RFC 7386 merge patch (pure). `$tokenfin` ops are not applied here. */
export function applyMergePatch(target: unknown, patch: unknown, prefix = ''): unknown {
  if (!isPlain(patch)) return patch
  const out: Record<string, unknown> = isPlain(target) ? { ...target } : {}
  for (const [k, v] of Object.entries(patch)) {
    if (k === '$tokenfin' && !prefix) continue
    const p = prefix ? `${prefix}.${k}` : k
    if (v === null) delete out[k]
    else if (ATOMIC.has(p)) out[k] = v                     // replaced whole, never merged
    else out[k] = applyMergePatch(out[k], v, p)
  }
  return out
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const part of path.split('.')) {
    if (!isPlain(cur)) return undefined
    cur = cur[part]
  }
  return cur
}

/** Build a merge patch from { path: value } pairs (value null = remove). */
export function patchFrom(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [path, value] of Object.entries(values)) {
    const parts = path.split('.')
    let cur = out
    for (let i = 0; i < parts.length - 1; i++) {
      if (!isPlain(cur[parts[i]])) cur[parts[i]] = {}
      cur = cur[parts[i]] as Record<string, unknown>
    }
    cur[parts[parts.length - 1]] = value
  }
  return out
}
