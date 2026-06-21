export type TriggerType = 'threshold' | 'anomaly' | 'limit_breach' | 'member'

export interface AlertRuleRow {
  id:            string
  name:          string
  triggerType:   TriggerType
  condition:     string
  scope:         string
  channels:      { email: boolean; slack: boolean; webhook: boolean; inapp: boolean }
  isActive:      boolean
  firedCount:    number
  lastFiredAt:   string | null
  cooldownHours: number
  createdAt:     string
}

export interface AlertHistoryRow {
  id:        string
  title:     string
  body:      string | null
  type:      string
  isRead:    boolean
  createdAt: string
}
