/**
 * OTLP attribute helpers — shared by the metrics / logs / traces receivers.
 *
 * Both the OTLP/JSON body and a protobufjs-decoded protobuf body use camelCase
 * field names (`stringValue`, `startTimeUnixNano`, …), so one set of helpers
 * covers both wire formats.
 */
import { DEFAULT_TIMEZONE, toZonedDate } from '@/lib/dates'

// OTLP AnyValue → JS primitive.
export function attrVal(v: any): unknown {
  if (!v) return undefined
  if (v.stringValue !== undefined) return v.stringValue
  if (v.intValue !== undefined) return Number(v.intValue)
  if (v.doubleValue !== undefined) return v.doubleValue
  if (v.boolValue !== undefined) return v.boolValue
  if (v.bytesValue !== undefined) return v.bytesValue
  return undefined
}

// [{key,value}] → { key: primitive }
export const attrsToMap = (arr: any[]): Record<string, unknown> =>
  Object.fromEntries((arr ?? []).map((a: any) => [a.key, attrVal(a.value)]))

// OTLP fixed64 nanos → ISO string.
export const nanoToIso = (n: string | number | undefined | null): string | null =>
  n ? new Date(Number(n) / 1e6).toISOString() : null

// A number attribute, tolerant of string / int / undefined.
export const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// ── Attribution helpers (migration 007) ─────────────────────────────────────

const str = (v: unknown): string => (v == null ? '' : String(v).trim())

/**
 * Repository name for a record: vcs.repository.name (Claude Code with
 * OTEL_METRICS_INCLUDE_REPOSITORY=1), else the basename of the repository URL,
 * else a user-supplied OTEL_RESOURCE_ATTRIBUTES key (repo / repository).
 * Returns '' when unknown.
 */
export function repoFrom(a: Record<string, unknown>): string {
  const name = str(a['vcs.repository.name'])
  if (name) return name
  const url = str(a['vcs.repository.url.full'] ?? a['vcs.repository.url'])
  if (url) {
    const base = url.replace(/[?#].*$/, '').replace(/\/+$/, '').split(/[/:]/).pop() ?? ''
    const clean = base.replace(/\.git$/i, '')
    if (clean) return clean
  }
  return str(a['repo'] ?? a['repository'] ?? a['repo.name'] ?? a['repository.name'])
}

/** Stable per-user key: user.email, else account uuid, else 'unknown'. */
export function userKeyFrom(a: Record<string, unknown>): string {
  return str(a['user.email'] ?? a['user_email'])
    || str(a['user.account_uuid'] ?? a['user.account_id'])
    || 'unknown'
}

// Cost-allocation dimensions teams set via OTEL_RESOURCE_ATTRIBUTES
// (e.g. team.name=platform,cost_center=eng-42,department=r&d,project=atlas).
const TAG_PREFIXES = ['team.', 'cost_center', 'cost.center', 'department', 'project']

/** Copy cost-allocation attributes into a flat string map for usage_events.tags. */
export function allocationTagsFrom(a: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(a)) {
    if (v == null || typeof v === 'object') continue
    const key = k.toLowerCase()
    if (!TAG_PREFIXES.some(p => key.startsWith(p))) continue
    const s = String(v).trim()
    if (s) out[k] = s.slice(0, 200)
  }
  return out
}

/** OTLP time (nanos) → calendar day in the workspace time zone (default IST). */
export function istDay(timeNano: string | number | undefined | null, tz: string = DEFAULT_TIMEZONE): string {
  const ms = timeNano ? Number(timeNano) / 1e6 : Date.now()
  return toZonedDate(Number.isFinite(ms) && ms > 0 ? ms : Date.now(), tz)
}
