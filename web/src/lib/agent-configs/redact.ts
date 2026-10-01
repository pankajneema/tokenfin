/**
 * Server-side redaction of agent config snapshots — defense in depth. The CLI
 * already redacts on the machine (cli/lib/agentconfig.js, same rules); this
 * pass guarantees that an old or modified CLI can never store a raw secret.
 *
 * Rules (keep in sync with cli/lib/agentconfig.js):
 *   1. A string under a key matching SENSITIVE_KEY → "[redacted]" (numbers and
 *      booleans are kept: `maxTokens: 4096` is not a secret). Applies to every
 *      string beneath such a key when its value is an object/array.
 *   2. OTEL_EXPORTER_OTLP_HEADERS (any casing) and every value inside a
 *      `headers` object → "[redacted]".
 *   3. In EVERY string: known token shapes (tfk_, sk-, sk-ant-, gh*_, JWT, AWS,
 *      Slack, Google, Bearer …, URL passwords) and long hex / high-entropy
 *      runs are replaced in place, so a URL keeps its host.
 */

export const REDACTED = '[redacted]'
export const SENSITIVE_KEY = /key|token|secret|passw(or)?d|auth|credential|bearer|cookie/i
const HEADER_KEYS = /^(otel_exporter_otlp(_[a-z]+)?_headers|headers|http_headers|env_http_headers)$/i

const TOKEN_RES: RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,      // JWT
  /\btfk_[A-Za-z0-9_]{6,}/g,                                              // TokenFin
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{12,}/g,                                    // Anthropic / OpenAI
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{12,}/g,                       // Stripe
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,        // GitHub
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,                                     // Slack
  /\bAIza[0-9A-Za-z_-]{30,}/g,                                            // Google
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,                                       // AWS
  /\bglpat-[A-Za-z0-9_-]{16,}/g,                                          // GitLab
  /\bnpm_[A-Za-z0-9]{30,}/g,                                              // npm
]

// "Bearer xyz" / "Basic xyz" → keep the scheme.
const AUTH_SCHEME = /\b(Bearer|Basic)\s+(?!\[redacted\])[^\s,;"']{6,}/gi
// scheme://user:password@host → keep the user.
const URL_PASSWORD = /([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+):[^\s@/]+@/gi
// ?key=… / &token=… style query parameters.
const QUERY_SECRET = /([?&](?:[a-z0-9_-]*(?:key|token|secret|password|auth|sig|signature)[a-z0-9_-]*)=)[^&#\s"']+/gi

function highEntropy(run: string): boolean {
  if (/^[0-9a-f]{32,}$/i.test(run)) return true                          // long hex (keys, hashes)
  if (run.length < 32) return false
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter(r => r.test(run)).length
  return classes === 3                                                    // mixed-case + digits base64/url-safe
}
const LONG_RUN = /[A-Za-z0-9+_=-]{32,}/g

export function redactString(s: string): string {
  let out = s
  for (const re of TOKEN_RES) out = out.replace(re, REDACTED)
  out = out.replace(AUTH_SCHEME, (_m, scheme: string) => `${scheme} ${REDACTED}`)
  out = out.replace(URL_PASSWORD, (_m, pre: string) => `${pre}:${REDACTED}@`)
  out = out.replace(QUERY_SECRET, (_m, pre: string) => `${pre}${REDACTED}`)
  out = out.replace(LONG_RUN, m => (highEntropy(m.replace(/=+$/, '')) ? REDACTED : m))
  return out
}

function redactAll(v: unknown): unknown {
  if (typeof v === 'string') return v ? REDACTED : v
  if (Array.isArray(v)) return v.map(redactAll)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactAll(x)]))
  return v
}

/** Deep-redact a parsed config. Never mutates the input. */
export function redactConfig<T>(value: T, depth = 0): T {
  if (depth > 40) return REDACTED as unknown as T
  if (typeof value === 'string') return redactString(value) as unknown as T
  if (Array.isArray(value)) return value.map(v => redactConfig(v, depth + 1)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (HEADER_KEYS.test(k)) out[k] = redactAll(v)
      else if (SENSITIVE_KEY.test(k)) out[k] = redactAll(v)
      else out[k] = redactConfig(v, depth + 1)
    }
    return out as T
  }
  return value
}

/** True if any string in the value still looks like a secret (used by tests / API guard). */
export function looksSecret(value: unknown): boolean {
  const s = JSON.stringify(value) ?? ''
  return TOKEN_RES.some(re => { re.lastIndex = 0; const hit = re.test(s); re.lastIndex = 0; return hit })
}
