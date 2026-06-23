package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/tokenfin/backend/internal/db"
	"github.com/tokenfin/backend/internal/models"
	"github.com/tokenfin/backend/internal/redis"
)

// ErrInvalidKey is returned when the API key is missing, malformed, or not found.
var ErrInvalidKey = errors.New("invalid or inactive api key")

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

	// 1. Redis cache hit
	if cached, err := s.redis.GetAPIKey(ctx, hash); err == nil && cached != "" {
		return parseCache(cached)
	}

	// 2. Supabase lookup
	key, err := s.db.LookupAPIKey(ctx, hash)
	if err != nil {
		return nil, fmt.Errorf("auth lookup: %w", err)
	}
	if key == nil {
		return nil, ErrInvalidKey
	}

	// 3. Cache for next requests
	_ = s.redis.SetAPIKey(ctx, hash, key.OrgID+":"+key.ProjectID)

	return key, nil
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

// parseCache decodes the cached "orgID:projectID" string.
func parseCache(v string) (*models.APIKey, error) {
	parts := strings.SplitN(v, ":", 2)
	if len(parts) != 2 {
		return nil, errors.New("corrupted cache value")
	}
	return &models.APIKey{OrgID: parts[0], ProjectID: parts[1]}, nil
}
