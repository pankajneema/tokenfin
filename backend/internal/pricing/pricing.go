package pricing

import (
	"math"
	"sort"
	"strings"
)

// modelPrice stores USD cost per 1 million tokens.
// CacheRead / CacheWrite are optional overrides; zero means "derive from Input"
// (cache reads bill at 0.1x input, 5-minute cache writes at 1.25x input).
type modelPrice struct {
	Input      float64
	Output     float64
	CacheRead  float64
	CacheWrite float64
}

// catalog mirrors web/src/lib/mcp/pricing.ts — keep the two tables in sync.
// Prices in USD per 1M tokens.
var catalog = map[string]modelPrice{
	// Anthropic
	"claude-fable-5-1":  {Input: 10, Output: 50, CacheRead: 0.25},
	"claude-fable-5":    {Input: 10, Output: 50},
	"claude-mythos-5-1": {Input: 10, Output: 50},
	"claude-opus-5-5":   {Input: 4, Output: 20, CacheRead: 0.20},
	"claude-opus-5":     {Input: 5, Output: 25},
	"claude-opus-4-8":   {Input: 5, Output: 25},
	"claude-opus-4-7":   {Input: 5, Output: 25},
	"claude-opus-4-6":   {Input: 5, Output: 25},
	"claude-sonnet-5":   {Input: 2, Output: 10},
	"claude-sonnet-4-6": {Input: 3, Output: 15},
	"claude-haiku-4-5":  {Input: 1, Output: 5},

	// OpenAI (developers.openai.com/api/docs/pricing, standard tier, Sep 2026)
	"gpt-5.6-sol":   {Input: 4, Output: 20, CacheRead: 0.40},
	"gpt-5.6-terra": {Input: 2, Output: 12, CacheRead: 0.20},
	"gpt-5.6-luna":  {Input: 0.20, Output: 1.20, CacheRead: 0.02},
	"gpt-5.5-pro":   {Input: 30, Output: 180},
	"gpt-5.5":       {Input: 5, Output: 30, CacheRead: 0.50},
	"gpt-5.4-pro":   {Input: 30, Output: 180},
	"gpt-5.4-mini":  {Input: 0.75, Output: 4.50, CacheRead: 0.075},
	"gpt-5.4-nano":  {Input: 0.20, Output: 1.25, CacheRead: 0.02},
	"gpt-5.4":       {Input: 2.50, Output: 15, CacheRead: 0.25},
	"gpt-5.3-codex": {Input: 1.75, Output: 14, CacheRead: 0.175},
	"gpt-5.2-pro":   {Input: 21, Output: 168},
	"gpt-5.2":       {Input: 1.75, Output: 14, CacheRead: 0.175},
	"gpt-5.1":       {Input: 1.25, Output: 10, CacheRead: 0.125},
	"gpt-5-pro":     {Input: 15, Output: 120},
	"gpt-5-mini":    {Input: 0.25, Output: 2, CacheRead: 0.025},
	"gpt-5-nano":    {Input: 0.05, Output: 0.40, CacheRead: 0.005},
	"gpt-5":         {Input: 1.25, Output: 10, CacheRead: 0.125},
	"gpt-4.1-mini":  {Input: 0.40, Output: 1.60, CacheRead: 0.10},
	"gpt-4.1-nano":  {Input: 0.10, Output: 0.40, CacheRead: 0.025},
	"gpt-4.1":       {Input: 2, Output: 8, CacheRead: 0.50},
	"o4-mini":       {Input: 1.10, Output: 4.40, CacheRead: 0.275},
	"o3-mini":       {Input: 1.10, Output: 4.40, CacheRead: 0.55},
	"o3":            {Input: 2, Output: 8, CacheRead: 0.50},
	"gpt-4o-mini":   {Input: 0.15, Output: 0.60},
	"gpt-4o":        {Input: 2.50, Output: 10},
	"gpt-4-turbo":   {Input: 10, Output: 30},
	"gpt-3.5-turbo": {Input: 0.50, Output: 1.50},

	// Google (ai.google.dev/gemini-api/docs/pricing, paid tier, ≤200k prompt, Sep 2026)
	"gemini-3.8-flash":      {Input: 0.75, Output: 3.75, CacheRead: 0.075},
	"gemini-3.7-flash":      {Input: 0.75, Output: 3.75, CacheRead: 0.075},
	"gemini-3.6-flash":      {Input: 0.75, Output: 3.75, CacheRead: 0.075},
	"gemini-3.5-flash-lite": {Input: 0.30, Output: 2.50, CacheRead: 0.03},
	"gemini-3.5-flash":      {Input: 1.50, Output: 9, CacheRead: 0.15},
	"gemini-3.1-flash-lite": {Input: 0.25, Output: 1.50, CacheRead: 0.025},
	"gemini-3.1-pro":        {Input: 2, Output: 12, CacheRead: 0.20},
	"gemini-2.5-flash-lite": {Input: 0.10, Output: 0.40, CacheRead: 0.01},
	"gemini-2.5-flash":      {Input: 0.30, Output: 2.50, CacheRead: 0.03},
	"gemini-2.5-pro":        {Input: 1.25, Output: 10, CacheRead: 0.125},
	"gemini-1.5-pro":        {Input: 1.25, Output: 5},
	"gemini-1.5-flash":      {Input: 0.075, Output: 0.30},
}

// defaultPrice is used for unknown models.
var defaultPrice = modelPrice{Input: 2, Output: 8}

// keysLongestFirst lets lookup pick the longest matching prefix, so dated ids
// (claude-sonnet-4-6-20250514, gpt-4o-mini-2024-07-18) price as their family
// and gpt-4o-mini never matches gpt-4o.
var keysLongestFirst = func() []string {
	keys := make([]string, 0, len(catalog))
	for k := range catalog {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if len(keys[i]) != len(keys[j]) {
			return len(keys[i]) > len(keys[j])
		}
		return keys[i] < keys[j]
	})
	return keys
}()

// lookup resolves a model id to its price (exact match, then longest prefix).
func lookup(model string) (modelPrice, bool) {
	m := strings.ToLower(strings.TrimSpace(model))
	if p, ok := catalog[m]; ok {
		return p, true
	}
	for _, k := range keysLongestFirst {
		if strings.HasPrefix(m, k) {
			return catalog[k], true
		}
	}
	return defaultPrice, false
}

// Calculate returns the USD cost for given token counts.
// Uses defaultPrice for unknown models so ingest never fails.
func Calculate(model string, inputTokens, outputTokens int) float64 {
	return CalculateWithCache(model, inputTokens, outputTokens, 0, 0)
}

// CalculateWithCache is Calculate plus prompt-cache read/write tokens.
func CalculateWithCache(model string, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens int) float64 {
	p, _ := lookup(model)
	cacheRead := p.CacheRead
	if cacheRead == 0 {
		cacheRead = p.Input * 0.1
	}
	cacheWrite := p.CacheWrite
	if cacheWrite == 0 {
		cacheWrite = p.Input * 1.25
	}

	cost := (float64(inputTokens)*p.Input +
		float64(outputTokens)*p.Output +
		float64(cacheReadTokens)*cacheRead +
		float64(cacheWriteTokens)*cacheWrite) / 1_000_000

	return round8(cost)
}

// IsKnownModel returns true if the model resolves to a catalog entry.
func IsKnownModel(model string) bool {
	_, ok := lookup(model)
	return ok
}

// round8 rounds to 8 decimal places — enough precision for micro-costs.
func round8(v float64) float64 {
	return math.Round(v*1e8) / 1e8
}
