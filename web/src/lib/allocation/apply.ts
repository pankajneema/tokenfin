/**
 * Cost allocation rules — pure functions (no I/O), shared by the chargeback
 * CSV, the FOCUS export Tags, and the Settings → Allocation preview.
 *
 * Two rule kinds:
 *  • assign        — when `match` matches a usage record, set team and/or
 *                    cost_center. Rules run in ascending priority; for each
 *                    field the first matching rule wins. A member's own team
 *                    (members.team_id) is the fallback when no rule sets team.
 *  • shared_split  — cost left with no team after assignment (and matching the
 *                    rule's `match`, if any) is split across teams in
 *                    proportion to their attributed cost. `assign.among` may
 *                    restrict the split to named teams.
 *
 * `match` keys are ANDed; an empty match matches everything:
 *   { tag: 'cost_center', equals: 'cc-42' }   tag equality (no `equals` = tag present)
 *   { repo_prefix: 'payments-' }              repo name/URL path segment prefix
 *   { email_domain: 'contractor.com' }        user email domain (sub-domains match)
 *   { project_id: '…uuid…' }                  project
 *   { source: 'claude_code' }                 capture source
 *   { model_prefix: 'gpt-' }                  model id prefix
 */

export type RuleKind = 'assign' | 'shared_split'

export interface RuleMatch {
  tag?: string
  equals?: string
  repo_prefix?: string
  email_domain?: string
  project_id?: string
  source?: string
  model_prefix?: string
}

export interface RuleAssign {
  team?: string
  cost_center?: string
  /** shared_split only: restrict the split to these team names. */
  among?: string[]
}

export interface AllocationRule {
  id: string
  name?: string
  kind: RuleKind
  priority: number
  match: RuleMatch
  assign: RuleAssign
  is_active?: boolean
  created_at?: string
}

/** The attributes of a usage record (or a grouped row) that rules can see. */
export interface AllocationSubject {
  user_id?: string | null
  user_email?: string | null
  repo?: string | null
  project_id?: string | null
  source?: string | null
  model?: string | null
  tags?: Record<string, unknown> | null
  /** Team from members.team_id (already resolved to a name). */
  member_team?: string | null
}

export interface Allocation {
  team: string | null
  cost_center: string | null
  /** Rule ids that contributed (team rule first). */
  rule_ids: string[]
  /** 'rule' | 'member' | null — where the team came from. */
  team_from: 'rule' | 'member' | null
}

export const MATCH_KEYS = ['tag', 'equals', 'repo_prefix', 'email_domain', 'project_id', 'source', 'model_prefix'] as const

/** Validate/normalize one rule. Returns an error message or the clean rule. */
export function normalizeRule(r: {
  id?: string; name?: string; kind?: string; priority?: number
  match?: Record<string, unknown>; assign?: Record<string, unknown>; is_active?: boolean; created_at?: string
}): AllocationRule | string {
  const kind = (r.kind ?? 'assign') as RuleKind
  if (kind !== 'assign' && kind !== 'shared_split') return 'kind must be assign or shared_split'
  const match: RuleMatch = {}
  for (const [k, v] of Object.entries(r.match ?? {})) {
    if (!(MATCH_KEYS as readonly string[]).includes(k)) return `unknown match key "${k}"`
    if (v == null || v === '') continue
    if (typeof v !== 'string') return `match.${k} must be a string`
    ;(match as Record<string, string>)[k] = v.trim()
  }
  if (match.equals != null && !match.tag) return 'match.equals needs match.tag'
  const a = r.assign ?? {}
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const assign: RuleAssign = { team: str(a.team), cost_center: str(a.cost_center) }
  if (Array.isArray(a.among)) {
    const among = a.among.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim())
    if (among.length) assign.among = among
  }
  if (kind === 'assign' && !assign.team && !assign.cost_center) return 'an assign rule must set team or cost_center'
  return {
    id: r.id ?? '', name: r.name ?? '', kind,
    priority: Number.isFinite(r.priority) ? Math.trunc(r.priority as number) : 100,
    match, assign, is_active: r.is_active ?? true, created_at: r.created_at,
  }
}

/** Stable evaluation order: priority asc, then created_at asc, then id. */
export function sortRules(rules: AllocationRule[]): AllocationRule[] {
  return rules
    .filter(r => r.is_active !== false)
    .slice()
    .sort((a, b) => a.priority - b.priority
      || String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
      || a.id.localeCompare(b.id))
}

function emailDomain(email: string | null | undefined): string | null {
  const at = (email ?? '').lastIndexOf('@')
  return at >= 0 ? email!.slice(at + 1).toLowerCase() : null
}

/** Last path segment of a repo string ("org/payments-api", git URL, or bare name). */
function repoNames(repo: string): string[] {
  const clean = repo.trim().replace(/\.git$/i, '').replace(/\/+$/, '')
  const last = clean.split(/[/:]/).pop() ?? clean
  return last === clean ? [clean] : [clean, last]
}

export function matches(m: RuleMatch, s: AllocationSubject): boolean {
  if (m.tag) {
    const v = s.tags?.[m.tag]
    if (v == null || v === '') return false
    if (m.equals != null && String(v) !== m.equals) return false
  }
  if (m.repo_prefix) {
    if (!s.repo) return false
    const p = m.repo_prefix.toLowerCase()
    if (!repoNames(s.repo).some(n => n.toLowerCase().startsWith(p))) return false
  }
  if (m.email_domain) {
    const d = emailDomain(s.user_email)
    const want = m.email_domain.toLowerCase().replace(/^@/, '')
    if (!d || !(d === want || d.endsWith('.' + want))) return false
  }
  if (m.project_id && s.project_id !== m.project_id) return false
  if (m.source && (s.source ?? '') !== m.source) return false
  if (m.model_prefix && !(s.model ?? '').toLowerCase().startsWith(m.model_prefix.toLowerCase())) return false
  return true
}

/** Resolve team + cost_center for one subject. `rules` should be pre-sorted. */
export function allocate(s: AllocationSubject, rules: AllocationRule[]): Allocation {
  let team: string | null = null
  let cost_center: string | null = null
  const rule_ids: string[] = []
  for (const r of rules) {
    if (r.kind !== 'assign' || r.is_active === false) continue
    if (team && cost_center) break
    if (!matches(r.match, s)) continue
    let used = false
    if (!team && r.assign.team) { team = r.assign.team; used = true }
    if (!cost_center && r.assign.cost_center) { cost_center = r.assign.cost_center; used = true }
    if (used) rule_ids.push(r.id)
  }
  let team_from: Allocation['team_from'] = team ? 'rule' : null
  if (!team && s.member_team) { team = s.member_team; team_from = 'member' }
  // A tag literally named cost_center is honoured when no rule set one.
  if (!cost_center) {
    const tagCc = s.tags?.cost_center
    if (typeof tagCc === 'string' && tagCc) cost_center = tagCc
  }
  return { team, cost_center, rule_ids, team_from }
}

/**
 * Split weights for shared cost: each eligible team's share of attributed cost.
 * Returns an empty map when there is nothing to split across.
 */
export function splitWeights(attributed: Map<string, number>, among?: string[]): Map<string, number> {
  const pool = Array.from(attributed.entries()).filter(([t, c]) => c > 0 && (!among || among.includes(t)))
  const total = pool.reduce((s, [, c]) => s + c, 0)
  const out = new Map<string, number>()
  if (total <= 0) return out
  for (const [t, c] of pool) out.set(t, c / total)
  return out
}

/** Numeric fields of a row that a shared split should scale. */
export type Scalable = Record<string, unknown>

export interface AllocatedRow<T> {
  row: T
  team: string | null
  cost_center: string | null
  /** Fraction of the original row this piece represents (1 unless split). */
  weight: number
  /** Id of the shared_split rule that produced this piece, if any. */
  split_rule: string | null
  rule_ids: string[]
}

/**
 * Allocate a batch of rows: assign rules per row, then apply the first matching
 * shared_split rule to rows still without a team. `costOf` gives each row's
 * cost used for proportional weights (typically metered + notional cost).
 */
export function allocateRows<T>(
  rows: T[],
  subjectOf: (r: T) => AllocationSubject,
  costOf: (r: T) => number,
  rulesIn: AllocationRule[],
): AllocatedRow<T>[] {
  const rules = sortRules(rulesIn)
  const splitRules = rules.filter(r => r.kind === 'shared_split')
  const base: AllocatedRow<T>[] = rows.map(row => {
    const a = allocate(subjectOf(row), rules)
    return { row, team: a.team, cost_center: a.cost_center, weight: 1, split_rule: null, rule_ids: a.rule_ids }
  })
  if (splitRules.length === 0) return base

  const attributed = new Map<string, number>()
  for (const b of base) if (b.team) attributed.set(b.team, (attributed.get(b.team) ?? 0) + costOf(b.row))
  // Cost center of each team = its most-costly attributed cost center (for split pieces).
  const ccByTeam = new Map<string, Map<string, number>>()
  for (const b of base) {
    if (!b.team || !b.cost_center) continue
    const m = ccByTeam.get(b.team) ?? new Map<string, number>()
    m.set(b.cost_center, (m.get(b.cost_center) ?? 0) + costOf(b.row))
    ccByTeam.set(b.team, m)
  }
  const teamCc = (t: string) => {
    const m = ccByTeam.get(t)
    if (!m) return null
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0][0]
  }

  const out: AllocatedRow<T>[] = []
  for (const b of base) {
    if (b.team) { out.push(b); continue }
    const s = subjectOf(b.row)
    const rule = splitRules.find(r => matches(r.match, s))
    const weights = rule ? splitWeights(attributed, rule.assign.among) : new Map<string, number>()
    if (!rule || weights.size === 0) { out.push(b); continue }
    for (const [team, w] of Array.from(weights.entries())) {
      out.push({
        row: b.row, team, cost_center: b.cost_center ?? teamCc(team), weight: w,
        split_rule: rule.id, rule_ids: [...b.rule_ids, rule.id],
      })
    }
  }
  return out
}

/** Distinct tag keys referenced by rules (so callers can fetch just those tags). */
export function referencedTagKeys(rules: AllocationRule[]): string[] {
  const keys = new Set<string>(['cost_center'])
  for (const r of rules) if (r.match.tag) keys.add(r.match.tag)
  return Array.from(keys).sort()
}

/** Human summary of a rule's match, for tables. */
export function describeMatch(m: RuleMatch, projectName?: (id: string) => string | undefined): string {
  const parts: string[] = []
  if (m.tag) parts.push(m.equals != null ? `tag ${m.tag} = ${m.equals}` : `has tag ${m.tag}`)
  if (m.repo_prefix) parts.push(`repo starts with ${m.repo_prefix}`)
  if (m.email_domain) parts.push(`email @${m.email_domain.replace(/^@/, '')}`)
  if (m.project_id) parts.push(`project ${projectName?.(m.project_id) ?? m.project_id.slice(0, 8)}`)
  if (m.source) parts.push(`source ${m.source}`)
  if (m.model_prefix) parts.push(`model starts with ${m.model_prefix}`)
  return parts.length ? parts.join(' and ') : 'everything'
}
