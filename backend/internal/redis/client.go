package redis

import (
	"context"
	"fmt"
	"time"

	goredis "github.com/redis/go-redis/v9" // aliased — our package is also named "redis"
)

// Client wraps go-redis with domain-specific helpers.
// All methods are context-aware and fail fast on timeout.
type Client struct {
	rdb *goredis.Client
}

// New creates a Redis client and verifies the connection with a ping.
func New(url string) (*Client, error) {
	opts, err := goredis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("invalid redis URL: %w", err)
	}

	rdb := goredis.NewClient(opts)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis ping failed: %w", err)
	}

	return &Client{rdb: rdb}, nil
}

func (c *Client) Close() error {
	return c.rdb.Close()
}

// ─── API Key Cache ────────────────────────────────────────────────────────────

const apiKeyCacheTTL = 5 * time.Minute

// GetAPIKey returns the cached "orgID:projectID" for a hashed API key.
// Returns ("", goredis.Nil) if not cached.
func (c *Client) GetAPIKey(ctx context.Context, hash string) (string, error) {
	return c.rdb.Get(ctx, apiKeyK(hash)).Result()
}

// SetAPIKey caches the resolved value for a key hash.
func (c *Client) SetAPIKey(ctx context.Context, hash, value string) error {
	return c.rdb.Set(ctx, apiKeyK(hash), value, apiKeyCacheTTL).Err()
}

// InvalidateAPIKey removes a cached key (call when key is revoked).
func (c *Client) InvalidateAPIKey(ctx context.Context, hash string) error {
	return c.rdb.Del(ctx, apiKeyK(hash)).Err()
}

// ─── Usage Counters ───────────────────────────────────────────────────────────

// IncrTokens atomically increments the token counter for an org+month.
func (c *Client) IncrTokens(ctx context.Context, orgID, month string, n int64) (int64, error) {
	return c.rdb.IncrBy(ctx, usageTokenK(orgID, month), n).Result()
}

// IncrCost atomically increments the cost counter for an org+month.
func (c *Client) IncrCost(ctx context.Context, orgID, month string, cost float64) (float64, error) {
	return c.rdb.IncrByFloat(ctx, usageCostK(orgID, month), cost).Result()
}

// GetTokenUsage returns the current token count for an org+month.
// Returns 0 (not an error) if no usage recorded yet.
func (c *Client) GetTokenUsage(ctx context.Context, orgID, month string) (int64, error) {
	val, err := c.rdb.Get(ctx, usageTokenK(orgID, month)).Int64()
	if err == goredis.Nil {
		return 0, nil
	}
	return val, err
}

// GetCostUsage returns the current USD cost for an org+month.
func (c *Client) GetCostUsage(ctx context.Context, orgID, month string) (float64, error) {
	val, err := c.rdb.Get(ctx, usageCostK(orgID, month)).Float64()
	if err == goredis.Nil {
		return 0, nil
	}
	return val, err
}

// SetTokenUsage overwrites the token counter for an org+month.
// Called by the reconciler to correct drift against the DB source of truth.
func (c *Client) SetTokenUsage(ctx context.Context, orgID, month string, tokens int64) error {
	return c.rdb.Set(ctx, usageTokenK(orgID, month), tokens, 0).Err()
}

// SetCostUsage overwrites the cost counter for an org+month.
// Called by the reconciler to correct drift against the DB source of truth.
func (c *Client) SetCostUsage(ctx context.Context, orgID, month string, cost float64) error {
	return c.rdb.Set(ctx, usageCostK(orgID, month), cost, 0).Err()
}

// ─── Limits ───────────────────────────────────────────────────────────────────

// GetLimit returns the limit value for an org+metric.
// Returns 0 if no limit is set (caller treats 0 as "unlimited").
func (c *Client) GetLimit(ctx context.Context, orgID, metric string) (float64, error) {
	val, err := c.rdb.Get(ctx, limitK(orgID, metric)).Float64()
	if err == goredis.Nil {
		return 0, nil
	}
	return val, err
}

// SetLimit persists a limit value with no TTL — invalidated explicitly on change.
func (c *Client) SetLimit(ctx context.Context, orgID, metric string, value float64) error {
	return c.rdb.Set(ctx, limitK(orgID, metric), value, 0).Err()
}

// ─── Idempotency / Rate-limiting ──────────────────────────────────────────────

const idempotencyTTL = 24 * time.Hour

// SetIfNew returns true if this key was never seen before (first occurrence).
// Returns false if the key already exists (duplicate — skip processing).
// Uses a fixed 24h TTL — for deduplicating ingest events.
func (c *Client) SetIfNew(ctx context.Context, key string) (bool, error) {
	return c.rdb.SetNX(ctx, "idem:"+key, 1, idempotencyTTL).Result()
}

// SetIfNewTTL is like SetIfNew but with a caller-specified TTL.
// Used for rate-limiting (e.g. alert dedup: once per hour per org).
func (c *Client) SetIfNewTTL(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	return c.rdb.SetNX(ctx, key, 1, ttl).Result()
}

// ─── CCR reversible store ────────────────────────────────────────────────────
// Stores the original of a compressed block so the model can retrieve it on
// demand. TTL-bounded — originals are ephemeral, not a permanent archive.

func (c *Client) CCRPut(ctx context.Context, hash, original string, ttl time.Duration) error {
	return c.rdb.Set(ctx, ccrK(hash), original, ttl).Err()
}

func (c *Client) CCRGet(ctx context.Context, hash string) (string, error) {
	v, err := c.rdb.Get(ctx, ccrK(hash)).Result()
	if err == goredis.Nil {
		return "", nil // miss — not an error
	}
	return v, err
}

// ─── Key builders — single source of truth for Redis key names ───────────────

func ccrK(hash string) string                { return "hr:ccr:" + hash }
func apiKeyK(hash string) string             { return "apikey:" + hash }
func usageTokenK(orgID, month string) string { return fmt.Sprintf("org:%s:usage:tokens:%s", orgID, month) }
func usageCostK(orgID, month string) string  { return fmt.Sprintf("org:%s:usage:cost:%s", orgID, month) }
func limitK(orgID, metric string) string     { return fmt.Sprintf("org:%s:limit:%s", orgID, metric) }
