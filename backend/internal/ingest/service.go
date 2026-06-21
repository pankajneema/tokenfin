package ingest

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/tokenfin/backend/internal/models"
	"github.com/tokenfin/backend/internal/pricing"
	"github.com/tokenfin/backend/internal/redis"
)

// ErrLimitExceeded is returned when the org has hit its hard block threshold.
var ErrLimitExceeded = errors.New("usage limit exceeded")

// Service handles the core ingest business logic.
// Hot path: auth is already resolved before reaching here.
type Service struct {
	redis *redis.Client
	log   *slog.Logger
}

func NewService(rc *redis.Client, log *slog.Logger) *Service {
	return &Service{redis: rc, log: log}
}

// Process validates limits, increments counters, and publishes to the stream.
// Returns 202 to the caller immediately — DB write happens async in the worker.
func (s *Service) Process(ctx context.Context, req *models.IngestRequest, apiKey *models.APIKey) error {
	month := time.Now().UTC().Format("2006-01")
	totalTokens := req.InputTokens + req.OutputTokens
	cost := pricing.Calculate(req.Model, req.InputTokens, req.OutputTokens)

	// 1. Idempotency — silently drop duplicates (fail open: if Redis errors, allow)
	if req.IdempotencyKey != "" {
		isNew, err := s.redis.SetIfNew(ctx, req.IdempotencyKey)
		if err == nil && !isNew {
			s.log.Debug("duplicate event dropped", "idem_key", req.IdempotencyKey)
			return nil
		}
	}

	// 2. Limit check — block before any write
	if err := s.checkLimits(ctx, apiKey.OrgID, month, cost); err != nil {
		return err
	}

	// 3. Increment Redis counters (atomic, O(1))
	//    Non-fatal: reconciler corrects any drift every 5 min.
	if _, err := s.redis.IncrTokens(ctx, apiKey.OrgID, month, int64(totalTokens)); err != nil {
		s.log.Warn("token counter incr failed", "org_id", apiKey.OrgID, "err", err)
	}

	newCost, err := s.redis.IncrCost(ctx, apiKey.OrgID, month, cost)
	if err != nil {
		s.log.Warn("cost counter incr failed", "org_id", apiKey.OrgID, "err", err)
		newCost = cost // best guess for warn check
	}

	// 4. Push warn alert if crossing threshold (non-blocking goroutine)
	go s.checkAndWarn(context.WithoutCancel(ctx), apiKey.OrgID, month, newCost)

	// 5. Build event and publish to stream (fail-closed: 503 if Redis down here)
	event := &models.UsageEvent{
		ID:           newID(),
		OrgID:        apiKey.OrgID,
		ProjectID:    apiKey.ProjectID,
		Model:        req.Model,
		InputTokens:  req.InputTokens,
		OutputTokens: req.OutputTokens,
		TotalTokens:  totalTokens,
		CostUSD:      cost,
		CreatedAt:    time.Now().UTC(),
		Tags:         req.Tags,
		Metadata:     req.Metadata,
	}

	payload, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}

	if _, err := s.redis.Publish(ctx, string(payload)); err != nil {
		return fmt.Errorf("publish to stream: %w", err)
	}

	s.log.Debug("event published",
		"org_id", apiKey.OrgID,
		"model", req.Model,
		"tokens", totalTokens,
		"cost_usd", cost,
	)

	return nil
}

// checkLimits compares current month cost against the org's budget_usd limit.
// Limits are seeded into Redis by LimitsSync every 2 min from the limits table.
// Fails open on any Redis error — never block ingest due to cache unavailability.
func (s *Service) checkLimits(ctx context.Context, orgID, month string, newCost float64) error {
	// "cost:monthly" is set by LimitsSync from limits.budget_usd where period='monthly'
	budget, err := s.redis.GetLimit(ctx, orgID, "cost:monthly")
	if err != nil || budget <= 0 {
		return nil // no limit set or Redis error → allow (fail open)
	}

	current, err := s.redis.GetCostUsage(ctx, orgID, month)
	if err != nil {
		return nil // fail open
	}

	// block_at is a % (e.g. 100 means block when spend reaches 100% of budget)
	blockAt, err := s.redis.GetLimit(ctx, orgID, "block_at")
	if err != nil || blockAt <= 0 {
		blockAt = 100 // default: block at exactly 100%
	}

	if (current+newCost)/budget*100 >= blockAt {
		return ErrLimitExceeded
	}

	return nil
}

// checkAndWarn fires a warn alert if cumulative spend has crossed the warn_at threshold.
// Rate-limited to once per hour per org via Redis — prevents notification flooding.
// Runs in a goroutine — never blocks the ingest response.
func (s *Service) checkAndWarn(ctx context.Context, orgID, month string, currentCost float64) {
	budget, err := s.redis.GetLimit(ctx, orgID, "cost:monthly")
	if err != nil || budget <= 0 {
		return
	}

	warnAt, err := s.redis.GetLimit(ctx, orgID, "warn_at")
	if err != nil || warnAt <= 0 {
		return
	}

	pct := currentCost / budget * 100
	if pct < warnAt {
		return
	}

	// Dedup: only fire once per org per hour. SetIfNew returns false if already fired.
	dedupKey := fmt.Sprintf("alert:warn:%s:%s", orgID, month)
	fired, err := s.redis.SetIfNewTTL(ctx, dedupKey, time.Hour)
	if err != nil || !fired {
		return // already alerted this hour, or Redis error — skip
	}

	if err := s.redis.PublishAlert(ctx, orgID, "warn", "cost:monthly", pct); err != nil {
		s.log.Warn("alert publish failed", "org_id", orgID, "err", err)
	}
}

// newID generates a UUID v4 with no external dependencies.
func newID() string {
	b := make([]byte, 16)
	rand.Read(b) //nolint:errcheck — crypto/rand never errors
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant RFC 4122
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
