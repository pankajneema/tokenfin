/**
 * Tiny structured JSON logger — one line per event on stdout/stderr, so any log
 * drain (Vercel, Datadog, Loki, CloudWatch) can index it without parsing.
 *
 *   log.info('cron finished', { route: '/api/v1/cron/alerts', duration_ms: 812 })
 *   log.error('purge failed', { route, org_id, err })
 *
 * Privacy: never pass prompt text, emails or raw keys. As a safety net, fields
 * whose NAME looks sensitive (key/token/secret/password/authorization/cookie/
 * prompt/email/…) are replaced with "[redacted]", and string values that look
 * like credentials (tfk_…, sk-…, Bearer …, JWTs) are masked.
 *
 * Server-only (uses process.stdout); safe to import from route handlers and lib code.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogFields {
  route?:       string
  org_id?:      string | null
  duration_ms?: number
  err?:         unknown
  [k: string]:  unknown
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

// Matches e.g. password, client_secret, access_token, api_key, raw_key, authorization,
// prompt_text, user_email — but NOT counters like total_tokens / prompts / key_id.
const SENSITIVE_NAME = /(pass(word)?|secret|(^|[_-])token$|(^|[_-])token[_-]|api[_-]?key$|^key$|raw[_-]?key|authorization|cookie|^prompt$|prompt[_-]?(text|preview|body)|completion|e-?mail|dsn|credential|private)/i
const SECRET_VALUE: RegExp[] = [
  /\btfk_[A-Za-z0-9_]{8,}/g,                        // TokenFin API keys
  /\bsk-[A-Za-z0-9_-]{12,}/g,                       // OpenAI / Anthropic style keys
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,            // auth headers
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWTs
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,                  // GitHub tokens
]

const MAX_STRING = 2000
const MAX_DEPTH  = 4

function minLevel(): number {
  const env = (process.env.LOG_LEVEL || '').toLowerCase() as LogLevel
  return LEVELS[env] ?? (process.env.NODE_ENV === 'test' ? LEVELS.warn : LEVELS.info)
}

/** Masks credential-looking substrings and caps length. */
export function scrubString(s: string): string {
  let out = s
  for (const re of SECRET_VALUE) out = out.replace(re, '[redacted]')
  return out.length > MAX_STRING ? out.slice(0, MAX_STRING) + '…' : out
}

/** Serialises an error to {name, message, stack} (scrubbed). */
export function serializeError(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return {
      name:    err.name,
      message: scrubString(err.message),
      stack:   err.stack ? scrubString(err.stack) : undefined,
    }
  }
  if (err && typeof err === 'object' && 'message' in err) {
    // Supabase/PostgREST errors are plain objects: { message, code, details, hint }.
    const e = err as { message?: unknown; code?: unknown }
    return { name: typeof e.code === 'string' ? `DbError(${e.code})` : 'Error', message: scrubString(String(e.message)) }
  }
  return { name: 'NonError', message: scrubString(String(err)) }
}

/** Deep-copies `v` with sensitive names redacted and secret-looking values masked. */
export function sanitize(v: unknown, depth = 0): unknown {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v === 'string') return scrubString(v)
  if (typeof v === 'bigint') return v.toString()
  if (v instanceof Error) return serializeError(v)
  if (v instanceof Date) return v.toISOString()
  if (depth >= MAX_DEPTH) return '[truncated]'
  if (Array.isArray(v)) return v.slice(0, 50).map(x => sanitize(x, depth + 1))
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SENSITIVE_NAME.test(k) ? '[redacted]' : sanitize(val, depth + 1)
    }
    return out
  }
  return String(v)
}

/** Builds the log record (exported for tests). */
export function formatRecord(level: LogLevel, msg: string, fields: LogFields = {}, now = new Date()): Record<string, unknown> {
  const { err, ...rest } = fields
  const rec: Record<string, unknown> = { ts: now.toISOString(), level, msg: scrubString(msg) }
  const clean = sanitize(rest) as Record<string, unknown>
  for (const [k, v] of Object.entries(clean)) if (v !== undefined) rec[k] = v
  if (err !== undefined) rec.err = serializeError(err)
  return rec
}

function emit(level: LogLevel, msg: string, fields?: LogFields) {
  if (LEVELS[level] < minLevel()) return
  let line: string
  try { line = JSON.stringify(formatRecord(level, msg, fields)) }
  catch { line = JSON.stringify({ ts: new Date().toISOString(), level, msg: scrubString(msg), note: 'unserialisable fields' }) }
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n')
  else process.stdout.write(line + '\n')
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void
  info (msg: string, fields?: LogFields): void
  warn (msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void
  /** A logger that adds `base` (e.g. { route }) to every record. */
  child(base: LogFields): Logger
}

function make(base: LogFields): Logger {
  const m = (l: LogLevel) => (msg: string, f?: LogFields) => emit(l, msg, { ...base, ...f })
  return { debug: m('debug'), info: m('info'), warn: m('warn'), error: m('error'), child: b => make({ ...base, ...b }) }
}

export const log: Logger = make({})
