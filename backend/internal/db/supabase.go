package db

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/tokenfin/backend/internal/models"
)

// Client is a thin HTTP wrapper around Supabase REST API.
// Uses the service-role key — bypasses RLS. Server-only.
type Client struct {
	baseURL string
	key     string // service role key — never log
	http    *http.Client
}

func New(baseURL, serviceKey string) *Client {
	return &Client{
		baseURL: baseURL,
		key:     serviceKey,
		http:    &http.Client{Timeout: 10 * time.Second},
	}
}

// ─── Limits ───────────────────────────────────────────────────────────────────

// OrgLimit is one active limit row from the limits table.
// Limits are cost-based (budget_usd). warn_at and block_at are 0–100 percentages.
type OrgLimit struct {
	OrgID     string  `json:"org_id"`
	Period    string  `json:"period"`     // "daily" | "weekly" | "monthly"
	BudgetUSD float64 `json:"budget_usd"` // cost ceiling in USD
	WarnAt    int     `json:"warn_at"`    // % of budget to fire a warning (default 70)
	BlockAt   int     `json:"block_at"`   // % of budget to start blocking (default 100)
}

// LoadActiveLimits returns all active org-scoped limits across all orgs.
// Org-scope is the only level checked at ingest time. Project/team limits
// are enforced at the analytics/reporting layer.
func (c *Client) LoadActiveLimits(ctx context.Context) ([]*OrgLimit, error) {
	url := c.baseURL + "/rest/v1/limits?is_active=eq.true&scope=eq.org&select=org_id,period,budget_usd,warn_at,block_at"

	var rows []*OrgLimit
	if err := c.get(ctx, url, &rows); err != nil {
		return nil, fmt.Errorf("load active limits: %w", err)
	}
	return rows, nil
}

// InsertNotification writes a warn/block alert into the notifications table.
func (c *Client) InsertNotification(ctx context.Context, orgID, title, body, notifType string) error {
	url := c.baseURL + "/rest/v1/notifications"
	payload := map[string]any{
		"org_id": orgID,
		"title":  title,
		"body":   body,
		"type":   notifType, // "warn" | "block"
		"is_read": false,
	}
	if err := c.post(ctx, url, payload); err != nil {
		return fmt.Errorf("insert notification: %w", err)
	}
	return nil
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

// LookupAPIKey finds org_id + project_id for a given key hash.
// Returns (nil, nil) if not found — not an error.
func (c *Client) LookupAPIKey(ctx context.Context, hash string) (*models.APIKey, error) {
	url := fmt.Sprintf(
		"%s/rest/v1/api_keys?key_hash=eq.%s&is_active=eq.true&select=org_id,project_id,scopes&limit=1",
		c.baseURL, hash,
	)

	var rows []struct {
		OrgID     string   `json:"org_id"`
		ProjectID string   `json:"project_id"`
		Scopes    []string `json:"scopes"`
	}

	if err := c.get(ctx, url, &rows); err != nil {
		return nil, fmt.Errorf("api key lookup: %w", err)
	}
	if len(rows) == 0 {
		return nil, nil
	}

	return &models.APIKey{
		OrgID:     rows[0].OrgID,
		ProjectID: rows[0].ProjectID,
		Scopes:    rows[0].Scopes,
	}, nil
}

// ─── Usage Events ─────────────────────────────────────────────────────────────

// BulkInsertEvents writes a batch of events in a single HTTP call.
// Supabase accepts an array for bulk insert.
func (c *Client) BulkInsertEvents(ctx context.Context, events []*models.UsageEvent) error {
	if len(events) == 0 {
		return nil
	}
	url := c.baseURL + "/rest/v1/usage_events"
	if err := c.postArray(ctx, url, events); err != nil {
		return fmt.Errorf("bulk insert events: %w", err)
	}
	return nil
}

// ─── Usage Aggregates ─────────────────────────────────────────────────────────

// aggRow is the payload for the upsert_usage_agg_batch RPC.
type aggRow struct {
	OrgID        string  `json:"p_org_id"`
	ProjectID    string  `json:"p_project_id"`
	Model        string  `json:"p_model"`
	Bucket       string  `json:"p_bucket"`       // YYYY-MM-DD
	TotalTokens  int     `json:"p_tokens"`
	CostUSD      float64 `json:"p_cost"`
	RequestCount int     `json:"p_requests"`
}

// UpsertAgg groups events into daily buckets and calls the batch RPC.
// The SQL function handles the ON CONFLICT DO UPDATE increment atomically.
func (c *Client) UpsertAgg(ctx context.Context, events []*models.UsageEvent) error {
	if len(events) == 0 {
		return nil
	}

	// Group by (org_id, project_id, model, date)
	type key struct{ org, project, model, bucket string }
	agg := make(map[key]*aggRow)

	for _, e := range events {
		// Use IST (UTC+5:30) for date bucketing so Indian users see correct dates
		ist := time.FixedZone("IST", 5*60*60+30*60)
		bucket := e.CreatedAt.In(ist).Format("2006-01-02")
		k := key{e.OrgID, e.ProjectID, e.Model, bucket}

		if _, ok := agg[k]; !ok {
			agg[k] = &aggRow{
				OrgID:     e.OrgID,
				ProjectID: e.ProjectID,
				Model:     e.Model,
				Bucket:    bucket,
			}
		}
		agg[k].TotalTokens += e.TotalTokens
		agg[k].CostUSD += e.CostUSD
		agg[k].RequestCount++
	}

	rows := make([]*aggRow, 0, len(agg))
	for _, row := range agg {
		row.CostUSD = math.Round(row.CostUSD*1e8) / 1e8 // 8 decimal precision
		rows = append(rows, row)
	}

	// Call the batch RPC — SQL handles increment-on-conflict
	url := c.baseURL + "/rest/v1/rpc/upsert_usage_agg_batch"
	if err := c.post(ctx, url, map[string]any{"rows": rows}); err != nil {
		return fmt.Errorf("upsert agg batch: %w", err)
	}
	return nil
}

// ─── Reconciliation ───────────────────────────────────────────────────────────

// GetAggCostSum returns the total cost_usd for an org in a given month from Supabase.
// Used by the reconciler to verify the Redis cost counter.
func (c *Client) GetAggCostSum(ctx context.Context, orgID, month string) (float64, error) {
	start, end, err := monthBounds(month)
	if err != nil {
		return 0, err
	}

	url := fmt.Sprintf(
		"%s/rest/v1/usage_agg?org_id=eq.%s&bucket=gte.%s&bucket=lt.%s&select=cost_usd",
		c.baseURL, orgID, start, end,
	)

	var rows []struct {
		CostUSD float64 `json:"cost_usd"`
	}
	if err := c.get(ctx, url, &rows); err != nil {
		return 0, fmt.Errorf("get agg cost sum: %w", err)
	}

	var sum float64
	for _, r := range rows {
		sum += r.CostUSD
	}
	return math.Round(sum*1e8) / 1e8, nil
}

// GetAggTokenSum returns the total tokens for an org in a given month from Supabase.
// Used by the reconciler to verify Redis counters.
// month format: "2026-01"
func (c *Client) GetAggTokenSum(ctx context.Context, orgID, month string) (int64, error) {
	// Parse "2026-01" → start = "2026-01-01", end = "2026-02-01"
	start, end, err := monthBounds(month)
	if err != nil {
		return 0, err
	}

	url := fmt.Sprintf(
		"%s/rest/v1/usage_agg?org_id=eq.%s&bucket=gte.%s&bucket=lt.%s&select=total_tokens",
		c.baseURL, orgID, start, end,
	)

	var rows []struct {
		TotalTokens int64 `json:"total_tokens"`
	}
	if err := c.get(ctx, url, &rows); err != nil {
		return 0, fmt.Errorf("get agg sum: %w", err)
	}

	var sum int64
	for _, r := range rows {
		sum += r.TotalTokens
	}
	return sum, nil
}

// monthBounds returns the first day of the month and the first day of the next month.
func monthBounds(month string) (start, end string, err error) {
	t, err := time.Parse("2006-01", month)
	if err != nil {
		return "", "", fmt.Errorf("invalid month %q: %w", month, err)
	}
	start = t.Format("2006-01-02")
	end = t.AddDate(0, 1, 0).Format("2006-01-02")
	return start, end, nil
}

// ─── Health ───────────────────────────────────────────────────────────────────

// Ping verifies the Supabase connection is alive.
func (c *Client) Ping(ctx context.Context) error {
	url := c.baseURL + "/rest/v1/organizations?limit=0"
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, url, nil)
	if err != nil {
		return err
	}
	c.setHeaders(req)

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("supabase unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 500 {
		return fmt.Errorf("supabase returned %d", resp.StatusCode)
	}
	return nil
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

func (c *Client) get(ctx context.Context, url string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	c.setHeaders(req)

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("GET: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("GET %s → %d", url, resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (c *Client) post(ctx context.Context, url string, body any) error {
	return c.send(ctx, http.MethodPost, url, body)
}

// postArray sends an array body — used for bulk inserts.
func (c *Client) postArray(ctx context.Context, url string, body any) error {
	return c.send(ctx, http.MethodPost, url, body)
}

func (c *Client) send(ctx context.Context, method, url string, body any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(b))
	if err != nil {
		return err
	}
	c.setHeaders(req)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal") // skip response body — faster

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%s: %w", method, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("%s %s → %d", method, url, resp.StatusCode)
	}
	return nil
}

func (c *Client) setHeaders(req *http.Request) {
	req.Header.Set("apikey", c.key)
	req.Header.Set("Authorization", "Bearer "+c.key)
}
