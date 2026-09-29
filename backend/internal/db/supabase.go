package db

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
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
	// Tuned transport — the Go default caps MaxIdleConnsPerHost at 2, which
	// serializes all concurrent writes/reads to Supabase over two sockets and
	// is the single biggest throughput ceiling. Raise the pool so many worker
	// consumers can write in parallel and keep connections warm (avoids a TLS
	// handshake per call).
	transport := &http.Transport{
		MaxIdleConns:        256,
		MaxIdleConnsPerHost: 256,
		MaxConnsPerHost:     256,
		IdleConnTimeout:     90 * time.Second,
		ForceAttemptHTTP2:   true,
	}
	return &Client{
		baseURL: baseURL,
		key:     serviceKey,
		http:    &http.Client{Timeout: 15 * time.Second, Transport: transport},
	}
}

// maxWriteRetries bounds transient-failure retries for write calls (POST/RPC).
// Reads are not retried here — the worker retries whole batches on failure.
const maxWriteRetries = 3

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
		"org_id":  orgID,
		"title":   title,
		"body":    body,
		"type":    notifType, // "warn" | "block"
		"is_read": false,
	}
	if err := c.post(ctx, url, payload); err != nil {
		return fmt.Errorf("insert notification: %w", err)
	}
	return nil
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

// LookupAPIKey finds org_id, project_id, scopes and expiry for a key hash.
// Returns (nil, nil) if not found — not an error. project_id may be "" for
// org-wide keys; callers resolve a project with FirstProjectID.
func (c *Client) LookupAPIKey(ctx context.Context, hash string) (*models.APIKey, error) {
	url := fmt.Sprintf(
		"%s/rest/v1/api_keys?key_hash=eq.%s&is_active=eq.true&select=org_id,project_id,scopes,expires_at&limit=1",
		c.baseURL, url.QueryEscape(hash),
	)

	var rows []struct {
		OrgID     string     `json:"org_id"`
		ProjectID *string    `json:"project_id"`
		Scopes    []string   `json:"scopes"`
		ExpiresAt *time.Time `json:"expires_at"`
	}

	if err := c.get(ctx, url, &rows); err != nil {
		return nil, fmt.Errorf("api key lookup: %w", err)
	}
	if len(rows) == 0 {
		return nil, nil
	}

	key := &models.APIKey{
		OrgID:     rows[0].OrgID,
		Scopes:    rows[0].Scopes,
		ExpiresAt: rows[0].ExpiresAt,
	}
	if rows[0].ProjectID != nil {
		key.ProjectID = *rows[0].ProjectID
	}
	return key, nil
}

// FirstProjectID returns the org's oldest project id, or "" if it has none.
// usage_events.project_id is NOT NULL, so keys without a project fall back to
// this (same rule as the web direct-ingest route).
func (c *Client) FirstProjectID(ctx context.Context, orgID string) (string, error) {
	u := fmt.Sprintf(
		"%s/rest/v1/projects?org_id=eq.%s&select=id&order=created_at.asc&limit=1",
		c.baseURL, url.QueryEscape(orgID),
	)
	var rows []struct {
		ID string `json:"id"`
	}
	if err := c.get(ctx, u, &rows); err != nil {
		return "", fmt.Errorf("first project lookup: %w", err)
	}
	if len(rows) == 0 {
		return "", nil
	}
	return rows[0].ID, nil
}

// ─── Usage Events ─────────────────────────────────────────────────────────────

// BulkInsertEvents writes a batch of events in a single HTTP call.
// Supabase accepts an array for bulk insert. Rows whose event_id already exists
// are skipped (ON CONFLICT (event_id) DO NOTHING), so stream redeliveries and
// replays of the same idempotency key never double-insert.
//
// It returns only the events that were actually inserted (PostgREST returns
// the inserted rows and omits the skipped duplicates), so callers aggregate
// into usage_agg exactly once per event.
//
// A 4xx response is returned as *HTTPError (see IsClientError) so the caller
// can isolate the bad row instead of failing the whole batch.
func (c *Client) BulkInsertEvents(ctx context.Context, events []*models.UsageEvent) ([]*models.UsageEvent, error) {
	if len(events) == 0 {
		return nil, nil
	}
	for _, e := range events {
		normalizeEvent(e)
	}
	url := c.baseURL + "/rest/v1/usage_events?on_conflict=event_id&select=id,event_id"
	var returned []InsertedRow
	if err := c.sendDecode(ctx, http.MethodPost, url, events, "resolution=ignore-duplicates,return=representation", &returned); err != nil {
		return nil, fmt.Errorf("bulk insert events: %w", err)
	}
	return FilterInserted(events, returned), nil
}

// InsertedRow is one row PostgREST returned from an insert.
type InsertedRow struct {
	ID      string  `json:"id"`
	EventID *string `json:"event_id"`
}

// FilterInserted keeps the events that appear in the returned (inserted) rows,
// matched by event_id. Events without an event_id cannot be skipped by the
// ON CONFLICT (event_id) arbiter, so they are always new.
func FilterInserted(events []*models.UsageEvent, returned []InsertedRow) []*models.UsageEvent {
	inserted := make(map[string]struct{}, len(returned))
	for _, r := range returned {
		if r.EventID != nil {
			inserted[*r.EventID] = struct{}{}
		}
	}
	out := make([]*models.UsageEvent, 0, len(events))
	for _, e := range events {
		if e.EventID == nil || *e.EventID == "" {
			out = append(out, e)
			continue
		}
		if _, ok := inserted[*e.EventID]; ok {
			out = append(out, e)
		}
	}
	return out
}

// normalizeEvent fills NOT NULL JSONB columns so every object in a bulk
// payload has identical keys and valid values, and gives keyless events an
// event_id derived from their stream-assigned id ("ingest:{id}") so a stream
// redelivery is skipped by ON CONFLICT (event_id) instead of hitting the
// primary key and failing the batch.
func normalizeEvent(e *models.UsageEvent) {
	if (e.EventID == nil || *e.EventID == "") && e.ID != "" {
		id := "ingest:" + e.ID
		e.EventID = &id
	}
	if e.Tags == nil {
		e.Tags = map[string]string{}
	}
	if e.Metadata == nil {
		e.Metadata = map[string]any{}
	}
	if e.Optimizations == nil {
		e.Optimizations = map[string]any{}
	}
}

// ─── Usage Aggregates ─────────────────────────────────────────────────────────

// aggRow is the payload for the upsert_usage_agg_batch RPC.
type aggRow struct {
	OrgID        string  `json:"p_org_id"`
	ProjectID    string  `json:"p_project_id"`
	Model        string  `json:"p_model"`
	Bucket       string  `json:"p_bucket"` // YYYY-MM-DD
	TotalTokens  int     `json:"p_tokens"`
	CostUSD      float64 `json:"p_cost"`
	RequestCount int     `json:"p_requests"`
	TokensSaved  int     `json:"p_tokens_saved"`
	CostSaved    float64 `json:"p_cost_saved"`
	HoldoutCount int     `json:"p_holdout"`
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
		agg[k].TokensSaved += e.InputTokensSaved + e.OutputTokensSaved
		// Only events with a real baseline carry savings; a zero baseline
		// (plain ingest path) would otherwise record negative savings.
		if e.BaselineCostUSD > 0 {
			agg[k].CostSaved += e.BaselineCostUSD - e.CostUSD
		}
		if e.WasHoldout {
			agg[k].HoldoutCount++
		}
	}

	rows := make([]*aggRow, 0, len(agg))
	for _, row := range agg {
		row.CostUSD = math.Round(row.CostUSD*1e8) / 1e8 // 8 decimal precision
		row.CostSaved = math.Round(row.CostSaved*1e8) / 1e8
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
		"%s/rest/v1/usage_agg?org_id=eq.%s&bucket=gte.%s&bucket=lt.%s&select=cost_usd&order=bucket.asc,project_id.asc,model.asc",
		c.baseURL, orgID, start, end,
	)

	var sum float64
	err = getAllPages(ctx, c, url, func(rows []struct {
		CostUSD float64 `json:"cost_usd"`
	}) {
		for _, r := range rows {
			sum += r.CostUSD
		}
	})
	if err != nil {
		return 0, fmt.Errorf("get agg cost sum: %w", err)
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
		"%s/rest/v1/usage_agg?org_id=eq.%s&bucket=gte.%s&bucket=lt.%s&select=total_tokens&order=bucket.asc,project_id.asc,model.asc",
		c.baseURL, orgID, start, end,
	)

	var sum int64
	err = getAllPages(ctx, c, url, func(rows []struct {
		TotalTokens int64 `json:"total_tokens"`
	}) {
		for _, r := range rows {
			sum += r.TotalTokens
		}
	})
	if err != nil {
		return 0, fmt.Errorf("get agg sum: %w", err)
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

// HTTPError is a non-2xx response from Supabase.
type HTTPError struct {
	Method string
	Status int
	Body   string
}

func (e *HTTPError) Error() string {
	if e.Body != "" {
		return fmt.Sprintf("%s → %d: %s", e.Method, e.Status, e.Body)
	}
	return fmt.Sprintf("%s → %d", e.Method, e.Status)
}

// IsClientError reports whether err wraps a 4xx Supabase response — a
// data/request error that will fail identically on retry.
func IsClientError(err error) bool {
	var he *HTTPError
	return errors.As(err, &he) && he.Status >= 400 && he.Status < 500
}

// pageSize is the PostgREST page we request; the server's max-rows (default
// 1000) may cap it lower, which getAllPages tolerates.
const pageSize = 1000

// getAllPages GETs every row of a (stably ordered) query using Range headers,
// calling fn for each page. It stops on the first empty page, so a server-side
// max-rows smaller than pageSize can never truncate the result.
func getAllPages[T any](ctx context.Context, c *Client, url string, fn func([]T)) error {
	for from := 0; ; {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return err
		}
		c.setHeaders(req)
		req.Header.Set("Range-Unit", "items")
		req.Header.Set("Range", fmt.Sprintf("%d-%d", from, from+pageSize-1))

		resp, err := c.http.Do(req)
		if err != nil {
			return fmt.Errorf("GET: %w", err)
		}
		// 416 = requested range starts past the end → done.
		if resp.StatusCode == http.StatusRequestedRangeNotSatisfiable {
			resp.Body.Close()
			return nil
		}
		if resp.StatusCode >= 400 {
			resp.Body.Close()
			return &HTTPError{Method: "GET", Status: resp.StatusCode}
		}
		var rows []T
		err = json.NewDecoder(resp.Body).Decode(&rows)
		resp.Body.Close()
		if err != nil {
			return fmt.Errorf("decode page: %w", err)
		}
		if len(rows) == 0 {
			return nil
		}
		fn(rows)
		from += len(rows)
	}
}

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
		return &HTTPError{Method: "GET", Status: resp.StatusCode}
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (c *Client) post(ctx context.Context, url string, body any) error {
	return c.send(ctx, http.MethodPost, url, body, "return=minimal")
}

// ModelRoute is an active eval-informed routing rule (migration 021).
type ModelRoute struct {
	OrgID     string `json:"org_id"`
	FromModel string `json:"from_model"`
	ToModel   string `json:"to_model"`
}

// LoadModelRoutes returns all active routes across orgs (the gateway caches them).
func (c *Client) LoadModelRoutes(ctx context.Context) ([]ModelRoute, error) {
	url := c.baseURL + "/rest/v1/model_routes?is_active=eq.true&select=org_id,from_model,to_model"
	var rows []ModelRoute
	if err := c.get(ctx, url, &rows); err != nil {
		return nil, fmt.Errorf("load model routes: %w", err)
	}
	return rows, nil
}

// PromptCapture is one full-prompt record (opt-in; see migration 014).
type PromptCapture struct {
	OrgID        string  `json:"org_id"`
	ProjectID    string  `json:"project_id,omitempty"`
	UserID       string  `json:"user_id,omitempty"`
	Model        string  `json:"model"`
	PromptHash   string  `json:"prompt_hash,omitempty"`
	PromptText   string  `json:"prompt_text"`
	ResponseText string  `json:"response_text,omitempty"`
	InputTokens  int     `json:"input_tokens"`
	OutputTokens int     `json:"output_tokens"`
	CostUSD      float64 `json:"cost_usd"`
}

// InsertPromptCapture writes one full-prompt record.
func (c *Client) InsertPromptCapture(ctx context.Context, p *PromptCapture) error {
	url := c.baseURL + "/rest/v1/prompt_captures"
	return c.postArray(ctx, url, []*PromptCapture{p})
}

// postArray sends an array body — used for bulk inserts.
func (c *Client) postArray(ctx context.Context, url string, body any) error {
	return c.send(ctx, http.MethodPost, url, body, "return=minimal")
}

// send issues a write with the given PostgREST Prefer header.
func (c *Client) send(ctx context.Context, method, url string, body any, prefer string) error {
	return c.sendDecode(ctx, method, url, body, prefer, nil)
}

// sendDecode is send that JSON-decodes a 2xx response body into out (if non-nil).
func (c *Client) sendDecode(ctx context.Context, method, url string, body any, prefer string, out any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}

	// Retry transient failures (network error or 5xx) with exponential backoff.
	// 4xx are caller/data errors — never retried. The request body is buffered
	// so it can be replayed on each attempt.
	var lastErr error
	for attempt := 0; attempt <= maxWriteRetries; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(1<<uint(attempt-1)) * 100 * time.Millisecond):
			}
		}

		req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(b))
		if err != nil {
			return err
		}
		c.setHeaders(req)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Prefer", prefer)

		resp, err := c.http.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("%s: %w", method, err)
			continue // network error — retry
		}
		var errBody []byte
		if resp.StatusCode >= 400 {
			errBody, _ = io.ReadAll(io.LimitReader(resp.Body, 512))
		} else if out != nil {
			derr := json.NewDecoder(resp.Body).Decode(out)
			resp.Body.Close()
			if derr != nil {
				return fmt.Errorf("%s: decode response: %w", method, derr)
			}
			return nil // success
		}
		resp.Body.Close()

		if resp.StatusCode >= 500 {
			lastErr = &HTTPError{Method: method, Status: resp.StatusCode, Body: string(errBody)}
			continue // server error — retry
		}
		if resp.StatusCode >= 400 {
			// client error — fail fast (never retried)
			return &HTTPError{Method: method, Status: resp.StatusCode, Body: string(errBody)}
		}
		return nil // success
	}
	return fmt.Errorf("%s exhausted retries: %w", method, lastErr)
}

func (c *Client) setHeaders(req *http.Request) {
	req.Header.Set("apikey", c.key)
	req.Header.Set("Authorization", "Bearer "+c.key)
}
