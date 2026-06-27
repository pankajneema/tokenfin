package gateway

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

// marshalNoEscape serializes without HTML-escaping <, >, & so the <<ccr:…>>
// marker stays literal (and a few bytes smaller).
func marshalNoEscape(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// CCR — Compress-Cache-Retrieve. Reversible compression of bulky tool-result
// content. The original is cached (Redis) under a hash; the compressed form
// carries a <<ccr:HASH>> marker so the model (via the headroom_retrieve tool)
// can fetch the full version on demand. Nothing is ever irreversibly lost.

const (
	ccrMinTokens = 200 // below this, not worth compressing
	ccrKeepItems = 20  // JSON arrays: keep first N rows
	ccrHeadChars = 1500
	ccrTailChars = 500
)

func ccrHash(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])[:16]
}

// compressContent reversibly compresses one content string. Returns the
// compressed form, the hash to store the original under, tokens saved, and
// whether compression actually happened.
func compressContent(s string) (out, hash string, saved int, ok bool) {
	if estimateTokens(s) < ccrMinTokens {
		return s, "", 0, false
	}
	hash = ccrHash(s)

	// 1. JSON array of records → keep first N, summarize the rest.
	var arr []json.RawMessage
	if json.Unmarshal([]byte(s), &arr) == nil && len(arr) > ccrKeepItems {
		kept := arr[:ccrKeepItems]
		summary := map[string]any{
			"_ccr":          fmt.Sprintf("<<ccr:%s>>", hash),
			"kept":          kept,
			"total_items":   len(arr),
			"dropped_items": len(arr) - ccrKeepItems,
			"note":          "Truncated to save tokens. Call headroom_retrieve with the hash above for all items.",
		}
		if b, err := marshalNoEscape(summary); err == nil {
			out = string(b)
			return out, hash, estimateTokens(s) - estimateTokens(out), true
		}
	}

	// 2. Large free text / logs → head + tail with a marker.
	r := []rune(s)
	if len(r) > ccrHeadChars+ccrTailChars+200 {
		out = string(r[:ccrHeadChars]) +
			fmt.Sprintf("\n…[%d chars omitted — headroom_retrieve <<ccr:%s>> for full content]…\n", len(r)-ccrHeadChars-ccrTailChars, hash) +
			string(r[len(r)-ccrTailChars:])
		return out, hash, estimateTokens(s) - estimateTokens(out), true
	}

	return s, "", 0, false
}

// contentToString flattens a tool_result block's content (string or array of
// {type:text,text}) into a single string for compression.
func contentToString(v any) (string, bool) {
	switch c := v.(type) {
	case string:
		return c, true
	case []any:
		// Anthropic tool_result content can be an array of text blocks.
		all := ""
		for _, b := range c {
			if blk, ok := b.(map[string]any); ok {
				if t, ok := blk["text"].(string); ok {
					all += t
				}
			}
		}
		if all != "" {
			return all, true
		}
	}
	return "", false
}
