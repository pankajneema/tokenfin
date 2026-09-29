import { z } from 'zod'

/**
 * tokenfin-budgets.yaml — budgets as code.
 *
 *   version: 1
 *   prune: false              # true = delete limits in the workspace that the file doesn't list
 *   defaults:
 *     period: monthly
 *     warn: 70                # % of amount → alert
 *     throttle: 90
 *     block: 100
 *     notify: [email, inapp]  # channels for the linked limit_breach alert ([] = no alert)
 *   budgets:
 *     - name: Workspace total
 *       scope: org
 *       amount_usd: 5000
 *     - scope: project
 *       target: payments-api  # project slug, name or id
 *       period: monthly
 *       amount_usd: 800
 *       warn: 60
 *       notify: [email, slack]
 *     - scope: team
 *       target: Search        # team name or id
 *       amount_usd: 1200
 *     - scope: member         # a per-member cap (applies to every member)
 *       period: daily
 *       amount_usd: 40
 */

export const CHANNELS = ['email', 'slack', 'webhook', 'inapp'] as const
export type Channel = typeof CHANNELS[number]

const pct = z.number().int().min(1).max(100)
const notify = z.union([z.array(z.enum(CHANNELS)), z.literal(false), z.null()])
  .transform(v => (v ? Array.from(new Set(v)) : []))

const budget = z.object({
  name:       z.string().max(120).optional(),
  scope:      z.enum(['org', 'project', 'team', 'member']),
  target:     z.union([z.string().min(1).max(200), z.number()]).optional().nullable().transform(v => (v == null ? null : String(v))),
  period:     z.enum(['daily', 'weekly', 'monthly']).optional(),
  amount_usd: z.number().positive().max(100_000_000),
  warn:       pct.optional(),
  throttle:   pct.optional(),
  block:      pct.optional(),
  notify:     notify.optional(),
  active:     z.boolean().optional(),
}).strict()

export const budgetsFileSchema = z.object({
  version:  z.literal(1).optional(),
  prune:    z.boolean().optional(),
  defaults: z.object({
    period:   z.enum(['daily', 'weekly', 'monthly']).optional(),
    warn:     pct.optional(),
    throttle: pct.optional(),
    block:    pct.optional(),
    notify:   notify.optional(),
  }).strict().optional(),
  budgets: z.array(budget).max(500),
}).strict()

export type BudgetsFile = z.infer<typeof budgetsFileSchema>

/** A budget with defaults applied (target still unresolved). */
export interface DesiredBudget {
  index: number
  name: string | null
  scope: 'org' | 'project' | 'team' | 'member'
  target: string | null
  period: 'daily' | 'weekly' | 'monthly'
  amount_usd: number
  warn: number
  throttle: number
  block: number
  notify: Channel[]
  active: boolean
}

export interface ValidationIssue { path: string; message: string }

/** Validate a parsed document and apply defaults. */
export function normalizeBudgets(doc: unknown): { ok: true; prune: boolean; budgets: DesiredBudget[] } | { ok: false; issues: ValidationIssue[] } {
  const parsed = budgetsFileSchema.safeParse(doc)
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map(i => ({ path: i.path.join('.') || '(root)', message: i.message })) }
  }
  const d = parsed.data.defaults ?? {}
  const issues: ValidationIssue[] = []
  const budgets: DesiredBudget[] = parsed.data.budgets.map((b, index) => {
    const out: DesiredBudget = {
      index, name: b.name ?? null, scope: b.scope, target: b.target ?? null,
      period: b.period ?? d.period ?? 'monthly', amount_usd: b.amount_usd,
      warn: b.warn ?? d.warn ?? 70, throttle: b.throttle ?? d.throttle ?? 90, block: b.block ?? d.block ?? 100,
      notify: b.notify ?? d.notify ?? ['email', 'inapp'], active: b.active ?? true,
    }
    const p = `budgets.${index}`
    if (!(out.warn <= out.throttle && out.throttle <= out.block)) issues.push({ path: p, message: 'must satisfy warn ≤ throttle ≤ block' })
    if ((out.scope === 'project' || out.scope === 'team') && !out.target) issues.push({ path: `${p}.target`, message: `target is required for scope ${out.scope}` })
    if ((out.scope === 'org' || out.scope === 'member') && out.target) issues.push({ path: `${p}.target`, message: `scope ${out.scope} takes no target` })
    return out
  })
  if (issues.length) return { ok: false, issues }
  return { ok: true, prune: parsed.data.prune ?? false, budgets }
}
