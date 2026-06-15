/**
 * Database row types — mirrors Supabase table schemas.
 * Keep in sync with db/schema.sql.
 * Generated via: supabase gen types typescript --project-id jolfgtrjvfueoaoopous > src/types/db.ts
 */

export type Plan = 'free' | 'starter' | 'pro' | 'enterprise'
export type Role = 'owner' | 'admin' | 'member' | 'viewer'
export type LimitScope  = 'org' | 'project' | 'team' | 'member'
export type LimitPeriod = 'daily' | 'weekly' | 'monthly'
export type TriggerType = 'threshold' | 'anomaly' | 'limit_breach'
export type BudgetStatus = 'pending' | 'approved' | 'denied'
export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'expired'

export interface Organization {
  id:          string
  name:        string
  slug:        string
  plan:        Plan
  kill_switch: boolean
  owner_id:    string | null
  created_at:  string
  updated_at:  string
}

export interface Project {
  id:          string
  org_id:      string
  name:        string
  slug:        string
  description: string | null
  is_active:   boolean
  created_at:  string
}

export interface Team {
  id:         string
  org_id:     string
  name:       string
  created_at: string
}

export interface Member {
  id:         string
  org_id:     string
  user_id:    string
  team_id:    string | null
  role:       Role
  joined_at:  string
}

export interface ApiKey {
  id:           string
  org_id:       string
  project_id:   string | null
  name:         string
  key_hash:     string
  key_prefix:   string
  is_active:    boolean
  created_by:   string
  last_used_at: string | null
  created_at:   string
}

export interface ModelPrice {
  id:            string
  model_id:      string
  provider:      string
  input_per_1m:  number
  output_per_1m: number
  is_active:     boolean
  updated_at:    string
}

export interface UsageEvent {
  id:                string
  org_id:            string
  project_id:        string | null
  api_key_id:        string
  model:             string
  prompt_tokens:     number
  completion_tokens: number
  total_tokens:      number
  cost_usd:          number
  latency_ms:        number | null
  tags:              Record<string, string>
  metadata:          Record<string, unknown>
  created_at:        string
}

export interface UsageAgg {
  id:                string
  org_id:            string
  project_id:        string | null
  model:             string
  date:              string
  prompt_tokens:     number
  completion_tokens: number
  cost_usd:          number
  calls:             number
}

export interface Limit {
  id:          string
  org_id:      string
  scope:       LimitScope
  scope_id:    string
  period:      LimitPeriod
  budget_usd:  number
  warn_at:     number
  throttle_at: number
  block_at:    number
  created_at:  string
}

export interface AlertRule {
  id:            string
  org_id:        string
  project_id:    string | null
  name:          string
  trigger_type:  TriggerType
  threshold:     number | null
  channels:      string[]
  is_active:     boolean
  created_at:    string
}

export interface Notification {
  id:             string
  org_id:         string
  user_id:        string | null
  alert_rule_id:  string | null
  title:          string
  body:           string | null
  channels:       string[]
  is_read:        boolean
  created_at:     string
}

export interface Invitation {
  id:          string
  org_id:      string
  invited_by:  string
  email:       string
  role:        Role
  status:      InviteStatus
  token:       string
  expires_at:  string
  created_at:  string
}

export interface BudgetRequest {
  id:            string
  org_id:        string
  project_id:    string | null
  requested_by:  string
  reviewed_by:   string | null
  amount_usd:    number
  reason:        string | null
  status:        BudgetStatus
  reviewed_at:   string | null
  created_at:    string
}
