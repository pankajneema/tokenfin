import type { ExploreRow, ExploreState } from '@/lib/explore'
import type { FilterField } from '@/components/filters'

export interface ChartPoint { day: string; cost_usd: number; total_tokens: number; requests: number }
export interface ChartTotalPoint extends ChartPoint { metered_cost_usd: number; notional_cost_usd: number }
export interface ChartStack { key: string; label: string; points: ChartPoint[] }

export interface ExploreTotals {
  metered_cost_usd: number
  notional_cost_usd: number
  total_tokens: number
  requests: number
  prompts: number
  sessions: number
  active_users: number
}

export interface ExploreData {
  state: ExploreState
  errors: string[]
  from: string
  to: string
  timezone: string
  totals: ExploreTotals
  rows: ExploreRow[]
  /** keys beyond the table limit, summed */
  other: { keys: number; metered_cost_usd: number; notional_cost_usd: number; total_tokens: number; requests: number } | null
  total: ChartTotalPoint[]
  stacks: ChartStack[] | null
  filterFields: FilterField[]
  /** member keys the viewer may open at /dashboard/members/[key]; null = any */
  memberLinkKeys: string[] | null
}
