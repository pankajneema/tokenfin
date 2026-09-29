/**
 * OTLP span → GenAI usage mapping — the SINGLE versioned source of truth for
 * the trace receiver (/api/otel/v1/traces).
 *
 * Recognizes three attribute dialects, first match wins (order below):
 *   1. OpenTelemetry GenAI semantic conventions (gen_ai.*)
 *   2. OpenLLMetry / Traceloop (gen_ai.* legacy names, llm.usage.*, traceloop.*)
 *   3. OpenInference / Arize Phoenix (llm.token_count.*, llm.model_name, …)
 *
 * Token semantics — everything is normalized to the TokenFin shape:
 *   input_tokens = UNCACHED input, cache_read / cache_write separate,
 *   total        = input + output + cache_read + cache_write.
 * The GenAI semconv (and OpenInference) report input INCLUDING cached tokens,
 * so cached tokens are subtracted when they fit inside the reported input. When
 * the cache tokens exceed it the instrumentation copied Anthropic's raw usage
 * (input excludes cache) and input is taken as already uncached.
 *
 * Prompt / completion content attributes are dropped when the org has prompt
 * capture off, and redacted (lib/redact.ts) when on. Every other string
 * attribute is redacted too. Update this file (not the route) when a vendor
 * renames something, and bump GENAI_MAPPING_VERSION.
 */
import { redact } from '@/lib/redact'

export const GENAI_MAPPING_VERSION = '2026-09-29'

// ── attribute keys (priority order) ─────────────────────────────────────────
export const GENAI_KEYS = {
  model: ['gen_ai.response.model', 'gen_ai.request.model', 'llm.response.model', 'llm.request.model', 'llm.model_name', 'embedding.model_name'],
  provider: ['gen_ai.provider.name', 'gen_ai.system', 'llm.provider', 'llm.system', 'llm.vendor'],
  operation: ['gen_ai.operation.name', 'llm.request.type', 'openinference.span.kind', 'traceloop.span.kind'],
  input: ['gen_ai.usage.input_tokens', 'gen_ai.usage.prompt_tokens', 'llm.usage.prompt_tokens', 'llm.token_count.prompt'],
  output: ['gen_ai.usage.output_tokens', 'gen_ai.usage.completion_tokens', 'llm.usage.completion_tokens', 'llm.token_count.completion'],
  total: ['gen_ai.usage.total_tokens', 'llm.usage.total_tokens', 'llm.token_count.total'],
  cacheRead: [
    'gen_ai.usage.cache_read.input_tokens', 'gen_ai.usage.cache_read_input_tokens', 'gen_ai.usage.cache_read_tokens',
    'llm.usage.cache_read_input_tokens', 'llm.token_count.prompt_details.cache_read',
  ],
  cacheWrite: [
    'gen_ai.usage.cache_creation.input_tokens', 'gen_ai.usage.cache_creation_input_tokens', 'gen_ai.usage.cache_write_tokens',
    'llm.usage.cache_creation_input_tokens', 'llm.token_count.prompt_details.cache_write',
  ],
  reasoning: ['gen_ai.usage.reasoning.output_tokens', 'gen_ai.usage.reasoning_tokens', 'llm.usage.reasoning_tokens', 'llm.token_count.completion_details.reasoning'],
  session: [
    'gen_ai.conversation.id', 'session.id', 'traceloop.association.properties.session_id',
    'traceloop.association.properties.conversation_id', 'langfuse.session.id',
  ],
  user: [
    'user.email', 'user_email', 'enduser.id', 'user.id', 'traceloop.association.properties.user_id',
    'traceloop.association.properties.user_email', 'langfuse.user.id',
  ],
} as const

/**
 * Prompt / completion CONTENT — dropped when prompt capture is off. Matches
 * semconv (gen_ai.input.messages …), OpenLLMetry (gen_ai.prompt.0.content,
 * traceloop.entity.input) and OpenInference (input.value, llm.input_messages.*).
 */
const CONTENT_KEY = new RegExp([
  '^gen_ai\\.(prompt|completion)(\\..*)?$',
  '^gen_ai\\.(input|output)\\.messages$',
  '^gen_ai\\.system_instructions$',
  '^gen_ai\\.tool\\.call\\.(arguments|result)$',
  '^gen_ai\\.(choice|content)(\\..*)?$',
  '^llm\\.(prompts|completions)(\\..*)?$',
  '^llm\\.(input|output)_messages(\\..*)?$',
  '^llm\\.prompt_template\\.variables$',
  '^(input|output)\\.value$',
  '^traceloop\\.entity\\.(input|output)$',
  '^retrieval\\.documents(\\..*)?$',
  '^reranker\\.(input|output)_documents(\\..*)?$',
  '^embedding\\.embeddings(\\..*)?$',
  '^exception\\.stacktrace$',
].join('|'))
export const isContentKey = (key: string): boolean => CONTENT_KEY.test(key)

const MAX_ATTRS = 256
const MAX_STRING = 4096

// ── OTLP value helpers (arrays / kvlists too) ────────────────────────────────
export function anyValue(v: any): unknown {
  if (v == null || typeof v !== 'object') return v ?? undefined
  if (v.stringValue !== undefined) return v.stringValue
  if (v.intValue !== undefined) return Number(v.intValue)
  if (v.doubleValue !== undefined) return Number(v.doubleValue)
  if (v.boolValue !== undefined) return v.boolValue
  if (v.bytesValue !== undefined) return String(v.bytesValue)
  if (v.arrayValue !== undefined) return (v.arrayValue?.values ?? []).map(anyValue)
  if (v.kvlistValue !== undefined) return flattenAttrs(v.kvlistValue?.values ?? [])
  return undefined
}

/** [{key,value}] → { key: value } (arrays and kvlists kept structured). */
export function flattenAttrs(arr: any[] | undefined | null): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const a of arr ?? []) if (a && typeof a.key === 'string') out[a.key] = anyValue(a.value)
  return out
}

const first = (a: Record<string, unknown>, keys: readonly string[]): unknown => {
  for (const k of keys) {
    const v = a[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}
const firstStr = (a: Record<string, unknown>, keys: readonly string[]): string | null => {
  const v = first(a, keys)
  return v === undefined ? null : String(v).trim() || null
}
const firstNum = (a: Record<string, unknown>, keys: readonly string[]): number => {
  const n = Number(first(a, keys) ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

// ── ids / enums / time ───────────────────────────────────────────────────────
/**
 * Trace / span id → lowercase hex. OTLP/JSON carries hex; protobuf bytes decode
 * to base64 — both must land on the same id or JSON and protobuf exports of one
 * trace would split. All-zero / empty ids (no parent) → null.
 */
export function normalizeId(v: unknown, bytes: 16 | 8): string | null {
  if (v == null) return null
  let hex: string
  if (v instanceof Uint8Array) hex = Buffer.from(v).toString('hex')
  else {
    const s = String(v).trim()
    if (!s) return null
    if (new RegExp(`^[0-9a-fA-F]{${bytes * 2}}$`).test(s)) hex = s.toLowerCase()
    else {
      const buf = /^[A-Za-z0-9+/_-]+={0,2}$/.test(s) ? Buffer.from(s, 'base64') : null
      hex = buf && buf.length === bytes ? buf.toString('hex') : s.slice(0, 64)
    }
  }
  return /^0+$/.test(hex) ? null : hex
}

const KIND_NAMES = ['UNSPECIFIED', 'INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER']
export function spanKindOf(v: unknown): number {
  if (typeof v === 'number') return v >= 0 && v <= 5 ? v : 0
  const s = String(v ?? '').toUpperCase().replace(/^SPAN_KIND_/, '')
  const i = KIND_NAMES.indexOf(s)
  return i < 0 ? (Number.isFinite(Number(v)) ? spanKindOf(Number(v)) : 0) : i
}
export const SPAN_KIND_LABEL = KIND_NAMES.map(k => k.toLowerCase())

/** OTLP status code → 0 unset · 1 ok · 2 error (number or enum string). */
export function statusCodeOf(v: unknown): 0 | 1 | 2 {
  if (v == null) return 0
  const s = String(v).toUpperCase()
  if (s === '2' || s.endsWith('ERROR')) return 2
  if (s === '1' || s.endsWith('OK')) return 1
  return 0
}

/** Nanos (string | number) → ms, precise for 19-digit strings. */
export function nanosToMs(n: unknown): number | null {
  if (n == null || n === '' || n === 0 || n === '0') return null
  try {
    const big = BigInt(typeof n === 'number' ? Math.round(n) : String(n))
    if (big <= BigInt(0)) return null
    return Number(big / BigInt(1000)) / 1000
  } catch { return null }
}

// ── attributes: redaction + prompt-capture ──────────────────────────────────
function cleanValue(v: unknown): unknown {
  if (typeof v === 'string') {
    const r = redact(v)
    return r.length > MAX_STRING ? `${r.slice(0, MAX_STRING)}…[truncated]` : r
  }
  if (Array.isArray(v) || (v && typeof v === 'object')) {
    let json = JSON.stringify(v)
    if (json.length > MAX_STRING) return `${redact(json.slice(0, MAX_STRING))}…[truncated]`
    json = redact(json)
    try { return JSON.parse(json) } catch { return json }
  }
  return v
}

/**
 * The attributes we persist: content keys dropped unless `capture`, every
 * string redacted and capped, at most MAX_ATTRS keys.
 */
export function sanitizeAttributes(a: Record<string, unknown>, capture: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let n = 0
  for (const [k, v] of Object.entries(a)) {
    if (v === undefined) continue
    if (!capture && isContentKey(k)) continue
    if (++n > MAX_ATTRS) { out['tokenfin.attributes_truncated'] = true; break }
    out[k] = cleanValue(v)
  }
  return out
}

// ── the mapping ─────────────────────────────────────────────────────────────
export interface GenAiUsage {
  model: string | null
  provider: string | null
  operation: string | null
  /** Uncached input. */
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  /** input + output + cacheRead + cacheWrite. */
  total: number
  sessionId: string | null
  userKey: string | null
  userEmail: string | null
}

/** Read GenAI usage from span attributes (+ resource attributes for identity). */
export function genAiUsage(a: Record<string, unknown>, res: Record<string, unknown> = {}): GenAiUsage {
  const ident = { ...res, ...a }
  const model = firstStr(a, GENAI_KEYS.model)
  const provider = firstStr(a, GENAI_KEYS.provider)?.toLowerCase() ?? null
  const operation = firstStr(a, GENAI_KEYS.operation)?.toLowerCase() ?? null
  let input = firstNum(a, GENAI_KEYS.input)
  const output = firstNum(a, GENAI_KEYS.output)
  const reported = firstNum(a, GENAI_KEYS.total)
  // Only a total was reported (some OpenInference embedders): price it as input.
  if (!input && !output && reported) input = reported
  const cacheRead = firstNum(a, GENAI_KEYS.cacheRead)
  const cacheWrite = firstNum(a, GENAI_KEYS.cacheWrite)
  const cached = cacheRead + cacheWrite
  if (cached > 0 && cached <= input) input -= cached
  const reasoning = firstNum(a, GENAI_KEYS.reasoning)
  const userKey = firstStr(ident, GENAI_KEYS.user)
  return {
    model, provider, operation, input, output, cacheRead, cacheWrite, reasoning,
    total: input + output + cacheRead + cacheWrite,
    sessionId: firstStr(ident, GENAI_KEYS.session),
    userKey,
    userEmail: userKey && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(userKey) ? userKey.toLowerCase() : null,
  }
}

/**
 * The CLI agent that produced a span ('otlp' = a generic app). Claude Code's
 * usage is owned by its OTLP logs, Codex / Gemini CLI / OpenCode's by their
 * metrics (lib/otlp/metrics.ts) — their spans are stored but never mirrored.
 */
const AGENT_SERVICE: Array<[RegExp, string]> = [
  [/^claude[-_ ]?code/i, 'claude_code'],
  [/^codex/i, 'codex_cli'],               // codex_cli_rs, codex-cli, codex_exec
  [/^gemini[-_ ]?cli/i, 'gemini_cli'],
  [/^opencode/i, 'opencode'],
  [/^cowork$/i, 'cowork'],                // its logs own usage; spans (3P deployments) are not mirrored
]
// Stricter than mapping.ts detectSource (which matches any service containing
// "claude"): an app named "claude-support-bot" is a generic app whose spans
// must still be mirrored.
export function agentSourceOf(res: Record<string, unknown>): string {
  const svc = String(res['service.name'] ?? '').trim()
  for (const [re, src] of AGENT_SERVICE) if (re.test(svc)) return src
  return 'otlp'
}

export interface ParsedSpan {
  traceId: string
  spanId: string
  parentSpanId: string | null
  name: string
  spanKind: number
  service: string | null
  statusCode: 0 | 1 | 2
  statusMessage: string | null
  startIso: string | null
  endIso: string | null
  durationMs: number | null
  /** 'otlp' for a generic app; else the CLI agent whose logs/metrics own usage. */
  source: string
  usage: GenAiUsage
  attributes: Record<string, unknown>
}

export interface ParseOpts { capturePrompts: boolean }

/** One OTLP span (JSON or decoded protobuf shape) → ParsedSpan, or null if unusable. */
export function parseSpan(sp: any, res: Record<string, unknown>, scope: any, opts: ParseOpts): ParsedSpan | null {
  const traceId = normalizeId(sp?.traceId, 16)
  const spanId = normalizeId(sp?.spanId, 8)
  if (!traceId || !spanId) return null
  const raw = flattenAttrs(sp.attributes)
  const usage = genAiUsage(raw, res)

  const status = sp.status ?? {}
  let statusCode = statusCodeOf(status.code)
  let statusMessage: string | null = status.message ? String(status.message) : null
  const exception = (sp.events ?? []).find((e: any) => e?.name === 'exception')
  if (exception) {
    const ea = flattenAttrs(exception.attributes)
    const msg = [ea['exception.type'], ea['exception.message']].filter(Boolean).join(': ')
    if (!statusMessage && msg) statusMessage = msg
  }
  if (statusCode === 0 && raw['error.type']) statusCode = 2
  if (statusCode === 2 && !statusMessage && raw['error.type']) statusMessage = String(raw['error.type'])

  const startMs = nanosToMs(sp.startTimeUnixNano)
  const endMs = nanosToMs(sp.endTimeUnixNano)
  const keep: Record<string, unknown> = { ...raw }
  for (const k of ['service.name', 'service.version', 'deployment.environment', 'deployment.environment.name']) {
    if (res[k] !== undefined && keep[k] === undefined) keep[k] = res[k]
  }
  if (scope?.name) keep['otel.scope.name'] = scope.name
  if (scope?.version) keep['otel.scope.version'] = scope.version

  return {
    traceId, spanId,
    parentSpanId: normalizeId(sp.parentSpanId, 8),
    name: String(sp.name ?? usage.operation ?? 'span').slice(0, 500),
    spanKind: spanKindOf(sp.kind),
    service: res['service.name'] ? String(res['service.name']).slice(0, 200) : null,
    statusCode,
    statusMessage: statusMessage ? redact(statusMessage).slice(0, 1000) : null,
    startIso: startMs != null ? new Date(startMs).toISOString() : null,
    endIso: endMs != null ? new Date(endMs).toISOString() : null,
    durationMs: startMs != null && endMs != null ? Math.max(0, +(endMs - startMs).toFixed(3)) : null,
    source: agentSourceOf(res),
    usage,
    attributes: sanitizeAttributes(keep, opts.capturePrompts),
  }
}

/** Every span of an ExportTraceServiceRequest body. */
export function parseTraceRequest(body: any, opts: ParseOpts): ParsedSpan[] {
  const out: ParsedSpan[] = []
  for (const rs of body?.resourceSpans ?? []) {
    const res = flattenAttrs(rs?.resource?.attributes)
    for (const ss of rs?.scopeSpans ?? rs?.instrumentationLibrarySpans ?? []) {
      const scope = ss?.scope ?? ss?.instrumentationLibrary
      for (const sp of ss?.spans ?? []) {
        const p = parseSpan(sp, res, scope, opts)
        if (p) out.push(p)
      }
    }
  }
  return inheritIdentity(out)
}

/**
 * User and session attributes usually sit on the root / agent span only (or
 * on every span with OpenLLMetry association properties). A span without them
 * inherits the nearest ancestor's from the same export, so its LLM calls are
 * attributed too. Ancestors exported in a later batch can't be seen here.
 */
export function inheritIdentity(spans: ParsedSpan[]): ParsedSpan[] {
  const byKey = new Map(spans.map(s => [`${s.traceId}|${s.spanId}`, s]))
  const ancestor = (s: ParsedSpan, pick: (u: GenAiUsage) => string | null): string | null => {
    let cur = s.parentSpanId ? byKey.get(`${s.traceId}|${s.parentSpanId}`) : undefined
    for (let hops = 0; cur && hops < 64; hops++) {
      const v = pick(cur.usage)
      if (v) return v
      cur = cur.parentSpanId ? byKey.get(`${cur.traceId}|${cur.parentSpanId}`) : undefined
    }
    return null
  }
  return spans.map(s => {
    const u = s.usage
    if (u.userKey && u.sessionId) return s
    const userKey = u.userKey ?? ancestor(s, x => x.userKey)
    const userEmail = u.userKey ? u.userEmail : ancestor(s, x => x.userEmail)
    const sessionId = u.sessionId ?? ancestor(s, x => x.sessionId)
    return { ...s, usage: { ...u, userKey, userEmail, sessionId } }
  })
}
