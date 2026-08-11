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

// Metric `type` / `token_type` attribute value → token column.
// Case/underscore/space-insensitive (metrics use camelCase "cacheRead"; events
// use snake_case — normalized here).
const TOKEN_TYPE: Record<string, TokenField> = {
  input: 'input_tokens',
  output: 'output_tokens',
  cacheread: 'cache_read_tokens',
  cachecreation: 'cache_write_tokens',
  cached: 'cache_read_tokens',           // Codex (older builds)
  cachedinput: 'cache_read_tokens',      // Codex real token_type, confirmed on a real session (2026-08-10)
  cachewriteinput: 'cache_write_tokens', // Codex real token_type, confirmed on a real session (2026-08-10)
  reasoning: 'reasoning_tokens',
  reasoningoutput: 'reasoning_tokens',   // Codex real token_type, confirmed on a real session (2026-08-10)
  prompt: 'input_tokens',                // GenAI semconv
  completion: 'output_tokens',           // GenAI semconv
  // "total" is deliberately unmapped — it's input+output+cache+reasoning
  // combined; counting it too would double the token sum.
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

// Operational metrics — observed on real sessions (2026-08-10: `claude -p`,
// `codex exec`). Not token/cost-bearing (nothing to derive), but legitimate
// and expected, so they shouldn't trip the "unrecognized metric" warning on
// every push. Add more here only once confirmed on a real session, not
// speculatively — same discipline as the rest of this file.
export const KNOWN_NON_TOKEN_METRICS = new Set([
  // OpenCode (opencode-otel-plugin 0.11.1) — session/tool housekeeping,
  // none token/cost-bearing; names from the plugin's source.
  'gen_ai.client.operation.duration',
  'opencode.session.request.count', 'opencode.session.compaction.count',
  'opencode.file.changes', 'opencode.tool.invocations', 'opencode.vcs.operations',
  // Claude Code
  'claude_code.session.count',
  'claude_code.active_time.total',
  // Codex CLI (0.147.0) — startup/runtime housekeeping, not usage
  'codex.process.start',
  'codex.sqlite.init.count', 'codex.sqlite.init.duration_ms',
  'codex.remote_models.load_cache.duration_ms', 'codex.remote_models.fetch_update.duration_ms',
  'codex.thread.started',
  'codex.shell_snapshot', 'codex.shell_snapshot.duration_ms',
  'codex.startup.phase.duration_ms',
  'codex.startup_prewarm.duration_ms', 'codex.startup_prewarm.age_at_first_turn_ms',
  'codex.rollout_compression.materialize', 'codex.rollout.size_bytes',
  'codex.mcp.tools.fetch_uncached.duration_ms', 'codex.mcp.tools.cache_write.duration_ms',
  'codex.mcp.tools.cache_publish.duration_ms', 'codex.mcp.tools.list.duration_ms',
  'codex.apps.refresh.duration_ms',
  'codex.websocket.request', 'codex.websocket.request.duration_ms',
  'codex.websocket.event', 'codex.websocket.event.duration_ms',
  'codex.thread.skills.enabled_total', 'codex.thread.skills.kept_total',
  'codex.thread.skills.truncated', 'codex.thread.skills.description_truncated_chars',
  'codex.skills.shadow_selection', 'codex.skills.shadow_selection.duration_ms',
  'codex.skills.shadow_selection.catalog_entries', 'codex.skills.shadow_selection.selected_entries',
  'codex.skills.shadow_selection.query_terms', 'codex.skills.shadow_selection.reduction_bps',
  'codex.turn.ttft.duration_ms', 'codex.turn.ttfm.duration_ms', 'codex.turn.e2e_duration_ms',
  'codex.turn.network_proxy', 'codex.turn.tool.call', 'codex.turn.memory',
  'codex.conversation.turn.count',
  'codex.responses_api_overhead.duration_ms', 'codex.responses_api_inference_time.duration_ms',
  'codex.responses_api_engine_iapi_ttft.duration_ms', 'codex.responses_api_engine_service_ttft.duration_ms',
  'codex.responses_api_engine_iapi_tbt.duration_ms', 'codex.responses_api_engine_service_tbt.duration_ms',
])

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
    || KNOWN_NON_TOKEN_METRICS.has(name)
}

// Which agent produced this signal — from the resource service.name, with a
// fallback hint (a metric or event name).
export function detectSource(resourceAttrs: Record<string, unknown>, hint?: string): string {
  const s = String(resourceAttrs['service.name'] ?? '').toLowerCase()
  if (s.includes('claude')) return 'claude_code'
  if (s.includes('codex'))  return 'codex_cli'
  if (s.includes('opencode')) return 'opencode'
  if (s.includes('gemini') || s.includes('gen_ai')) return 'gemini_cli'
  const h = (hint ?? '').toLowerCase()
  if (h.includes('claude')) return 'claude_code'
  if (h.includes('codex'))  return 'codex_cli'
  if (h.includes('opencode')) return 'opencode'
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
