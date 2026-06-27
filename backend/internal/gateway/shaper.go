package gateway

// Output shaping — the cache-safe, request-side levers from Headroom.
//
//  Lever A: verbosity steering — append a terse-style instruction to the TAIL
//           of the system prompt. Tail, never head: a byte change before a
//           cache_control breakpoint invalidates the provider's KV cache and
//           costs more than it saves.
//  Lever B: effort routing — on a mechanical continuation (the last user turn
//           is only clean tool_results), lower thinking effort, which bills as
//           output. New questions / errors keep full effort.
//
// Safety rules (each prevents a concrete provider 400 / cache bust):
//   - Never INJECT output_config.effort or thinking where the client didn't
//     send it — only lower an already-present value.
//   - Never toggle thinking.type.
//   - Steering is byte-stable + idempotent (sentinel-tagged) so repeated
//     requests keep an identical prefix.

const steeringSentinel = "[headroom:vstyle]"

// Verbosity level text. L2 is the default — matches the project's own
// output-shaping policy.
var verbosityText = map[int]string{
	1: steeringSentinel + " Be concise: skip preamble and postamble; do not announce what you are about to do.",
	2: steeringSentinel + " Be concise: skip preamble/postamble. Do not restate code, file contents, diffs, or tool output already in context — reference by path:line. Do not narrate tool results.",
	3: steeringSentinel + " Answer with conclusions only; omit rationale unless asked; prefer the smallest possible edit.",
	4: steeringSentinel + " Minimum tokens. Fragments fine. Output only the answer.",
}

type turnClass int

const (
	turnNewAsk turnClass = iota
	turnMechanical
	turnError
	turnUnknown
)

// classifyTurn inspects the LAST user message structurally (no keyword lists).
func classifyTurn(body map[string]any) turnClass {
	msgs, ok := body["messages"].([]any)
	if !ok || len(msgs) == 0 {
		return turnUnknown
	}
	// Find the last user message.
	var last map[string]any
	for i := len(msgs) - 1; i >= 0; i-- {
		m, ok := msgs[i].(map[string]any)
		if !ok {
			continue
		}
		if m["role"] == "user" {
			last = m
			break
		}
	}
	if last == nil {
		return turnUnknown
	}
	blocks, ok := last["content"].([]any)
	if !ok {
		// content is a plain string → a new textual ask.
		if _, isStr := last["content"].(string); isStr {
			return turnNewAsk
		}
		return turnUnknown
	}
	sawToolResult := false
	for _, b := range blocks {
		blk, ok := b.(map[string]any)
		if !ok {
			continue
		}
		switch blk["type"] {
		case "tool_result":
			sawToolResult = true
			if isErr, _ := blk["is_error"].(bool); isErr {
				return turnError // model must reason about the failure
			}
		case "text", "image", "document":
			return turnNewAsk
		}
	}
	if sawToolResult {
		return turnMechanical
	}
	return turnUnknown
}

// applyVerbositySteering appends the steering block to the tail of the system
// prompt. Idempotent: if a steering block is already present it is replaced in
// place, keeping the prefix byte-stable across requests.
func applyVerbositySteering(body map[string]any, level int) bool {
	text, ok := verbosityText[level]
	if !ok {
		return false
	}
	switch sys := body["system"].(type) {
	case nil:
		body["system"] = []any{map[string]any{"type": "text", "text": text}}
		return true
	case string:
		body["system"] = []any{
			map[string]any{"type": "text", "text": sys},
			map[string]any{"type": "text", "text": text},
		}
		return true
	case []any:
		// Replace an existing steering block if present (idempotent).
		for _, b := range sys {
			if blk, ok := b.(map[string]any); ok {
				if t, _ := blk["text"].(string); len(t) >= len(steeringSentinel) && t[:len(steeringSentinel)] == steeringSentinel {
					blk["text"] = text
					return true
				}
			}
		}
		body["system"] = append(sys, map[string]any{"type": "text", "text": text})
		return true
	}
	return false
}

// applyEffortRouting lowers effort on mechanical turns. Only ever lowers an
// existing value — never injects one.
func applyEffortRouting(body map[string]any) bool {
	changed := false
	// Newer effort field.
	if oc, ok := body["output_config"].(map[string]any); ok {
		if _, has := oc["effort"]; has && oc["effort"] != "low" {
			oc["effort"] = "low"
			changed = true
		}
	}
	// Legacy thinking budget — clamp to the API floor; never toggle type.
	if th, ok := body["thinking"].(map[string]any); ok {
		if bt, ok := numberOf(th["budget_tokens"]); ok && bt > 1024 {
			th["budget_tokens"] = float64(1024) // keep float so JSON round-trips identically
			changed = true
		}
	}
	return changed
}

func numberOf(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	}
	return 0, false
}

// shapeAnthropic applies both output levers in place and returns the list of
// optimizations that fired (for the savings ledger).
func shapeAnthropic(body map[string]any, verbosityLevel int) []string {
	applied := []string{}
	if applyVerbositySteering(body, verbosityLevel) {
		applied = append(applied, "verbosity_steering")
	}
	if classifyTurn(body) == turnMechanical {
		if applyEffortRouting(body) {
			applied = append(applied, "effort_routing")
		}
	}
	return applied
}
