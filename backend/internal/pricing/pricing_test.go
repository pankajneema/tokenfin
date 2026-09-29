package pricing

import (
	"math"
	"testing"
)

func approx(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

func TestLongestPrefixMatch(t *testing.T) {
	cases := []struct {
		model   string
		in, out float64
		known   bool
	}{
		{"gpt-4o", 2.50, 10, true},
		{"gpt-4o-mini", 0.15, 0.60, true},
		{"gpt-4o-mini-2024-07-18", 0.15, 0.60, true}, // must not match gpt-4o
		{"gpt-4o-2024-08-06", 2.50, 10, true},
		{"claude-sonnet-4-6-20250514", 3, 15, true},
		{"CLAUDE-OPUS-5-5", 4, 20, true},
		{"claude-opus-5-20260101", 5, 25, true},
		{"claude-fable-5-1", 10, 50, true},
		{"gpt-5.4-mini-2026", 0.75, 4.50, true}, // must not match gpt-5.4 or gpt-5
		{"gemini-3.1-pro-preview", 2, 12, true},
		{"o3-mini", 1.10, 4.40, true}, // must not match o3
		{"some-unknown-model", 2, 8, false},
	}
	for _, c := range cases {
		p, ok := lookup(c.model)
		if ok != c.known || !approx(p.Input, c.in) || !approx(p.Output, c.out) {
			t.Errorf("lookup(%q) = %+v known=%v; want in=%v out=%v known=%v", c.model, p, ok, c.in, c.out, c.known)
		}
	}
}

func TestCalculate(t *testing.T) {
	// 1M in + 1M out on the default price = $2 + $8
	if got := Calculate("unknown", 1_000_000, 1_000_000); !approx(got, 10) {
		t.Errorf("default cost = %v, want 10", got)
	}
	// Derived cache rates: read 0.1x, write 1.25x input.
	if got := CalculateWithCache("claude-sonnet-4-6", 0, 0, 1_000_000, 1_000_000); !approx(got, 0.3+3.75) {
		t.Errorf("sonnet cache cost = %v, want 4.05", got)
	}
	// Overrides.
	if got := CalculateWithCache("claude-fable-5-1", 0, 0, 1_000_000, 0); !approx(got, 0.25) {
		t.Errorf("fable-5-1 cache read = %v, want 0.25", got)
	}
	if got := CalculateWithCache("claude-opus-5-5-20260901", 0, 0, 1_000_000, 0); !approx(got, 0.20) {
		t.Errorf("opus-5-5 cache read = %v, want 0.20", got)
	}
	if got := CalculateWithCache("o3-mini", 0, 0, 1_000_000, 0); !approx(got, 0.55) {
		t.Errorf("o3-mini cache read = %v, want 0.55", got)
	}
}
