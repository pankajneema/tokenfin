package gateway

// Heuristic token estimator. Used ONLY for baseline estimation (what the
// original, un-optimized request would have cost). Actual billed tokens always
// come from the provider's response usage; this is just for the counterfactual.
// ~4 chars per token is the standard rough heuristic for English/code.

func estimateTokens(s string) int {
	if s == "" {
		return 0
	}
	n := len([]rune(s)) / 4
	if n < 1 {
		n = 1
	}
	return n
}
