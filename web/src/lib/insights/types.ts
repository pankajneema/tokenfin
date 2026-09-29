/**
 * Shared types for Insights (waste finder + spike explainer). Client-safe.
 */
import type { DashFilters } from '@/lib/rollups'

export type Confidence = 'high' | 'medium' | 'low'

export type WasteRule =
  | 'expensive_model_short_output'
  | 'low_cache_reuse'
  | 'error_storm'
  | 'runaway_session'
  | 'idle_key'
  | 'duplicate_keys'
  | 'idle_seat'

export interface Finding {
  /** stable id (rule + subject) so the UI can key / de-duplicate */
  id: string
  rule: WasteRule
  title: string
  detail: string
  recommendation: string
  /** estimated monthly saving = bill + notional (both ≥ 0) */
  monthly_saving_usd: number
  /** part that would reduce a real bill (metered API spend or seat fees) */
  bill_saving_usd: number
  /** part priced at API rates on subscription (notional) usage — not a bill */
  notional_saving_usd: number
  confidence: Confidence
  evidence: { label: string; href: string }
  metrics: Record<string, number | string>
}

export interface Contributor {
  key: string
  label: string
  /** cost on the spike day */
  today: number
  /** mean daily cost over the baseline window */
  usual: number
  delta: number
  /** share of the spike's total delta, 0–100 (capped: other keys may have fallen) */
  pct: number
}

export type SpikeDim = 'model' | 'member' | 'project' | 'source' | 'agent' | 'repo'

export interface PathStep { dim: SpikeDim; key: string; label: string; delta: number; pct: number }

export interface Spike {
  day: string
  cost: number
  baseline_mean: number
  baseline_sd: number
  threshold: number
  delta: number
  history_days: number
  baseline_from: string
  baseline_to: string
}

export interface ExplainedSpike extends Spike {
  /** e.g. "+$41.00 vs usual ($3.20/day); 78% from alice@x.com on claude-opus-4-8 in repo acme/api" */
  sentence: string
  /** joint drill-down (member → model → repo → source) */
  path: PathStep[]
  /** top contributors per dimension (marginal) */
  contributors: Partial<Record<SpikeDim, Contributor[]>>
  evidence: { label: string; href: string }
  filters: DashFilters
}

export interface InsightsTotals {
  monthly_saving_usd: number
  bill_saving_usd: number
  notional_saving_usd: number
  findings: number
}

export interface InsightsResult {
  org_id: string
  generated_at: string
  timezone: string
  window: { from: string; to: string }
  /** true when the scope had any usage in the window */
  has_usage: boolean
  /** set when results are limited to one member (members / viewers) */
  scoped_to: string | null
  findings: Finding[]
  totals: InsightsTotals
  spikes: ExplainedSpike[]
  assumptions: { seat_usd: number }
}
