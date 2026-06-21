package worker

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/tokenfin/backend/internal/db"
	"github.com/tokenfin/backend/internal/redis"
)

const limitsSyncInterval = 2 * time.Minute

// LimitsSync periodically loads active limits from Supabase and writes them
// into Redis so the ingest service can check them at O(1) without a DB hit.
//
// Redis keys written per org:
//   org:{id}:limit:cost:{period}   — budget ceiling in USD (e.g. "cost:monthly")
//   org:{id}:limit:warn_at         — warn threshold % (default 70)
//   org:{id}:limit:block_at        — block threshold % (default 100)
type LimitsSync struct {
	redis *redis.Client
	db    *db.Client
	log   *slog.Logger
}

func NewLimitsSync(rc *redis.Client, dbc *db.Client, log *slog.Logger) *LimitsSync {
	return &LimitsSync{redis: rc, db: dbc, log: log}
}

// Run syncs limits immediately then on every tick until ctx is cancelled.
func (s *LimitsSync) Run(ctx context.Context) {
	s.log.Info("limits sync started", "interval", limitsSyncInterval)

	// Sync immediately so limits are in Redis before consumer starts
	s.sync(ctx)

	ticker := time.NewTicker(limitsSyncInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			s.log.Info("limits sync stopping")
			return
		case <-ticker.C:
			s.sync(ctx)
		}
	}
}

func (s *LimitsSync) sync(ctx context.Context) {
	limits, err := s.db.LoadActiveLimits(ctx)
	if err != nil {
		s.log.Error("limits sync: fetch failed", "err", err)
		return
	}

	var synced int
	for _, l := range limits {
		// "cost:monthly", "cost:daily", etc. — matches what ingest/service.go reads
		redisMetric := fmt.Sprintf("cost:%s", l.Period)

		if err := s.redis.SetLimit(ctx, l.OrgID, redisMetric, l.BudgetUSD); err != nil {
			s.log.Warn("limits sync: set budget failed",
				"org_id", l.OrgID, "metric", redisMetric, "err", err)
			continue
		}

		// warn_at and block_at are global per org (last write wins if multiple periods)
		if l.WarnAt > 0 {
			if err := s.redis.SetLimit(ctx, l.OrgID, "warn_at", float64(l.WarnAt)); err != nil {
				s.log.Warn("limits sync: set warn_at failed", "org_id", l.OrgID, "err", err)
			}
		}
		if l.BlockAt > 0 {
			if err := s.redis.SetLimit(ctx, l.OrgID, "block_at", float64(l.BlockAt)); err != nil {
				s.log.Warn("limits sync: set block_at failed", "org_id", l.OrgID, "err", err)
			}
		}
		synced++
	}

	s.log.Debug("limits synced", "total", len(limits), "synced", synced)
}
