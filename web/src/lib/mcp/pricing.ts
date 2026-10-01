// Single source of model pricing (USD per 1M tokens) for every cost TokenFin
// computes: SDK ingest, OTLP logs/metrics/traces, prompt analytics, savings.
// Anthropic rates are first-party API list prices (2026-09). Cache reads bill
// at 0.1x input unless listed (Fable 5.1 / Mythos 5.1: 0.025x, Opus 5.5 and
// Sonnet 5.5: $0.20). Cache writes default to the 5-minute rate (1.25x input);
// 1-hour writes bill 2x, which is why Claude Code / Cowork rows use the cost
// those clients report (they know the TTL split) — see otlp/normalize.ts.
export type Price = { in: number; out: number; cacheRead?: number; cacheWrite?: number }

export const PRICES: Readonly<Record<string, Price>> = {
  // Anthropic
  'claude-fable-5-1':  { in: 10,   out: 50, cacheRead: 0.25 },
  'claude-fable-5':    { in: 10,   out: 50 },
  'claude-mythos-5-1': { in: 10,   out: 50, cacheRead: 0.25 },
  'claude-mythos-5':   { in: 10,   out: 50 },
  'claude-opus-5-5':   { in: 4,    out: 20, cacheRead: 0.20 },
  'claude-opus-5':     { in: 5,    out: 25 },
  'claude-opus-4-8':   { in: 5,    out: 25 },
  'claude-opus-4-7':   { in: 5,    out: 25 },
  'claude-opus-4-6':   { in: 5,    out: 25 },
  'claude-sonnet-5-5': { in: 2,    out: 10, cacheRead: 0.20 },
  'claude-sonnet-5':   { in: 2,    out: 10 },
  'claude-sonnet-4-6': { in: 3,    out: 15 },
  'claude-haiku-4-5':  { in: 1,    out: 5 },
  // OpenAI (developers.openai.com/api/docs/pricing, standard tier, Sep 2026)
  'gpt-5.6-sol':       { in: 4,    out: 20,  cacheRead: 0.40 },
  'gpt-5.6-terra':     { in: 2,    out: 12,  cacheRead: 0.20 },
  'gpt-5.6-luna':      { in: 0.20, out: 1.20, cacheRead: 0.02 },
  'gpt-5.5-pro':       { in: 30,   out: 180 },
  'gpt-5.5':           { in: 5,    out: 30,  cacheRead: 0.50 },
  'gpt-5.4-pro':       { in: 30,   out: 180 },
  'gpt-5.4-mini':      { in: 0.75, out: 4.50, cacheRead: 0.075 },
  'gpt-5.4-nano':      { in: 0.20, out: 1.25, cacheRead: 0.02 },
  'gpt-5.4':           { in: 2.50, out: 15,  cacheRead: 0.25 },
  'gpt-5.3-codex':     { in: 1.75, out: 14,  cacheRead: 0.175 },
  'gpt-5.2-pro':       { in: 21,   out: 168 },
  'gpt-5.2':           { in: 1.75, out: 14,  cacheRead: 0.175 },
  'gpt-5.1':           { in: 1.25, out: 10,  cacheRead: 0.125 },
  'gpt-5-pro':         { in: 15,   out: 120 },
  'gpt-5-mini':        { in: 0.25, out: 2,   cacheRead: 0.025 },
  'gpt-5-nano':        { in: 0.05, out: 0.40, cacheRead: 0.005 },
  'gpt-5':             { in: 1.25, out: 10,  cacheRead: 0.125 },
  'gpt-4.1-mini':      { in: 0.40, out: 1.60, cacheRead: 0.10 },
  'gpt-4.1-nano':      { in: 0.10, out: 0.40, cacheRead: 0.025 },
  'gpt-4.1':           { in: 2,    out: 8,   cacheRead: 0.50 },
  'o4-mini':           { in: 1.10, out: 4.40, cacheRead: 0.275 },
  'o3-mini':           { in: 1.10, out: 4.40, cacheRead: 0.55 },
  'o3':                { in: 2,    out: 8,   cacheRead: 0.50 },
  'gpt-4o-mini':       { in: 0.15, out: 0.60 },
  'gpt-4o':            { in: 2.50, out: 10 },
  'gpt-4-turbo':       { in: 10,   out: 30 },
  'gpt-3.5-turbo':     { in: 0.50, out: 1.50 },
  // Google (ai.google.dev/gemini-api/docs/pricing, paid tier, ≤200k prompt, Sep 2026)
  'gemini-3.8-flash':      { in: 0.75, out: 3.75, cacheRead: 0.075 },
  'gemini-3.7-flash':      { in: 0.75, out: 3.75, cacheRead: 0.075 },
  'gemini-3.6-flash':      { in: 0.75, out: 3.75, cacheRead: 0.075 },
  'gemini-3.5-flash-lite': { in: 0.30, out: 2.50, cacheRead: 0.03 },
  'gemini-3.5-flash':      { in: 1.50, out: 9,    cacheRead: 0.15 },
  'gemini-3.1-flash-lite': { in: 0.25, out: 1.50, cacheRead: 0.025 },
  'gemini-3.1-pro':        { in: 2,    out: 12,   cacheRead: 0.20 },
  'gemini-2.5-flash-lite': { in: 0.10, out: 0.40, cacheRead: 0.01 },
  'gemini-2.5-flash':      { in: 0.30, out: 2.50, cacheRead: 0.03 },
  'gemini-2.5-pro':        { in: 1.25, out: 10,   cacheRead: 0.125 },
  'gemini-1.5-pro':    { in: 1.25, out: 5 },
  'gemini-1.5-flash':  { in: 0.075, out: 0.30 },
}

const DEFAULT: Price = { in: 2, out: 8 }

// Longest matching prefix wins, so dated ids (claude-sonnet-4-6-20250514,
// gpt-4o-mini-2024-07-18) price as their family and gpt-4o-mini never
// matches gpt-4o.
const KEYS_LONGEST_FIRST = Object.keys(PRICES).sort((a, b) => b.length - a.length)

export function priceFor(model: string): Price & { known: boolean } {
  const m = (model ?? '').toLowerCase()
  const exact = PRICES[m]
  if (exact) return { ...exact, known: true }
  const hit = KEYS_LONGEST_FIRST.find(k => m.startsWith(k))
  return hit ? { ...PRICES[hit], known: true } : { ...DEFAULT, known: false }
}

export const inputPrice  = (model: string) => priceFor(model).in
export const outputPrice = (model: string) => priceFor(model).out

/** USD cost for a call. Cache tokens are optional and priced at their own rates. */
export function computeCost(model: string, inTok: number, outTok: number, cacheReadTok = 0, cacheWriteTok = 0): number {
  return costFromPrice(priceFor(model), inTok, outTok, cacheReadTok, cacheWriteTok)
}

/** USD cost for a call at an explicit price (used by per-org overrides). */
export function costFromPrice(p: Price, inTok: number, outTok: number, cacheReadTok = 0, cacheWriteTok = 0): number {
  const cacheRead  = p.cacheRead  ?? p.in * 0.1
  const cacheWrite = p.cacheWrite ?? p.in * 1.25
  return +((inTok * p.in + outTok * p.out + cacheReadTok * cacheRead + cacheWriteTok * cacheWrite) / 1e6).toFixed(8)
}

/** A client-reported cost further than this factor from our price is ignored. */
export const CLIENT_COST_TOLERANCE = 10

/**
 * The cost to store for an SDK-reported call. Clients can't be trusted to
 * price their own usage (a budget could be dodged by under-reporting), so:
 *  - known model (list price or org override) → always the server price;
 *  - unknown model → the client's figure only when it is within 10x of our
 *    fallback estimate, else the estimate.
 * The client's figure is still returned so it can be kept as vendor_cost_usd.
 */
export function reconcileClientCost(serverCost: number, priceKnown: boolean, clientCost: unknown): { cost: number; usedClient: boolean; client: number | null } {
  const c = typeof clientCost === 'number' ? clientCost : typeof clientCost === 'string' && clientCost.trim() !== '' ? Number(clientCost) : NaN
  const client = Number.isFinite(c) && c >= 0 ? +c.toFixed(8) : null
  if (priceKnown || client == null) return { cost: serverCost, usedClient: false, client }
  const lo = serverCost / CLIENT_COST_TOLERANCE
  const hi = serverCost * CLIENT_COST_TOLERANCE
  return client >= lo && client <= hi ? { cost: client, usedClient: true, client } : { cost: serverCost, usedClient: false, client }
}
