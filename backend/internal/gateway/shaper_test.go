package gateway

import (
	"encoding/json"
	"strings"
	"testing"
)

func parse(t *testing.T, s string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	return m
}

func TestClassifyTurn(t *testing.T) {
	cases := map[string]struct {
		body string
		want turnClass
	}{
		"new text ask": {`{"messages":[{"role":"user","content":[{"type":"text","text":"hi"}]}]}`, turnNewAsk},
		"plain string": {`{"messages":[{"role":"user","content":"hello"}]}`, turnNewAsk},
		"mechanical":   {`{"messages":[{"role":"user","content":[{"type":"tool_result","content":"ok"}]}]}`, turnMechanical},
		"error":        {`{"messages":[{"role":"user","content":[{"type":"tool_result","is_error":true,"content":"boom"}]}]}`, turnError},
		"empty":        {`{"messages":[]}`, turnUnknown},
	}
	for name, c := range cases {
		if got := classifyTurn(parse(t, c.body)); got != c.want {
			t.Errorf("%s: got %v want %v", name, got, c.want)
		}
	}
}

func TestVerbositySteeringTailAndIdempotent(t *testing.T) {
	body := parse(t, `{"system":"You are helpful.","messages":[]}`)
	applyVerbositySteering(body, 2)
	sys, ok := body["system"].([]any)
	if !ok || len(sys) != 2 {
		t.Fatalf("system not converted to 2-block array: %#v", body["system"])
	}
	// Original block must be FIRST (prefix preserved); steering appended at tail.
	first := sys[0].(map[string]any)["text"].(string)
	last := sys[1].(map[string]any)["text"].(string)
	if first != "You are helpful." {
		t.Errorf("prefix block mutated: %q", first)
	}
	if !strings.HasPrefix(last, steeringSentinel) {
		t.Errorf("steering not at tail: %q", last)
	}
	// Idempotent: applying again must NOT add a third block.
	applyVerbositySteering(body, 2)
	if got := len(body["system"].([]any)); got != 2 {
		t.Errorf("steering not idempotent, blocks=%d", got)
	}
}

func TestEffortRoutingNeverInjects(t *testing.T) {
	// No effort/thinking present → must not be added.
	body := parse(t, `{"messages":[]}`)
	if applyEffortRouting(body) {
		t.Error("effort routing changed a body with no effort/thinking")
	}
	if _, has := body["output_config"]; has {
		t.Error("output_config was injected")
	}
	// Present effort → lowered.
	body = parse(t, `{"output_config":{"effort":"xhigh"},"thinking":{"type":"enabled","budget_tokens":8000}}`)
	if !applyEffortRouting(body) {
		t.Fatal("expected effort routing to lower values")
	}
	if body["output_config"].(map[string]any)["effort"] != "low" {
		t.Error("effort not lowered to low")
	}
	if body["thinking"].(map[string]any)["budget_tokens"].(float64) != 1024 {
		t.Error("thinking budget not clamped to 1024")
	}
	if body["thinking"].(map[string]any)["type"] != "enabled" {
		t.Error("thinking.type was toggled (must never change)")
	}
}

func TestShapeAnthropicMechanicalAppliesBoth(t *testing.T) {
	body := parse(t, `{"system":"x","output_config":{"effort":"high"},
		"messages":[{"role":"user","content":[{"type":"tool_result","content":"ok"}]}]}`)
	applied := shapeAnthropic(body, 2)
	has := map[string]bool{}
	for _, a := range applied {
		has[a] = true
	}
	if !has["verbosity_steering"] || !has["effort_routing"] {
		t.Errorf("expected both levers, got %v", applied)
	}
}

func TestShapeAnthropicNewAskKeepsEffort(t *testing.T) {
	body := parse(t, `{"output_config":{"effort":"high"},
		"messages":[{"role":"user","content":[{"type":"text","text":"new question"}]}]}`)
	shapeAnthropic(body, 2)
	if body["output_config"].(map[string]any)["effort"] != "high" {
		t.Error("effort lowered on a NEW ask (should stay high)")
	}
}
