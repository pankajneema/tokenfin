// Command gateway is the TokenFin Saver LLM gateway.
//
//	ANTHROPIC_BASE_URL=http://localhost:8003 claude
//	OPENAI_BASE_URL=http://localhost:8003/v1 codex
//
// It optimizes requests (output shaping today; input compression next), streams
// the provider response back unchanged, and records usage + savings.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/tokenfin/backend/internal/auth"
	"github.com/tokenfin/backend/internal/config"
	"github.com/tokenfin/backend/internal/db"
	"github.com/tokenfin/backend/internal/gateway"
	"github.com/tokenfin/backend/internal/redis"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("config error", "err", err)
		os.Exit(1)
	}
	level := slog.LevelDebug
	if cfg.IsProd() {
		level = slog.LevelInfo
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level}))

	redisClient, err := redis.New(cfg.RedisURL)
	if err != nil {
		log.Error("redis init failed", "err", err)
		os.Exit(1)
	}
	defer redisClient.Close()

	dbClient := db.New(cfg.SupabaseURL, cfg.SupabaseKey)
	authSvc := auth.NewService(dbClient, redisClient)

	verbosity := envInt("HEADROOM_VERBOSITY_LEVEL", 2)
	holdout := envFloat("HEADROOM_HOLDOUT", 0.05)

	capturePrompts := os.Getenv("CAPTURE_PROMPTS") == "1"
	routing := os.Getenv("HEADROOM_ROUTING") == "1"

	svc := gateway.NewService(authSvc, redisClient, dbClient, gateway.Config{
		AnthropicUpstream: os.Getenv("GATEWAY_ANTHROPIC_UPSTREAM"),
		OpenAIUpstream:    os.Getenv("GATEWAY_OPENAI_UPSTREAM"),
		VerbosityLevel:    verbosity,
		HoldoutRate:       holdout,
		CapturePrompts:    capturePrompts,
		Routing:           routing,
	}, log)

	// Eval-informed routing: keep the route cache warm.
	if routing {
		rctx, rcancel := context.WithCancel(context.Background())
		defer rcancel()
		go svc.RefreshRoutesLoop(rctx)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	mux.Handle("/", svc) // forward everything else to providers

	srv := &http.Server{
		Addr:              ":" + cfg.GatewayPort,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		// No write timeout: streaming responses can be long-lived.
	}

	go func() {
		log.Info("gateway started", "port", cfg.GatewayPort, "verbosity", verbosity, "holdout", holdout)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("server crashed", "err", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Info("shutdown signal received")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	log.Info("shutdown complete")
}

func envInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
func envFloat(k string, def float64) float64 {
	if v := os.Getenv(k); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return def
}
