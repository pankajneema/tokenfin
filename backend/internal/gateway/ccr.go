package gateway

// CCR request rewriting + the headroom_retrieve tool. Compression replaces bulky
// tool_result content with a summary + <<ccr:HASH>> marker and injects a tool the
// model can call to get the original back. The proxy resolves that tool call
// inline (buffered path) so the client never sees the machinery.

const ccrToolName = "headroom_retrieve"

// ccrToolDef returns the Anthropic-format tool definition.
func ccrToolDef() map[string]any {
	return map[string]any{
		"name":        ccrToolName,
		"description": "Retrieve the full, uncompressed content that was truncated to save tokens. Pass the hash from a <<ccr:HASH>> marker.",
		"input_schema": map[string]any{
			"type":       "object",
			"properties": map[string]any{"hash": map[string]any{"type": "string"}},
			"required":   []any{"hash"},
		},
	}
}

// compressRequest walks the Anthropic message list, compresses tool_result
// blocks, and (if anything compressed) injects the retrieve tool. Returns the
// hash→original map to cache, total tokens saved, and whether it changed.
func compressRequest(body map[string]any) (origs map[string]string, saved int, changed bool) {
	origs = map[string]string{}
	msgs, ok := body["messages"].([]any)
	if !ok {
		return origs, 0, false
	}
	for _, m := range msgs {
		msg, ok := m.(map[string]any)
		if !ok {
			continue
		}
		blocks, ok := msg["content"].([]any)
		if !ok {
			continue
		}
		for _, b := range blocks {
			blk, ok := b.(map[string]any)
			if !ok || blk["type"] != "tool_result" {
				continue
			}
			raw, ok := contentToString(blk["content"])
			if !ok {
				continue
			}
			out, hash, s, did := compressContent(raw)
			if !did {
				continue
			}
			blk["content"] = out // tool_result content becomes the compressed string
			origs[hash] = raw
			saved += s
			changed = true
		}
	}
	if changed {
		injectRetrieveTool(body)
	}
	return origs, saved, changed
}

func injectRetrieveTool(body map[string]any) {
	tools, _ := body["tools"].([]any)
	for _, t := range tools { // idempotent
		if tm, ok := t.(map[string]any); ok && tm["name"] == ccrToolName {
			return
		}
	}
	body["tools"] = append(tools, ccrToolDef())
}

// anthropicToolUse is a parsed headroom_retrieve call from a response.
type anthropicToolUse struct {
	ID   string
	Hash string
}

// parseRetrieveCalls extracts headroom_retrieve tool_use blocks from a buffered
// Anthropic (non-stream) response body.
func parseRetrieveCalls(resp map[string]any) []anthropicToolUse {
	var calls []anthropicToolUse
	content, ok := resp["content"].([]any)
	if !ok {
		return calls
	}
	for _, b := range content {
		blk, ok := b.(map[string]any)
		if !ok || blk["type"] != "tool_use" || blk["name"] != ccrToolName {
			continue
		}
		id, _ := blk["id"].(string)
		hash := ""
		if input, ok := blk["input"].(map[string]any); ok {
			hash, _ = input["hash"].(string)
		}
		calls = append(calls, anthropicToolUse{ID: id, Hash: hash})
	}
	return calls
}
