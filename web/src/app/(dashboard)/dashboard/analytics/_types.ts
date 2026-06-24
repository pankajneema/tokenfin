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
}

export interface PlatformSlice {
  name:  string
  cost:  number
  pct:   number
  color: string
}

/** Source = where the call originated (from usage_events.tags) */
export interface SourceSlice {
  platform: string   // "Codex" | "MCP" | "Claude CLI" | "Direct API" | …
  calls:    number
  tokens:   number
  cost:     number
  pct:      number   // % of total cost
  color:    string
}

export interface AnalyticsData {
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
}
