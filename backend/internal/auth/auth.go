package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/tokenfin/backend/internal/db"
	"github.com/tokenfin/backend/internal/models"
	"github.com/tokenfin/backend/internal/redis"
)

// ErrInvalidKey is returned when the API key is missing, malformed, or not found.
var ErrInvalidKey = errors.New("invalid or inactive api key")

// ErrExpiredKey is returned when the key's expires_at is in the past.
var ErrExpiredKey = errors.New("api key expired")

// ErrInsufficientScope is returned when the key lacks the "write" scope.
var ErrInsufficientScope = errors.New(`api key lacks the "write" scope required to ingest usage`)

// ErrNoProject is returned when the key has no project and its org has none.
var ErrNoProject = errors.New("no project found for this org")

const keyPrefix = "tfk_" // all TokenFin keys start with this

// Service validates API keys against Redis cache + Supabase fallback.
type Service struct {
	db    *db.Client
	redis *redis.Client
}

func NewService(db *db.Client, redis *redis.Client) *Service {
	return &Service{db: db, redis: redis}
}

// Validate extracts the Bearer token from the Authorization header,
// resolves it to an APIKey, and returns ErrInvalidKey if anything is wrong.
// Redis is checked first; Supabase is the fallback.
func (s *Service) Validate(ctx context.Context, authHeader string) (*models.APIKey, error) {
	rawKey, err := extractBearer(authHeader)
	if err != nil {
		return nil, ErrInvalidKey
	}

	hash := hashKey(rawKey)

	// 1. Redis cache hit (cached keys already passed scope/project checks;
	//    expiry is re-checked because it can pass while cached).
	if cached, err := s.redis.GetAPIKey(ctx, hash); err == nil && cached != "" {
		if key, err := parseCache(cached); err == nil {
			if err := checkKey(key, time.Now()); err != nil {
				return nil, err
			}
			return key, nil
		}
		// Unparseable (e.g. legacy "org:project" format) → treat as a miss.
	}

	// 2. Supabase lookup
	key, err := s.db.LookupAPIKey(ctx, hash)
	if err != nil {
		return nil, fmt.Errorf("auth lookup: %w", err)
	}
	if key == nil {
		return nil, ErrInvalidKey
	}
	if err := checkKey(key, time.Now()); err != nil {
		return nil, err
	}

	// 3. Keys without a project attribute usage to the org's first project
	//    (usage_events.project_id is NOT NULL).
	if key.ProjectID == "" {
		pid, err := s.db.FirstProjectID(ctx, key.OrgID)
		if err != nil {
			return nil, fmt.Errorf("auth project lookup: %w", err)
		}
		if pid == "" {
			return nil, ErrNoProject
		}
		key.ProjectID = pid
	}

	// 4. Cache for next requests (60s TTL — see redis.apiKeyCacheTTL)
	if v, err := encodeCache(key); err == nil {
		_ = s.redis.SetAPIKey(ctx, hash, v)
	}

	return key, nil
}

// checkKey enforces expiry and the "write" scope. Legacy keys with no scopes
// recorded are allowed (matches the web direct-ingest route, which also
// accepts an "ingest" scope).
func checkKey(key *models.APIKey, now time.Time) error {
	if key.ExpiresAt != nil && !key.ExpiresAt.After(now) {
		return ErrExpiredKey
	}
	if len(key.Scopes) == 0 {
		return nil
	}
	for _, sc := range key.Scopes {
		if sc == "write" || sc == "ingest" {
			return nil
		}
	}
	return ErrInsufficientScope
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// hashKey returns SHA-256 hex of the raw key — same algorithm as key creation.
func hashKey(key string) string {
	h := sha256.Sum256([]byte(key))
	return hex.EncodeToString(h[:])
}

// extractBearer parses "Bearer tf_xxx" and validates the prefix.
func extractBearer(header string) (string, error) {
	if header == "" {
		return "", errors.New("missing Authorization header")
	}

	parts := strings.SplitN(header, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
		return "", errors.New("expected: Authorization: Bearer <token>")
	}

	token := strings.TrimSpace(parts[1])
	if !strings.HasPrefix(token, keyPrefix) {
		return "", errors.New("key must start with tf_")
	}

	return token, nil
}

// cachedKey is the JSON form stored in Redis for a validated key.
type cachedKey struct {
	OrgID     string     `json:"o"`
	ProjectID string     `json:"p"`
	Scopes    []string   `json:"s,omitempty"`
	ExpiresAt *time.Time `json:"e,omitempty"`
}

func encodeCache(k *models.APIKey) (string, error) {
	b, err := json.Marshal(cachedKey{OrgID: k.OrgID, ProjectID: k.ProjectID, Scopes: k.Scopes, ExpiresAt: k.ExpiresAt})
	return string(b), err
}

// parseCache decodes a cached key. Legacy "orgID:projectID" values are
// rejected so they are re-resolved (and re-checked) from Supabase.
func parseCache(v string) (*models.APIKey, error) {
	var c cachedKey
	if err := json.Unmarshal([]byte(v), &c); err != nil || c.OrgID == "" || c.ProjectID == "" {
		return nil, errors.New("corrupted cache value")
	}
	return &models.APIKey{OrgID: c.OrgID, ProjectID: c.ProjectID, Scopes: c.Scopes, ExpiresAt: c.ExpiresAt}, nil
}
