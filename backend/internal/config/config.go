package config

import (
	"fmt"
	"os"
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
	IngestPort string // default: 8001
	WorkerPort string // default: 8002

	// Runtime
	Env string // "development" | "production"
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
		Env:         getWithDefault("ENV", "development"),
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
