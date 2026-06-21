export interface OrgIntegration {
  integration:    string       // 'slack' | 'datadog' | ...
  isActive:       boolean
  connectedAt:    string
  lastSyncedAt:   string | null
  syncOk:         boolean
  detail:         string | null
}
