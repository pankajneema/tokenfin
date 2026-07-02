// Package gateway is the TokenFin Saver LLM gateway: a reverse proxy clients
// point ANTHROPIC_BASE_URL / OPENAI_BASE_URL at. It applies cache-safe
// token-saving levers, streams the provider response straight back, and records
// actual usage plus the baseline (the delta = savings).
//
// Invariant: FAIL OPEN. Any error in auth, shaping, or measurement must still
// forward the ORIGINAL request unchanged — we never break a user's LLM call to
// save tokens.
package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"math/rand"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/tokenfin/backend/internal/auth"
	"github.com/tokenfin/backend/internal/db"
	"github.com/tokenfin/backend/internal/models"
	"github.com/tokenfin/backend/internal/pricing"
	"github.com/tokenfin/backend/internal/redis"
)

const (
	maxBodyBytes    = 8 << 20  // 8 MB request cap
	maxCaptureBytes = 4 << 20  // capture up to 4 MB of response to parse usage
	tokenfinHeader  = "X-Tokenfin-Key"
)

// hop-by-hop headers must not be forwarded.
var hopByHop = map[string]bool{
	"Connection": true, "Keep-Alive": true, "Proxy-Authenticate": true,
	"Proxy-Authorization": true, "Te": true, "Trailers": true,
	"Transfer-Encoding": true, "Upgrade": true,
}

type Service struct {
	auth        *auth.Service
	redis       *redis.Client
	db          *db.Client
	http        *http.Client
	log         *slog.Logger
	anthropicUp string
	openaiUp    string
	verbosity   int
	holdoutRate float64
	capture     bool
	routing     bool
	rng         *rand.Rand

	mu     sync.RWMutex
	routes map[string]map[string]string // orgID → fromModel → toModel
}

type Config struct {
	AnthropicUpstream string
	OpenAIUpstream    string
	VerbosityLevel    int
	HoldoutRate       float64
	CapturePrompts    bool
	Routing           bool
}

func NewService(authSvc *auth.Service, rc *redis.Client, dbc *db.Client, cfg Config, log *slog.Logger) *Service {
	if cfg.AnthropicUpstream == "" {
		cfg.AnthropicUpstream = "https://api.anthropic.com"
	}
	if cfg.OpenAIUpstream == "" {
		cfg.OpenAIUpstream = "https://api.openai.com"
	}
	return &Service{
		auth:        authSvc,
		redis:       rc,
		db:          dbc,
		http:        &http.Client{Timeout: 10 * time.Minute}, // long for streaming
		log:         log,
		anthropicUp: strings.TrimRight(cfg.AnthropicUpstream, "/"),
		openaiUp:    strings.TrimRight(cfg.OpenAIUpstream, "/"),
		verbosity:   cfg.VerbosityLevel,
		holdoutRate: cfg.HoldoutRate,
		capture:     cfg.CapturePrompts,
		routing:     cfg.Routing,
		rng:         rand.New(rand.NewSource(time.Now().UnixNano())),
		routes:      map[string]map[string]string{},
	}
}

func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	isAnthropic := strings.Contains(r.URL.Path, "/messages")
	upstreamBase := s.openaiUp
	if isAnthropic {
		upstreamBase = s.anthropicUp
	}
	upstreamURL := upstreamBase + r.URL.Path
	if r.URL.RawQuery != "" {
		upstreamURL += "?" + r.URL.RawQuery
	}

	original, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes))
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}

	// Attribution (never blocks forwarding — fail open).
	var apiKey *models.APIKey
	if tk := r.Header.Get(tokenfinHeader); tk != "" {
		if k, err := s.auth.Validate(r.Context(), "Bearer "+tk); err == nil {
			apiKey = k
		}
	}

	// Decide: holdout (bypass all levers) vs optimize.
	holdout := s.rng.Float64() < s.holdoutRate
	outBody := original
	var optimizations []string
	originalModel := extractModel(original)
	routedModel := originalModel

	// Eval-informed routing: rewrite to the approved cheaper model (same provider).
	if s.routing && !holdout && apiKey != nil {
		if to := s.routeFor(apiKey.OrgID, originalModel); to != "" && to != originalModel {
			routedModel = to
		}
	}
	routed := routedModel != originalModel

	streaming := isStream(original)

	if !holdout && isAnthropic {
		var parsed map[string]any
		if json.Unmarshal(original, &parsed) == nil {
			optimizations = shapeAnthropic(parsed, s.verbosity)
			if routed {
				parsed["model"] = routedModel
				optimizations = append(optimizations, "model_routing")
			}

			// CCR input compression is only safe on non-streaming requests
			// (the retrieve round-trip must buffer the response). Streaming
			// requests still get output shaping above.
			ccrActive := false
			if !streaming {
				if origs, _, changed := compressRequest(parsed); changed {
					ccrActive = true
					optimizations = append(optimizations, "input_compression")
					ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
					for h, o := range origs {
						_ = s.redis.CCRPut(ctx, h, o, time.Hour)
					}
					cancel()
				}
			}

			if reb, err := json.Marshal(parsed); err == nil {
				outBody = reb
			} else {
				optimizations = nil // marshal failed → fail open
				ccrActive = false
			}

			if ccrActive {
				s.handleCCR(w, r, parsed, original, upstreamURL, apiKey, originalModel, optimizations, holdout)
				return
			}
		}
	} else if routed {
		// Non-Anthropic (or otherwise unparsed) path — rewrite the model generically.
		if reb := rewriteModel(outBody, routedModel); reb != nil {
			outBody = reb
			optimizations = append(optimizations, "model_routing")
		}
	}

	// Build upstream request.
	upReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, upstreamURL, bytes.NewReader(outBody))
	if err != nil {
		http.Error(w, "upstream build", http.StatusBadGateway)
		return
	}
	for k, vv := range r.Header {
		if hopByHop[http.CanonicalHeaderKey(k)] || k == tokenfinHeader || k == "Content-Length" || k == "Host" {
			continue
		}
		for _, v := range vv {
			upReq.Header.Add(k, v)
		}
	}

	resp, err := s.http.Do(upReq)
	if err != nil {
		s.log.Warn("upstream error", "err", err)
		http.Error(w, "upstream unreachable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Stream response back, capturing a bounded copy to parse usage.
	for k, vv := range resp.Header {
		if hopByHop[http.CanonicalHeaderKey(k)] {
			continue
		}
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)

	capture := &cappedBuffer{limit: maxCaptureBytes}
	flusher, _ := w.(http.Flusher)
	if err := streamCopy(w, resp.Body, capture, flusher); err != nil {
		s.log.Warn("stream copy interrupted", "err", err)
		return
	}

	// Record asynchronously — never on the response path.
	if apiKey != nil && resp.StatusCode < 300 {
		inTok, outTok := parseUsage(capture.Bytes())
		go s.record(apiKey, originalModel, original, outBody, capture.Bytes(), inTok, outTok, optimizations, holdout)
	}
}

// record builds the usage event (with savings) and publishes to the stream the
// worker already drains into usage_events / usage_agg. `originalModel` is what
// the client asked for (baseline); the actual model billed is read from the
// response — so model-routing savings show as baseline(original) − actual(routed).
func (s *Service) record(key *models.APIKey, originalModel string, original, sent, resp []byte, inTok, outTok int, opts []string, holdout bool) {
	if originalModel == "" {
		originalModel = "unknown"
	}
	actualModel := originalModel
	if m := extractModel(resp); m != "" {
		actualModel = m
	}
	// Baseline input = what the ORIGINAL (un-optimized) request would have cost.
	baselineInEst := estimateTokens(string(original))
	sentInEst := estimateTokens(string(sent))
	inputSaved := baselineInEst - sentInEst
	if inputSaved < 0 || holdout {
		inputSaved = 0
	}
	// Provider-billed input is exact; if compression shrank input, the baseline
	// is the billed input plus what we saved.
	if inTok == 0 {
		inTok = sentInEst
	}
	cost := pricing.Calculate(actualModel, inTok, outTok)                    // billed (routed) model
	baselineCost := pricing.Calculate(originalModel, inTok+inputSaved, outTok) // requested model + uncompressed input

	optMap := map[string]any{"holdout": holdout}
	for _, o := range opts {
		optMap[o] = true
	}

	evt := &models.UsageEvent{
		ID:                newID(),
		OrgID:             key.OrgID,
		ProjectID:         key.ProjectID,
		Model:             actualModel,
		InputTokens:       inTok,
		OutputTokens:      outTok,
		TotalTokens:       inTok + outTok,
		CostUSD:           cost,
		CreatedAt:         time.Now().UTC(),
		Tags:              map[string]string{"source": "gateway"},
		Metadata:          map[string]any{"gateway": true},
		InputTokensSaved:  inputSaved,
		OutputTokensSaved: 0, // per-request unknowable; measured via holdout in analytics
		BaselineCostUSD:   baselineCost,
		Optimizations:     optMap,
		WasHoldout:        holdout,
	}
	payload, err := json.Marshal(evt)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := s.redis.Publish(ctx, string(payload)); err != nil {
		s.log.Warn("gateway record publish failed", "err", err)
	}

	// Opt-in full-prompt capture for richer analytics (separate, RLS table).
	if s.capture && s.db != nil {
		pc := &db.PromptCapture{
			OrgID: key.OrgID, ProjectID: key.ProjectID,
			Model: actualModel, PromptText: extractPromptText(original), ResponseText: extractResponseText(resp),
			InputTokens: inTok, OutputTokens: outTok, CostUSD: cost,
		}
		if h, ok := optMap["prompt_hash"].(string); ok {
			pc.PromptHash = h
		}
		cctx, ccancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer ccancel()
		if err := s.db.InsertPromptCapture(cctx, pc); err != nil {
			s.log.Warn("prompt capture failed", "err", err)
		}
	}
}

const maxCaptureText = 100_000

// extractPromptText flattens the request into readable prompt text for analytics.
func extractPromptText(original []byte) string {
	var body map[string]any
	if json.Unmarshal(original, &body) != nil {
		return clip(string(original))
	}
	var sb strings.Builder
	switch sys := body["system"].(type) {
	case string:
		sb.WriteString("[system] " + sys + "\n")
	case []any:
		for _, b := range sys {
			if blk, ok := b.(map[string]any); ok {
				if t, ok := blk["text"].(string); ok {
					sb.WriteString("[system] " + t + "\n")
				}
			}
		}
	}
	if msgs, ok := body["messages"].([]any); ok {
		for _, m := range msgs {
			msg, ok := m.(map[string]any)
			if !ok {
				continue
			}
			role, _ := msg["role"].(string)
			switch c := msg["content"].(type) {
			case string:
				sb.WriteString("[" + role + "] " + c + "\n")
			case []any:
				for _, b := range c {
					if blk, ok := b.(map[string]any); ok {
						if t, ok := blk["text"].(string); ok {
							sb.WriteString("[" + role + "] " + t + "\n")
						} else if cs, ok := contentToString(blk["content"]); ok {
							sb.WriteString("[" + role + ":tool] " + cs + "\n")
						}
					}
				}
			}
		}
	}
	return clip(sb.String())
}

// extractResponseText pulls assistant text from anthropic or openai responses.
func extractResponseText(resp []byte) string {
	var body map[string]any
	if json.Unmarshal(resp, &body) != nil {
		return ""
	}
	var sb strings.Builder
	if content, ok := body["content"].([]any); ok { // anthropic
		for _, b := range content {
			if blk, ok := b.(map[string]any); ok {
				if t, ok := blk["text"].(string); ok {
					sb.WriteString(t)
				}
			}
		}
	}
	if choices, ok := body["choices"].([]any); ok { // openai
		for _, ch := range choices {
			if c, ok := ch.(map[string]any); ok {
				if msg, ok := c["message"].(map[string]any); ok {
					if t, ok := msg["content"].(string); ok {
						sb.WriteString(t)
					}
				}
			}
		}
	}
	return clip(sb.String())
}

func clip(s string) string {
	if len(s) > maxCaptureText {
		return s[:maxCaptureText]
	}
	return s
}

// handleCCR runs the buffered path for input-compressed requests: forward,
// resolve any headroom_retrieve tool call inline (one round), return the final
// response. Compression already happened in `parsed`; `original` is the
// uncompressed body (for measuring savings).
func (s *Service) handleCCR(w http.ResponseWriter, r *http.Request, parsed map[string]any, original []byte, url string, apiKey *models.APIKey, originalModel string, opts []string, holdout bool) {
	firstBody, _ := json.Marshal(parsed)

	respMap, raw, status, err := s.forwardJSON(r, url, firstBody)
	if err != nil {
		http.Error(w, "upstream unreachable", http.StatusBadGateway)
		return
	}

	finalRaw := raw
	if status < 300 {
		if calls := parseRetrieveCalls(respMap); len(calls) > 0 {
			// Append the assistant tool_use turn + a user turn with the
			// resolved originals, then ask the provider once more.
			ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
			results := make([]any, 0, len(calls))
			for _, c := range calls {
				orig, _ := s.redis.CCRGet(ctx, c.Hash)
				if orig == "" {
					orig = "[original no longer available]"
				}
				results = append(results, map[string]any{
					"type": "tool_result", "tool_use_id": c.ID, "content": orig,
				})
			}
			cancel()
			msgs, _ := parsed["messages"].([]any)
			msgs = append(msgs,
				map[string]any{"role": "assistant", "content": respMap["content"]},
				map[string]any{"role": "user", "content": results},
			)
			parsed["messages"] = msgs
			secondBody, _ := json.Marshal(parsed)
			if rm2, raw2, st2, err2 := s.forwardJSON(r, url, secondBody); err2 == nil && st2 < 300 {
				respMap, finalRaw, status = rm2, raw2, st2
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(finalRaw)

	if apiKey != nil && status < 300 {
		in, out := parseUsage(finalRaw)
		go s.record(apiKey, originalModel, original, firstBody, finalRaw, in, out, opts, holdout)
	}
	_ = respMap
}

// forwardJSON does a single buffered (non-streaming) provider call.
func (s *Service) forwardJSON(r *http.Request, url string, body []byte) (map[string]any, []byte, int, error) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, nil, 0, err
	}
	for k, vv := range r.Header {
		if hopByHop[http.CanonicalHeaderKey(k)] || k == tokenfinHeader || k == "Content-Length" || k == "Host" {
			continue
		}
		for _, v := range vv {
			req.Header.Add(k, v)
		}
	}
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, nil, 0, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxCaptureBytes))
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	return m, raw, resp.StatusCode, nil
}

// ─── helpers ────────────────────────────────────────────────────────────────

var (
	reStream   = regexp.MustCompile(`"stream"\s*:\s*true`)
	reInTok    = regexp.MustCompile(`"(?:input_tokens|prompt_tokens)"\s*:\s*(\d+)`)
	reOutTok   = regexp.MustCompile(`"(?:output_tokens|completion_tokens)"\s*:\s*(\d+)`)
	reModelStr = regexp.MustCompile(`"model"\s*:\s*"([^"]+)"`)
)

// parseUsage extracts the max input/output token counts seen in the response
// (works for both single JSON bodies and SSE streams, anthropic + openai).
func parseUsage(b []byte) (in, out int) {
	for _, m := range reInTok.FindAllSubmatch(b, -1) {
		if v := atoi(m[1]); v > in {
			in = v
		}
	}
	for _, m := range reOutTok.FindAllSubmatch(b, -1) {
		if v := atoi(m[1]); v > out {
			out = v
		}
	}
	return in, out
}

func isStream(b []byte) bool { return reStream.Match(b) }

func extractModel(b []byte) string {
	if m := reModelStr.FindSubmatch(b); m != nil {
		return string(m[1])
	}
	return ""
}

func atoi(b []byte) int {
	n := 0
	for _, c := range b {
		if c < '0' || c > '9' {
			return n
		}
		n = n*10 + int(c-'0')
	}
	return n
}
