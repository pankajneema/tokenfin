/**
 * Which budget limits an alert rule actually watches — mirrors the alert
 * engine (lib/alerts/engine.ts): `limit_breach` and `forecast` rules evaluate
 * every legacy dollar budget (budget_usd > 0 — per-model / token / request
 * limits notify on their own, see lib/alerts/limits-runner), narrowed to the rule's project when it has one.
 * There is no limit_id FK, so this is the single place both the Alerts and the
 * Limits page derive the link from.
 */
export const BUDGET_TRIGGERS = ['limit_breach', 'forecast'] as const

export interface RuleLike  { trigger_type: string; project_id: string | null; is_active?: boolean }
export interface LimitLike { scope?: string; project_id: string | null; budget_usd: number | null; user_id?: string | null }

/** Structural link (ignores paused state — the UI shows "paused" separately). */
export function ruleCoversLimit(rule: RuleLike, limit: LimitLike): boolean {
  if (!(BUDGET_TRIGGERS as readonly string[]).includes(rule.trigger_type)) return false
  if (!Number(limit.budget_usd)) return false
  // Member limits are measurable once they name the member (migration 024).
  if (limit.scope === 'member' && !limit.user_id) return false
  return !rule.project_id || rule.project_id === limit.project_id
}

export interface BudgetRef { id: string; label: string }
export interface RuleRef   { id: string; name: string; triggerType: string; isActive: boolean }
