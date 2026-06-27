package gateway

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func bigJSONArray(n int) string {
	items := make([]map[string]any, n)
	for i := range items {
		items[i] = map[string]any{"id": i, "level": "info", "msg": fmt.Sprintf("log line number %d with some padding text", i)}
	}
	b, _ := json.Marshal(items)
	return string(b)
}

func TestCompressContentJSONReversibleMarker(t *testing.T) {
	s := bigJSONArray(200)
	out, hash, saved, ok := compressContent(s)
	if !ok {
		t.Fatal("expected compression")
	}
	if saved <= 0 {
		t.Errorf("expected positive savings, got %d", saved)
	}
	if !strings.Contains(out, "<<ccr:"+hash+">>") {
		t.Errorf("missing ccr marker: %s", out[:80])
	}
	if len(out) >= len(s) {
		t.Error("compressed not smaller")
	}
	// hash is deterministic
	if _, h2, _, _ := compressContent(s); h2 != hash {
		t.Error("hash not deterministic")
	}
}

func TestCompressContentSmallPassthrough(t *testing.T) {
	if _, _, _, ok := compressContent("short content"); ok {
		t.Error("short content should not compress")
	}
}

func TestCompressRequestInjectsToolAndCaches(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": []any{
				map[string]any{"type": "tool_result", "tool_use_id": "t1", "content": bigJSONArray(300)},
			}},
		},
	}
	origs, saved, changed := compressRequest(body)
	if !changed || saved <= 0 || len(origs) != 1 {
		t.Fatalf("expected compression: changed=%v saved=%d origs=%d", changed, saved, len(origs))
	}
	tools, _ := body["tools"].([]any)
	found := false
	for _, tl := range tools {
		if tm, ok := tl.(map[string]any); ok && tm["name"] == ccrToolName {
			found = true
		}
	}
	if !found {
		t.Error("headroom_retrieve tool not injected")
	}
	// idempotent — running again must not add a second tool
	compressRequest(body)
	if got := len(body["tools"].([]any)); got != 1 {
		t.Errorf("tool injection not idempotent, tools=%d", got)
	}
}

func TestParseRetrieveCalls(t *testing.T) {
	resp := map[string]any{"content": []any{
		map[string]any{"type": "text", "text": "let me get more"},
		map[string]any{"type": "tool_use", "name": ccrToolName, "id": "tu_1",
			"input": map[string]any{"hash": "abc123"}},
	}}
	calls := parseRetrieveCalls(resp)
	if len(calls) != 1 || calls[0].ID != "tu_1" || calls[0].Hash != "abc123" {
		t.Errorf("bad parse: %#v", calls)
	}
}
