import type { CacheStats } from '@/components/dashboard/cache-efficiency'

export interface DayData {
  d:          string   // "Jun 1"
  cost:       number
  prev:       number
  tok:        number   // millions — total
  prevTok:    number
  calls:      number
  prevCalls:  number
  spike:      boolean
}

export interface ModelSlice {
  name:  string
  color: string
  cost:  number
  pct:   number
}

export interface ProjectSlice {
  name:  string
  cost:  number
  pct:   number
  calls: number
  prompts: number
}

export interface PlatformSlice {
  name:  string
  cost:  number
  pct:   number
  color: string
}

/** Source = where the call originated (usage_events.source) */
export interface SourceSlice {
  platform: string   // "Codex" | "MCP" | "Claude CLI" | "Direct API" | …
  calls:    number
  prompts:  number
  tokens:   number
  cost:     number
  pct:      number   // % of total cost
  color:    string
}

export interface AnalyticsData {
  rangeDays:   number
  /** "Last 30 days" or a custom "Sep 1 – Sep 20" */
  windowLabel:  string
  customRange:  boolean
  /** distinct prompts in the window / previous window (from the rollups) */
  prompts:      number
  prevPrompts:  number
  /** metered (a real bill) vs notional (subscription usage priced at API rates) */
  meteredCost:  number
  notionalCost: number
  daily:        DayData[]
  byModel:      ModelSlice[]
  byProject:    ProjectSlice[]
  byPlatform:   PlatformSlice[]   // kept for backward compat (derived from api_keys)
  bySource:     SourceSlice[]     // real source breakdown from tags
  totalCost:    number
  totalPrev:    number
  orgBudget:    number | null
  tokensUsed:   number            // total tokens (input + output)
  inputTokens:  number            // input tokens (prompt)
  outputTokens: number            // output tokens (completion)
  cache:        CacheStats        // prompt-cache efficiency (all events in range, per model)
}
