package gateway

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newTestService(upstream string) *Service {
	return NewService(nil, nil, nil, Config{
		AnthropicUpstream: upstream,
		VerbosityLevel:    2,
		HoldoutRate:       0, // never holdout in tests
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

// mock provider echoes the request body it received and returns a usage block.
func mockProvider(t *testing.T, gotBody *[]byte) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		*gotBody = b
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"claude-sonnet-4-6","usage":{"input_tokens":1200,"output_tokens":300}}`))
	}))
}

func doMessages(t *testing.T, svc *Service, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(body))
	rec := httptest.NewRecorder()
	svc.ServeHTTP(rec, req)
	return rec
}

func TestProxyAppliesShapingToForwardedBody(t *testing.T) {
	var got []byte
	up := mockProvider(t, &got)
	defer up.Close()
	svc := newTestService(up.URL)

	rec := doMessages(t, svc, `{"system":"x","output_config":{"effort":"high"},
		"messages":[{"role":"user","content":[{"type":"tool_result","content":"ok"}]}]}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	fwd := string(got)
	if !strings.Contains(fwd, steeringSentinel) {
		t.Error("steering not applied to forwarded body")
	}
	if !strings.Contains(fwd, `"effort":"low"`) {
		t.Error("effort not lowered in forwarded body")
	}
	if !strings.Contains(rec.Body.String(), "output_tokens") {
		t.Error("provider response not streamed back")
	}
}

func TestProxyFailOpenOnBadJSON(t *testing.T) {
	var got []byte
	up := mockProvider(t, &got)
	defer up.Close()
	svc := newTestService(up.URL)

	// Malformed JSON on a /messages path must still forward UNCHANGED.
	bad := `{not valid json`
	rec := doMessages(t, svc, bad)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if string(got) != bad {
		t.Errorf("body was mutated on fail-open path: %q", string(got))
	}
}

func TestParseUsage(t *testing.T) {
	// anthropic style, split across an SSE-like stream — take the max seen.
	b := []byte(`event: message_start
data: {"usage":{"input_tokens":1500,"output_tokens":1}}

event: message_delta
data: {"usage":{"output_tokens":420}}`)
	in, out := parseUsage(b)
	if in != 1500 || out != 420 {
		t.Errorf("parseUsage = (%d,%d) want (1500,420)", in, out)
	}
	// openai style
	in, out = parseUsage([]byte(`{"usage":{"prompt_tokens":800,"completion_tokens":210}}`))
	if in != 800 || out != 210 {
		t.Errorf("openai parseUsage = (%d,%d) want (800,210)", in, out)
	}
}
