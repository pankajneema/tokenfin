package models

import "time"

// IngestRequest is the JSON body for POST /v1/ingest.
// Sent by SDK / MCP / direct API callers.
type IngestRequest struct {
	Model          string            `json:"model"` // e.g. "gpt-4o", "claude-sonnet-4"
	InputTokens    int               `json:"input_tokens"`
	OutputTokens   int               `json:"output_tokens"`
	Tags           map[string]string `json:"tags,omitempty"` // user-defined labels
	Metadata       map[string]any    `json:"metadata,omitempty"`
	IdempotencyKey string            `json:"idempotency_key,omitempty"` // optional dedup key (Idempotency-Key header wins)

	// Optional prompt-cache token counts (priced at their own rates).
	CacheReadTokens  int `json:"cache_read_tokens,omitempty"`
	CacheWriteTokens int `json:"cache_write_tokens,omitempty"`
}

// UsageEvent is the canonical event written to Supabase usage_events table.
type UsageEvent struct {
	ID           string    `json:"id"`
	OrgID        string    `json:"org_id"`
	ProjectID    string    `json:"project_id"`
	UserID       string    `json:"user_id,omitempty"`
	Model        string    `json:"model"`
	InputTokens  int       `json:"input_tokens"`
	OutputTokens int       `json:"output_tokens"`
	TotalTokens  int       `json:"total_tokens"`
	CostUSD      float64   `json:"cost_usd"`
	CreatedAt    time.Time `json:"created_at"`
	// Tags/Metadata are never omitted: PostgREST bulk inserts require every
	// object in the array to carry the same keys (PGRST102 otherwise).
	// Callers normalise nil maps to {} before insert (columns are NOT NULL).
	Tags     map[string]string `json:"tags"`
	Metadata map[string]any    `json:"metadata"`

	// EventID is the UNIQUE dedupe key (usage_events.event_id). Set to
	// "direct:{orgID}:{idempotencyKey}" when the caller supplied a key — the
	// same scheme as the web direct-ingest route — else null.
	EventID *string `json:"event_id"`

	// Savings (TokenFin Saver / gateway). Zero on the plain ingest path.
	InputTokensSaved  int            `json:"input_tokens_saved"`
	OutputTokensSaved int            `json:"output_tokens_saved"`
	BaselineCostUSD   float64        `json:"baseline_cost_usd"`
	Optimizations     map[string]any `json:"optimizations"`
	WasHoldout        bool           `json:"was_holdout"`
}

// APIKey holds the resolved identity for a raw API key.
type APIKey struct {
	OrgID     string
	ProjectID string
	Scopes    []string
	ExpiresAt *time.Time
}
