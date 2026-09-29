export interface ModelSlice { model: string; cost: number; tokens: number; requests: number }
export interface DayPoint   { day: string; cost: number }
export interface PromptRow  { hash: string; cost: number; requests: number; model: string; lastAt: string }
/** combined cost + its metered / notional (subscription, at API rates) parts */
export interface CostTotals { cost: number; metered: number; notional: number }
