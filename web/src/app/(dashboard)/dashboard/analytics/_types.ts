export interface DayData {
  d:          string   // "Jun 1"
  cost:       number
  prev:       number
  tok:        number   // millions
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

export interface AnalyticsData {
  daily:      DayData[]
  byModel:    ModelSlice[]
  byProject:  ProjectSlice[]
  byPlatform: PlatformSlice[]
  totalCost:  number
  totalPrev:  number
  orgBudget:  number | null   // from limits table (org-level cost limit), null = not set
  tokensUsed: number          // real 30d token total from usage_agg/events
}
