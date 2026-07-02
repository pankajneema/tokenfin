package gateway

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestRewriteModel(t *testing.T) {
	out := rewriteModel([]byte(`{"model":"claude-opus-4-8","max_tokens":100}`), "claude-haiku-4-5")
	if out == nil {
		t.Fatal("rewriteModel returned nil")
	}
	var m map[string]any
	if err := json.Unmarshal(out, &m); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if m["model"] != "claude-haiku-4-5" {
		t.Errorf("model not rewritten: %v", m["model"])
	}
	if m["max_tokens"] != float64(100) {
		t.Error("other fields lost")
	}
	if strings.Contains(string(out), "opus") {
		t.Error("original model still present")
	}
	// invalid JSON → nil (fail open)
	if rewriteModel([]byte(`not json`), "x") != nil {
		t.Error("expected nil on invalid json")
	}
}

func TestRouteFor(t *testing.T) {
	s := &Service{routes: map[string]map[string]string{
		"org1": {"claude-opus-4-8": "claude-haiku-4-5"},
	}}
	if got := s.routeFor("org1", "claude-opus-4-8"); got != "claude-haiku-4-5" {
		t.Errorf("routeFor = %q, want claude-haiku-4-5", got)
	}
	if got := s.routeFor("org1", "gpt-4o"); got != "" {
		t.Errorf("routeFor unknown model = %q, want empty", got)
	}
	if got := s.routeFor("org2", "claude-opus-4-8"); got != "" {
		t.Errorf("routeFor unknown org = %q, want empty", got)
	}
}
