package pricing

import "math"

// modelPrice stores USD cost per 1 million tokens.
type modelPrice struct {
	Input  float64
	Output float64
}

// catalog is the source of truth for model pricing.
// Prices in USD per 1M tokens. Update when providers change rates.
var catalog = map[string]modelPrice{
	// OpenAI
	"gpt-4o":                {Input: 2.50, Output: 10.00},
	"gpt-4o-mini":           {Input: 0.15, Output: 0.60},
	"gpt-4-turbo":           {Input: 10.00, Output: 30.00},
	"gpt-3.5-turbo":         {Input: 0.50, Output: 1.50},
	"o1":                    {Input: 15.00, Output: 60.00},
	"o1-mini":               {Input: 3.00, Output: 12.00},

	// Anthropic
	"claude-opus-4-8":       {Input: 15.00, Output: 75.00},
	"claude-sonnet-4-6":     {Input: 3.00, Output: 15.00},
	"claude-haiku-4-5":      {Input: 0.80, Output: 4.00},

	// Google
	"gemini-1.5-pro":        {Input: 1.25, Output: 5.00},
	"gemini-1.5-flash":      {Input: 0.075, Output: 0.30},
	"gemini-2.0-flash":      {Input: 0.10, Output: 0.40},
}

// defaultPrice is used for unknown models — conservative estimate.
var defaultPrice = modelPrice{Input: 1.00, Output: 3.00}

// Calculate returns the USD cost for given token counts.
// Uses defaultPrice for unknown models so ingest never fails.
func Calculate(model string, inputTokens, outputTokens int) float64 {
	p, ok := catalog[model]
	if !ok {
		p = defaultPrice
	}

	cost := float64(inputTokens)/1_000_000*p.Input +
		float64(outputTokens)/1_000_000*p.Output

	return round8(cost)
}

// IsKnownModel returns true if the model is in the pricing catalog.
func IsKnownModel(model string) bool {
	_, ok := catalog[model]
	return ok
}

// round8 rounds to 8 decimal places — enough precision for micro-costs.
func round8(v float64) float64 {
	return math.Round(v*1e8) / 1e8
}
