package ingest

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tokenfin/backend/internal/auth"
	"github.com/tokenfin/backend/internal/models"
)

type stubAuth struct{ err error }

func (s stubAuth) Validate(context.Context, string) (*models.APIKey, error) {
	if s.err != nil {
		return nil, s.err
	}
	return &models.APIKey{OrgID: "org1", ProjectID: "proj1"}, nil
}

type stubProc struct {
	res    Result
	err    error
	gotReq *models.IngestRequest
}

func (s *stubProc) Process(_ context.Context, req *models.IngestRequest, _ *models.APIKey) (Result, error) {
	s.gotReq = req
	return s.res, s.err
}

func do(t *testing.T, h http.Handler, body string, hdr map[string]string) (int, map[string]any) {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/v1/ingest", strings.NewReader(body))
	r.Header.Set("Authorization", "Bearer tfk_x")
	for k, v := range hdr {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("body is not JSON (%q): %v", w.Body.String(), err)
	}
	return w.Code, out
}

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

const okBody = `{"model":"gpt-4o","input_tokens":10,"output_tokens":5}`

func TestHandlerAcceptedHasJSONBody(t *testing.T) {
	h := NewHandler(stubAuth{}, &stubProc{}, quiet)
	code, out := do(t, h, okBody, nil)
	if code != http.StatusAccepted || out["ok"] != true || out["accepted"] != true {
		t.Errorf("got %d %v; want 202 {ok:true,accepted:true}", code, out)
	}
}

func TestHandlerDuplicateHasJSONBody(t *testing.T) {
	h := NewHandler(stubAuth{}, &stubProc{res: Result{Duplicate: true}}, quiet)
	code, out := do(t, h, okBody, nil)
	if code != http.StatusOK || out["ok"] != true || out["duplicate"] != true {
		t.Errorf("got %d %v; want 200 {ok:true,duplicate:true}", code, out)
	}
}

func TestHandlerIdempotencyHeaderWins(t *testing.T) {
	p := &stubProc{}
	h := NewHandler(stubAuth{}, p, quiet)
	body := `{"model":"gpt-4o","input_tokens":1,"output_tokens":1,"idempotency_key":"body-key"}`
	do(t, h, body, map[string]string{"Idempotency-Key": "hdr-key"})
	if p.gotReq == nil || p.gotReq.IdempotencyKey != "hdr-key" {
		t.Errorf("idempotency key = %+v, want hdr-key", p.gotReq)
	}
	do(t, h, body, nil)
	if p.gotReq.IdempotencyKey != "body-key" {
		t.Errorf("idempotency key = %q, want body-key", p.gotReq.IdempotencyKey)
	}
}

func TestHandlerErrorsAreJSON(t *testing.T) {
	cases := []struct {
		name string
		h    http.Handler
		body string
		want int
	}{
		{"bad key", NewHandler(stubAuth{err: auth.ErrInvalidKey}, &stubProc{}, quiet), okBody, 401},
		{"expired", NewHandler(stubAuth{err: auth.ErrExpiredKey}, &stubProc{}, quiet), okBody, 403},
		{"scope", NewHandler(stubAuth{err: auth.ErrInsufficientScope}, &stubProc{}, quiet), okBody, 403},
		{"bad json", NewHandler(stubAuth{}, &stubProc{}, quiet), `{`, 400},
		{"limit", NewHandler(stubAuth{}, &stubProc{err: ErrLimitExceeded}, quiet), okBody, 429},
	}
	for _, c := range cases {
		code, out := do(t, c.h, c.body, nil)
		if code != c.want || out["error"] == nil {
			t.Errorf("%s: got %d %v; want %d with error", c.name, code, out, c.want)
		}
	}
}
