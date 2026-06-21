package worker

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/tokenfin/backend/internal/db"
	"github.com/tokenfin/backend/internal/redis"
)

const (
	reconcileInterval = 5 * time.Minute
	driftThreshold    = 0.01 // 1% — resync Redis counter if drift exceeds this
)

// Reconciler periodically compares Redis token counters against the ground truth
// in Supabase usage_agg. If drift exceeds the threshold, it resets Redis to the
// DB value so limit checks remain accurate.
type Reconciler struct {
	redis *redis.Client
	db    *db.Client
	log   *slog.Logger
}

func NewReconciler(rc *redis.Client, dbc *db.Client, log *slog.Logger) *Reconciler {
	return &Reconciler{redis: rc, db: dbc, log: log}
}

// Run ticks every reconcileInterval until ctx is cancelled.
func (r *Reconciler) Run(ctx context.Context) {
	r.log.Info("reconciler started", "interval", reconcileInterval)

	ticker := time.NewTicker(reconcileInterval)
	defer ticker.Stop()

	// Run once immediately at startup
	r.reconcile(ctx)

	for {
		select {
		case <-ctx.Done():
			r.log.Info("reconciler stopping")
			return
		case <-ticker.C:
			r.reconcile(ctx)
		}
	}
}

// reconcile scans all org usage keys in Redis for the current month
// and compares each counter against Supabase.
func (r *Reconciler) reconcile(ctx context.Context) {
	month := time.Now().UTC().Format("2006-01")

	// Find all token usage keys for this month: org:*:usage:tokens:YYYY-MM
	pattern := "org:*:usage:tokens:" + month
	keys, err := r.redis.ScanKeys(ctx, pattern)
	if err != nil {
		r.log.Error("reconciler scan failed", "err", err)
		return
	}

	if len(keys) == 0 {
		return
	}

	r.log.Debug("reconciler scanning", "month", month, "orgs", len(keys))

	for _, key := range keys {
		orgID := extractOrgID(key)
		if orgID == "" {
			continue
		}

		if err := r.checkOrg(ctx, orgID, month); err != nil {
			r.log.Warn("org reconcile failed", "org_id", orgID, "err", err)
		}
	}
}

// checkOrg compares both Redis counters (tokens + cost) vs Supabase for one org.
// Resets each counter independently if drift exceeds driftThreshold.
func (r *Reconciler) checkOrg(ctx context.Context, orgID, month string) error {
	// ── Token counter ─────────────────────────────────────────
	redisTokens, err := r.redis.GetTokenUsage(ctx, orgID, month)
	if err != nil {
		return fmt.Errorf("get redis tokens: %w", err)
	}

	dbTokens, err := r.db.GetAggTokenSum(ctx, orgID, month)
	if err != nil {
		return fmt.Errorf("get db tokens: %w", err)
	}

	if tokenDrift := computeDrift(redisTokens, dbTokens); tokenDrift > driftThreshold {
		r.log.Warn("token counter drift — resyncing",
			"org_id", orgID,
			"redis", redisTokens,
			"db", dbTokens,
			"drift_pct", math.Round(tokenDrift*10000)/100,
		)
		if err := r.redis.SetTokenUsage(ctx, orgID, month, dbTokens); err != nil {
			r.log.Error("token resync failed", "org_id", orgID, "err", err)
		} else {
			r.log.Info("token counter resynced", "org_id", orgID, "new_value", dbTokens)
		}
	}

	// ── Cost counter (used for limit enforcement) ─────────────
	redisCost, err := r.redis.GetCostUsage(ctx, orgID, month)
	if err != nil {
		return fmt.Errorf("get redis cost: %w", err)
	}

	dbCost, err := r.db.GetAggCostSum(ctx, orgID, month)
	if err != nil {
		return fmt.Errorf("get db cost: %w", err)
	}

	if costDrift := computeDriftFloat(redisCost, dbCost); costDrift > driftThreshold {
		r.log.Warn("cost counter drift — resyncing",
			"org_id", orgID,
			"redis", redisCost,
			"db", dbCost,
			"drift_pct", math.Round(costDrift*10000)/100,
		)
		if err := r.redis.SetCostUsage(ctx, orgID, month, dbCost); err != nil {
			r.log.Error("cost resync failed", "org_id", orgID, "err", err)
		} else {
			r.log.Info("cost counter resynced", "org_id", orgID, "new_value", dbCost)
		}
	}

	return nil
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// computeDrift returns the fractional difference for int64 counters (tokens).
func computeDrift(redis int64, db int64) float64 {
	if db == 0 {
		if redis == 0 {
			return 0
		}
		return 1.0
	}
	diff := float64(redis - db)
	if diff < 0 {
		diff = -diff
	}
	return diff / float64(db)
}

// computeDriftFloat returns the fractional difference for float64 counters (cost).
func computeDriftFloat(redis float64, db float64) float64 {
	if db == 0 {
		if redis == 0 {
			return 0
		}
		return 1.0
	}
	diff := redis - db
	if diff < 0 {
		diff = -diff
	}
	return diff / db
}

// extractOrgID parses org_id out of a key like "org:{orgID}:usage:tokens:YYYY-MM".
func extractOrgID(key string) string {
	// key format: org:{uuid}:usage:tokens:YYYY-MM
	// Split on ":" → ["org", "{uuid}", "usage", "tokens", "YYYY-MM"]
	parts := splitN(key, ':', 3)
	if len(parts) < 2 {
		return ""
	}
	return parts[1]
}

// splitN splits s on sep up to n pieces (avoids importing strings for one use).
func splitN(s string, sep byte, n int) []string {
	out := make([]string, 0, n)
	start := 0
	for i := 0; i < len(s) && len(out) < n-1; i++ {
		if s[i] == sep {
			out = append(out, s[start:i])
			start = i + 1
		}
	}
	out = append(out, s[start:])
	return out
}
