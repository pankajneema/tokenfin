package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/tokenfin/backend/internal/auth"
	"github.com/tokenfin/backend/internal/models"
)

const maxBodyBytes = 1 << 20 // 1 MB — generous for any ingest payload

// maxIdempotencyKeyLen bounds the key we store in Redis and event_id.
const maxIdempotencyKeyLen = 255

// KeyValidator resolves an Authorization header to an API key (auth.Service).
type KeyValidator interface {
	Validate(ctx context.Context, authHeader string) (*models.APIKey, error)
}

// Processor accepts a validated ingest request (*Service).
type Processor interface {
	Process(ctx context.Context, req *models.IngestRequest, apiKey *models.APIKey) (Result, error)
}

// Handler is the HTTP handler for POST /v1/ingest.
//
// Every response carries a JSON body: the Next.js proxy treats a non-JSON
// body as "Go service unavailable" and writes the event itself, so an empty
// 202 would double-count every event.
type Handler struct {
	auth    KeyValidator
	service Processor
	log     *slog.Logger
}

func NewHandler(auth KeyValidator, svc Processor, log *slog.Logger) *Handler {
	return &Handler{auth: auth, service: svc, log: log}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Clamp body size — reject oversized payloads early
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)

	// ── Auth ──────────────────────────────────────────────────
	apiKey, err := h.auth.Validate(r.Context(), r.Header.Get("Authorization"))
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrInvalidKey):
			writeErr(w, http.StatusUnauthorized, "invalid api key")
			return
		case errors.Is(err, auth.ErrExpiredKey):
			writeErr(w, http.StatusForbidden, "api key expired")
			return
		case errors.Is(err, auth.ErrInsufficientScope):
			writeErr(w, http.StatusForbidden, err.Error())
			return
		case errors.Is(err, auth.ErrNoProject):
			writeErr(w, http.StatusUnprocessableEntity, "no project found for this org; create a project in the dashboard first")
			return
		}
		// Unexpected auth error — don't leak details
		h.log.Error("auth error", "err", err)
		writeErr(w, http.StatusInternalServerError, "authentication failed")
		return
	}

	// ── Parse ─────────────────────────────────────────────────
	var req models.IngestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json body")
		return
	}

	// Idempotency-Key header wins over the body field (same as the web route).
	if hk := strings.TrimSpace(r.Header.Get("Idempotency-Key")); hk != "" {
		req.IdempotencyKey = hk
	}

	// ── Validate ──────────────────────────────────────────────
	if err := validate(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	// ── Process ───────────────────────────────────────────────
	res, err := h.service.Process(r.Context(), &req, apiKey)
	if err != nil {
		if errors.Is(err, ErrLimitExceeded) {
			writeErr(w, http.StatusTooManyRequests, "usage limit exceeded")
			return
		}
		// Log with context but don't expose internals
		h.log.Error("ingest failed",
			"org_id", apiKey.OrgID,
			"model", req.Model,
			"err", err,
		)
		writeErr(w, http.StatusInternalServerError, "ingest failed")
		return
	}

	if res.Duplicate {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "duplicate": true})
		return
	}
	// 202 — event accepted, processing async
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "accepted": true})
}

// validate checks required fields and sane values.
func validate(req *models.IngestRequest) error {
	if req.Model == "" {
		return errors.New("model is required")
	}
	if req.InputTokens < 0 || req.OutputTokens < 0 {
		return errors.New("token counts cannot be negative")
	}
	if req.CacheReadTokens < 0 || req.CacheWriteTokens < 0 {
		return errors.New("token counts cannot be negative")
	}
	if req.InputTokens+req.OutputTokens == 0 {
		return errors.New("total tokens must be > 0")
	}
	if len(req.IdempotencyKey) > maxIdempotencyKeyLen {
		return errors.New("idempotency key too long")
	}
	return nil
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"error": msg})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body) //nolint:errcheck
}
