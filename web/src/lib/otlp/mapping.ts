/**
 * OTLP → usage_events mapping — the SINGLE versioned source of truth.
 *
 * Vendors rename metrics/attributes without warning (spec §10), so all of it
 * lives here, in one place, and unrecognized names are logged loudly rather
 * than silently dropped. Update this file (not the receivers) when a vendor
 * changes a name, and note the change.
 *
 * MAPPING_VERSION lets `doctor` / logs report which revision is deployed.
 */

export const MAPPING_VERSION = '2026-07-15'

export type TokenField =
  | 'input_tokens' | 'output_tokens'
  | 'cache_read_tokens' | 'cache_write_tokens' | 'reasoning_tokens'

// Metric `type` attribute value → token column. Case/underscore/space-insensitive
// (metrics use camelCase "cacheRead"; events use snake_case — normalized here).
const TOKEN_TYPE: Record<string, TokenField> = {
  input: 'input_tokens',
  output: 'output_tokens',
  cacheread: 'cache_read_tokens',
  cachecreation: 'cache_write_tokens',
  cached: 'cache_read_tokens',       // Codex
  reasoning: 'reasoning_tokens',     // Codex
  prompt: 'input_tokens',            // GenAI semconv
  completion: 'output_tokens',       // GenAI semconv
}
export const tokenFieldFor = (type: unknown): TokenField | null =>
  TOKEN_TYPE[String(type ?? '').toLowerCase().replace(/[_\s-]/g, '')] ?? null

// Recognized token/cost metric names (for /v1/metrics health + doctor).
export const TOKEN_METRIC_SOURCE: Record<string, string> = {
  'claude_code.token.usage': 'claude_code',
  'codex.turn.token_usage': 'codex_cli',
  'gen_ai.client.token.usage': 'gemini_cli',
}
export const COST_METRIC_NAMES = new Set(['claude_code.cost.usage'])

// Metrics we DERIVE per-turn usage rows from — sources that have NO per-turn
// logs path (Codex, Gemini report tokens only as metrics). Claude Code is
// deliberately EXCLUDED: its logs already produce the rows, and its metrics are
// the SAME tokens, so deriving them too would double-count.
export const DERIVE_METRIC_SOURCE: Record<string, string> = {
  'codex.turn.token_usage': 'codex_cli',
  'gen_ai.client.token.usage': 'gemini_cli',
  'gemini_cli.token.usage': 'gemini_cli',
}
export function deriveSourceFor(metricName: string): string | null {
  if (DERIVE_METRIC_SOURCE[metricName]) return DERIVE_METRIC_SOURCE[metricName]
  // GenAI-semconv token metrics from other OTLP agents → treat as gemini-class.
  if (metricName.startsWith('gen_ai.') && metricName.includes('token')) return 'gemini_cli'
  return null
}

export function isRecognizedMetric(name: string): boolean {
  return !!TOKEN_METRIC_SOURCE[name] || COST_METRIC_NAMES.has(name) || name.startsWith('gen_ai.')
}

// Which agent produced this signal — from the resource service.name, with a
// fallback hint (a metric or event name).
export function detectSource(resourceAttrs: Record<string, unknown>, hint?: string): string {
  const s = String(resourceAttrs['service.name'] ?? '').toLowerCase()
  if (s.includes('claude')) return 'claude_code'
  if (s.includes('codex'))  return 'codex_cli'
  if (s.includes('gemini') || s.includes('gen_ai')) return 'gemini_cli'
  const h = (hint ?? '').toLowerCase()
  if (h.includes('claude')) return 'claude_code'
  if (h.includes('codex'))  return 'codex_cli'
  if (h.startsWith('gen_ai') || h.includes('gemini')) return 'gemini_cli'
  return 'otlp'
}

/**
 * cost_basis for a push source. CLI agents report subscription usage priced at
 * API rates — "what it would have cost" — which is notional, NOT a bill, and
 * must never sum into a metered total.
 */
export function costBasisFor(_source: string): 'metered' | 'notional' | 'vendor_reported' {
  return 'notional'
}

// OTLP AggregationTemporality enum: 1 = DELTA, 2 = CUMULATIVE.
export const isDeltaTemporality = (t: unknown): boolean => Number(t) === 1

export function warnUnrecognizedMetric(name: string): void {
  console.warn(`[otlp] unrecognized metric "${name}" — mapping ${MAPPING_VERSION} may be stale; not dropped silently`)
}
