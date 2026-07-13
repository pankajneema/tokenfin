// Price per 1M tokens (input / output) — for savings valuation and usage cost.
const IN_PRICE: Record<string, number> = {
  'claude-opus-4-8': 15, 'claude-sonnet-4-6': 3, 'claude-haiku-4-5': 0.8,
  'gpt-4o': 2.5, 'gpt-4o-mini': 0.15, 'gemini-1.5-pro': 1.25, 'gemini-1.5-flash': 0.075,
}
const OUT_PRICE: Record<string, number> = {
  'claude-opus-4-8': 75, 'claude-sonnet-4-6': 15, 'claude-haiku-4-5': 4,
  'gpt-4o': 10, 'gpt-4o-mini': 0.6, 'gemini-1.5-pro': 5, 'gemini-1.5-flash': 0.3,
}

// Real model ids carry date suffixes (e.g. claude-sonnet-4-6-20250514) — exact
// lookup missed them and everything fell to the $2/$8 default. Prefix-match instead.
const lookup = (table: Record<string, number>, model: string, fallback: number) => {
  if (table[model] != null) return table[model]
  const hit = Object.keys(table).find(k => model.startsWith(k))
  return hit ? table[hit] : fallback
}

export const inputPrice = (model: string) => lookup(IN_PRICE, model, 2)
export const outputPrice = (model: string) => lookup(OUT_PRICE, model, 8)

/** USD cost for a call, from the model's per-1M rates. */
export const computeCost = (model: string, inTok: number, outTok: number) =>
  +((inTok / 1e6) * inputPrice(model) + (outTok / 1e6) * outputPrice(model)).toFixed(8)
