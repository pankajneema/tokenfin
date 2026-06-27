package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config holds all environment-based configuration.
// All fields are required unless marked optional.
type Config struct {
	// Supabase
	SupabaseURL string // https://xxx.supabase.co
	SupabaseKey string // service role key — never log this

	// Redis
	RedisURL string // redis://localhost:6379

	// Server
	IngestPort  string // default: 8001
	WorkerPort  string // default: 8002
	GatewayPort string // default: 8003

	// Runtime
	Env string // "development" | "production"

	// WorkerConcurrency is the number of parallel stream consumers the worker
	// runs. Redis consumer groups load-balance messages across them, so this
	// scales DB write throughput near-linearly. Default 4.
	WorkerConcurrency int
}

// Load reads config from environment variables.
// Returns a descriptive error listing all missing vars at once.
func Load() (*Config, error) {
	var missing []string

	get := func(key string) string {
		v := os.Getenv(key)
		if v == "" {
			missing = append(missing, key)
		}
		return v
	}

	cfg := &Config{
		SupabaseURL: get("SUPABASE_URL"),
		SupabaseKey: get("SUPABASE_SERVICE_ROLE_KEY"),
		RedisURL:    get("REDIS_URL"),
		IngestPort:  getWithDefault("INGEST_PORT", "8001"),
		WorkerPort:  getWithDefault("WORKER_PORT", "8002"),
		GatewayPort: getWithDefault("GATEWAY_PORT", "8003"),
		Env:         getWithDefault("ENV", "development"),

		WorkerConcurrency: getIntWithDefault("WORKER_CONCURRENCY", 4),
	}

	if len(missing) > 0 {
		return nil, fmt.Errorf("missing required env vars: %s", strings.Join(missing, ", "))
	}

	return cfg, nil
}

func (c *Config) IsProd() bool {
	return c.Env == "production"
}

func getWithDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getIntWithDefault(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return fallback
}
