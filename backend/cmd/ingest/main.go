package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/tokenfin/backend/internal/auth"
	"github.com/tokenfin/backend/internal/config"
	"github.com/tokenfin/backend/internal/db"
	"github.com/tokenfin/backend/internal/ingest"
	"github.com/tokenfin/backend/internal/redis"
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

	// auth uses db (key lookup) + redis (cache)
	authSvc := auth.NewService(dbClient, redisClient)

	// ingest service only needs redis (publishes to stream)
	ingestSvc := ingest.NewService(redisClient, log)
	handler := ingest.NewHandler(authSvc, ingestSvc, log)

	// ── Routes ────────────────────────────────────────────────
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		if err := dbClient.Ping(ctx); err != nil {
			log.Warn("health: db unreachable", "err", err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte(`{"ok":false,"reason":"db"}`)) //nolint:errcheck
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`)) //nolint:errcheck
	})

	mux.Handle("/v1/ingest", handler)

	// ── Server ────────────────────────────────────────────────
	srv := &http.Server{
		Addr:         ":" + cfg.IngestPort,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Info("ingest service started", "port", cfg.IngestPort, "env", cfg.Env)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("server crashed", "err", err)
			os.Exit(1)
		}
	}()

	// ── Graceful shutdown ─────────────────────────────────────
	<-quit
	log.Info("shutdown signal received")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Error("shutdown failed", "err", err)
		os.Exit(1)
	}
	log.Info("shutdown complete")
}
