package ingest

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/tokenfin/backend/internal/auth"
	"github.com/tokenfin/backend/internal/models"
)

const maxBodyBytes = 1 << 20 // 1 MB — generous for any ingest payload

// Handler is the HTTP handler for POST /v1/ingest.
type Handler struct {
	auth    *auth.Service
	service *Service
	log     *slog.Logger
}

func NewHandler(auth *auth.Service, svc *Service, log *slog.Logger) *Handler {
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
		if errors.Is(err, auth.ErrInvalidKey) {
			writeErr(w, http.StatusUnauthorized, "invalid api key")
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

	// ── Validate ──────────────────────────────────────────────
	if err := validate(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	// ── Process ───────────────────────────────────────────────
	if err := h.service.Process(r.Context(), &req, apiKey); err != nil {
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

	w.WriteHeader(http.StatusAccepted) // 202 — event accepted, processing async
}

// validate checks required fields and sane values.
func validate(req *models.IngestRequest) error {
	if req.Model == "" {
		return errors.New("model is required")
	}
	if req.InputTokens < 0 || req.OutputTokens < 0 {
		return errors.New("token counts cannot be negative")
	}
	if req.InputTokens+req.OutputTokens == 0 {
		return errors.New("total tokens must be > 0")
	}
	return nil
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg}) //nolint:errcheck
}
