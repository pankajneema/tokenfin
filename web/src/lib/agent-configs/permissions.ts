/**
 * Permission rule helpers for the Agents page (pure, client-safe):
 * "which rule wins" for a test call, and risk flags for dangerous rules.
 *
 * Claude Code: rules are `Tool` or `Tool(specifier)`; deny beats ask beats
 * allow, otherwise permissions.defaultMode decides. Bash specifiers ending in
 * `:*` are prefix matches; `*` is a wildcard. Path tools (Edit/Read/Write/…)
 * use gitignore-style globs. This is an approximation for explaining a config,
 * not a re-implementation of Claude Code's matcher.
 *
 * OpenCode: permission.bash is an action or a {pattern: action} map where `*`
 * / `?` are wildcards and the LAST matching pattern wins.
 */
export type Decision = 'allow' | 'ask' | 'deny'

const esc = (s: string) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')
function globRe(glob: string, pathLike: boolean): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++ }
    else if (c === '*') re += pathLike ? '[^/]*' : '.*'
    else if (c === '?') re += pathLike ? '[^/]' : '.'
    else re += esc(c)
  }
  return new RegExp(`^${re}$`)
}

export function parseRule(rule: string): { tool: string; spec: string | null } {
  const m = /^([^()]+)(?:\((.*)\))?$/.exec(rule.trim())
  return m ? { tool: m[1], spec: m[2] ?? null } : { tool: rule, spec: null }
}

const PATH_TOOLS = new Set(['Edit', 'Read', 'Write', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep'])

/** Does a Claude Code rule match a call written as `Tool(argument)`? */
export function claudeRuleMatches(rule: string, call: string): boolean {
  const r = parseRule(rule), c = parseRule(call)
  if (r.tool.startsWith('mcp__') && !r.spec) return c.tool === r.tool || c.tool.startsWith(r.tool + '__')
  if (r.tool !== c.tool) return false
  if (r.spec === null || r.spec === '*' || r.spec === '') return true
  const arg = (c.spec ?? '').trim()
  if (r.tool === 'Bash') {
    if (r.spec.endsWith(':*')) { const pre = r.spec.slice(0, -2); return arg === pre || arg.startsWith(pre + ' ') || arg.startsWith(pre) }
    return r.spec.includes('*') ? globRe(r.spec, false).test(arg) : arg === r.spec
  }
  if (PATH_TOOLS.has(r.tool)) {
    const spec = r.spec.replace(/^\.\//, '').replace(/^\/\//, '/')
    const a = arg.replace(/^\.\//, '')
    return globRe(spec, true).test(a) || (!spec.includes('/') && globRe(`**/${spec}`, true).test(a))
  }
  return r.spec.includes('*') ? globRe(r.spec, false).test(arg) : arg === r.spec
}

export interface ClaudePerms { allow: string[]; ask: string[]; deny: string[]; defaultMode: string | null }

export function claudeDecide(p: ClaudePerms, call: string): { decision: Decision | 'mode'; rule: string | null; list: 'deny' | 'ask' | 'allow' | null } {
  for (const list of ['deny', 'ask', 'allow'] as const) {
    const hit = p[list].find(r => claudeRuleMatches(r, call))
    if (hit) return { decision: list, rule: hit, list }
  }
  return { decision: 'mode', rule: null, list: null }
}

/** For each rule: is it shadowed by a higher-precedence list? (same call space) */
export function shadowedBy(p: ClaudePerms, rule: string, list: 'allow' | 'ask' | 'deny'): string | null {
  const higher = list === 'allow' ? [...p.deny, ...p.ask] : list === 'ask' ? p.deny : []
  const probe = rule
  return higher.find(h => h === rule || claudeRuleMatches(h, probe)) ?? null
}

export function claudeRuleRisk(rule: string, list: 'allow' | 'ask' | 'deny'): string | null {
  if (list !== 'allow') return null
  const { tool, spec } = parseRule(rule)
  if (tool === 'Bash' && (spec === null || spec === '*' || spec === ':*' || spec === '')) return 'lets Claude run ANY shell command without asking'
  if (tool === 'Bash' && spec && /^(sudo|rm|curl|wget|ssh|scp|dd|chmod|chown)\b/.test(spec)) return `auto-approves ${spec.split(/[\s:]/)[0]} commands`
  if (tool === 'Bash' && spec && /git push.*(-f|--force)/.test(spec)) return 'auto-approves force pushes'
  if ((tool === 'Write' || tool === 'Edit') && (spec === null || spec === '**' || spec === '/**')) return 'lets Claude edit any file without asking'
  return null
}

export function dirRisk(dir: string): string | null {
  return ['/', '~', '~/', '$HOME', '/Users', '/home', 'C:\\', 'C:/'].includes(dir.trim()) ? 'grants access to the whole disk / home directory' : null
}

// ── OpenCode ────────────────────────────────────────────────────────────────
export function ocBashDecide(bash: unknown, cmd: string): { action: Decision | null; pattern: string | null } {
  if (typeof bash === 'string') return { action: bash as Decision, pattern: '(all commands)' }
  if (!bash || typeof bash !== 'object') return { action: null, pattern: null }
  let hit: { action: Decision | null; pattern: string | null } = { action: null, pattern: null }
  for (const [pat, act] of Object.entries(bash as Record<string, string>)) {
    if (globRe(pat, false).test(cmd.trim())) hit = { action: act as Decision, pattern: pat }
  }
  return hit
}

export function ocRisk(permission: unknown): string[] {
  const out: string[] = []
  if (permission === 'allow') { out.push('permission is "allow" for everything — OpenCode never asks'); return out }
  const p = permission && typeof permission === 'object' ? permission as Record<string, unknown> : {}
  if (p.bash === 'allow') out.push('bash is "allow" — OpenCode runs any shell command without asking')
  else if (p.bash && typeof p.bash === 'object' && (p.bash as Record<string, unknown>)['*'] === 'allow') {
    out.push('bash "*" is "allow" — every command not denied by a later pattern runs without asking')
  }
  if (p.edit === 'allow' && p.bash === 'allow') out.push('edit and bash are both "allow" — fully unattended')
  return out
}
