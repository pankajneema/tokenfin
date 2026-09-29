export interface OrgIntegration {
  integration:    string          // 'slack' | 'webhook' | 'email'
  isActive:       boolean
  connectedAt:    string
  lastSyncedAt:   string | null   // last real delivery attempt (null = none yet)
  syncOk:         boolean | null  // result of that attempt (null = none yet)
  detail:         string | null   // last delivery result text
  label:          string | null   // friendly name
  target:         string | null   // masked destination URL
}

export interface ProviderConnection {
  id:             string
  provider:       'anthropic' | 'openai'
  key_hint:       string
  status:         'pending' | 'ok' | 'error'
  last_synced_at: string | null
  last_error:     string | null
  created_at:     string
}
