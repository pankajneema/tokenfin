package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/tokenfin/backend/internal/config"
	"github.com/tokenfin/backend/internal/db"
	"github.com/tokenfin/backend/internal/redis"
	"github.com/tokenfin/backend/internal/worker"
)

func main() {
	// ── Config ────────────────────────────────────────────────
	cfg, err := config.Load()
	if err != nil {
		slog.Error("config error", "err", err)
		os.Exit(1)
	}

	logLevel := slog.LevelDebug
	if cfg.IsProd() {
		logLevel = slog.LevelInfo
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel}))

	// ── Dependencies ──────────────────────────────────────────
	redisClient, err := redis.New(cfg.RedisURL)
	if err != nil {
		log.Error("redis init failed", "err", err)
		os.Exit(1)
	}
	defer redisClient.Close()

	dbClient := db.New(cfg.SupabaseURL, cfg.SupabaseKey)

	// Verify DB is reachable before starting any goroutines
	pingCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := dbClient.Ping(pingCtx); err != nil {
		log.Error("supabase unreachable at startup", "err", err)
		os.Exit(1)
	}

	// ── Graceful-shutdown context ─────────────────────────────
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	log.Info("worker started", "env", cfg.Env)

	// ── LimitsSync — seed Redis with limits from DB ───────────
	// Must start before consumer so limits are available when ingest begins checking.
	// Runs every 2 min; initial sync is synchronous (via first tick in Run).
	limitsSync := worker.NewLimitsSync(redisClient, dbClient, log)
	go limitsSync.Run(ctx)

	// Brief pause so limitsSync can complete its first load before consumer starts.
	// Not strictly required — ingest fails open if limits aren't in Redis yet.
	time.Sleep(500 * time.Millisecond)

	// ── Consumers — DB writers ────────────────────────────────
	// Reads from usage.events.raw stream → bulk-inserts to Supabase → ACKs.
	// Run N parallel consumers in the same group; Redis load-balances messages
	// across them so DB write throughput scales near-linearly. Each needs a
	// unique name so their pending-entry lists (PEL) stay independent.
	concurrency := cfg.WorkerConcurrency
	if concurrency < 1 {
		concurrency = 1
	}
	log.Info("starting consumers", "concurrency", concurrency)
	for i := 0; i < concurrency; i++ {
		c := worker.NewConsumer(fmt.Sprintf("worker-%d", i), redisClient, dbClient, log)
		go c.Run(ctx)
	}

	// ── AlertConsumer — write notifications from alert stream ─
	// Reads from usage.alerts stream → writes to notifications table.
	alertConsumer := worker.NewAlertConsumer(redisClient, dbClient, log)
	go alertConsumer.Run(ctx)

	// ── Reconciler — counter drift correction ─────────────────
	// Compares Redis token counters vs Supabase every 5 min, resets on >1% drift.
	reconciler := worker.NewReconciler(redisClient, dbClient, log)
	go reconciler.Run(ctx)

	// ── Wait for shutdown ─────────────────────────────────────
	<-ctx.Done()
	log.Info("shutdown signal received — draining goroutines")

	// Give goroutines time to finish their current batch
	time.Sleep(5 * time.Second)
	log.Info("worker shutdown complete")
}
