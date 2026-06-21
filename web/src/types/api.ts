/**
 * API request / response types for all /api/v1/* routes.
 * These are the wire-format contracts between frontend and backend.
 */

// ── Shared ────────────────────────────────────────────────────────────────────

export interface ApiError {
  error:   string
  details?: unknown
}

export interface PaginatedResponse<T> {
  data:  T[]
  total: number
  page:  number
  limit: number
}

// ── Ingest ────────────────────────────────────────────────────────────────────

export interface IngestRequest {
  api_key:           string
  model:             string
  prompt_tokens:     number
  completion_tokens: number
  latency_ms?:       number
  tags?:             Record<string, string>
  metadata?:         Record<string, unknown>
}

export interface IngestResponse {
  ok:           true
  cost_usd:     number
  total_tokens: number
}

// ── Keys ──────────────────────────────────────────────────────────────────────

export interface CreateKeyRequest {
  org_id:     string
  project_id: string
  name:       string
  created_by: string
}

export interface CreateKeyResponse {
  id:         string
  name:       string
  key_prefix: string
  created_at: string
  raw_key:    string  // returned ONCE, never stored
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export interface AnalyticsSummary {
  total_cost_usd:    number
  total_calls:       number
  prompt_tokens:     number
  completion_tokens: number
  period_days:       number
}

export interface ModelBreakdown {
  model:             string
  prompt_tokens:     number
  completion_tokens: number
  cost_usd:          number
  calls:             number
}

export interface DayStat {
  date:              string
  prompt_tokens:     number
  completion_tokens: number
  cost_usd:          number
  calls:             number
}

export interface AnalyticsResponse {
  summary:  AnalyticsSummary
  by_model: ModelBreakdown[]
  by_day:   DayStat[]
}

// ── Limits ────────────────────────────────────────────────────────────────────

export interface LimitCheckResult {
  scope:       string
  scope_id:    string
  period:      string
  budget_usd:  number
  spent_usd:   number
  pct:         number
  status:      'ok' | 'warning' | 'throttled' | 'blocked'
}

// ── Orgs ──────────────────────────────────────────────────────────────────────

export interface CreateOrgRequest {
  name:     string
  slug:     string
  owner_id: string
}

export interface UpdateOrgRequest {
  org_id: string
  plan:   string
}

// ── Invites ───────────────────────────────────────────────────────────────────

export interface InviteRequest {
  org_id: string
  emails: string[]
}

export interface InviteResponse {
  invited: number
}
