export type TriggerType = 'threshold' | 'anomaly' | 'limit_breach' | 'member' | 'forecast'
export type AnomalyScope = 'org' | 'project' | 'member' | 'model'

export interface AlertRuleRow {
  id:            string
  name:          string
  triggerType:   TriggerType
  condition:     string
  scope:         string
  threshold:     number | null
  anomalyScope:  AnomalyScope
  channels:      { email: boolean; slack: boolean; webhook: boolean; inapp: boolean }
  isActive:      boolean
  firedCount:    number
  lastFiredAt:   string | null
  cooldownHours: number
  createdAt:     string
  /** null = all projects (the engine filters by this, not by `scope`). */
  projectId:     string | null
  /** Budget limits this rule watches (limit_breach / forecast only). */
  budgets:       { id: string; label: string }[]
}

export type AlertChannelId = 'email' | 'slack' | 'webhook' | 'inapp'

/** Real delivery status of a channel — never assumed. */
export interface ChannelStatus {
  id:          AlertChannelId
  /** true when an alert on this channel would actually be sent. */
  deliverable: boolean
  /** Why it is not deliverable, or the masked destination when it is. */
  detail:      string
  lastAt:      string | null
  lastOk:      boolean | null
  lastDetail:  string | null
}

export interface ProjectOption { id: string; name: string }

export interface AlertHistoryRow {
  id:        string
  title:     string
  body:      string | null
  type:      string
  isRead:    boolean
  createdAt: string
}
