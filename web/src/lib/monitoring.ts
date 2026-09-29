/**
 * Optional error reporting to Sentry — WITHOUT the Sentry SDK.
 *
 * When SENTRY_DSN is set, captureException() posts one event to Sentry's
 * envelope endpoint with fetch (fire-and-forget, 3s timeout, never throws).
 * With no DSN it is a no-op, so self-hosters need nothing.
 *
 * Env: SENTRY_DSN (https://<public_key>@<host>/<project_id>),
 *      SENTRY_ENVIRONMENT (default NODE_ENV), SENTRY_RELEASE (default VERCEL_GIT_COMMIT_SHA).
 *
 * Privacy: only the error (scrubbed via lib/log) and the tags/extra you pass
 * are sent — no request bodies, headers, cookies, user emails or prompt text.
 */
import crypto from 'crypto'
import { sanitize, serializeError } from '@/lib/log'

export interface ParsedDsn { envelopeUrl: string; publicKey: string; dsn: string }

/** Parses a Sentry DSN into its envelope endpoint + public key; null when invalid. */
export function parseDsn(dsn: string | undefined | null): ParsedDsn | null {
  if (!dsn) return null
  try {
    const u = new URL(dsn.trim())
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    const publicKey = decodeURIComponent(u.username)
    const parts     = u.pathname.split('/').filter(Boolean)
    const projectId = parts.pop()
    if (!publicKey || !projectId || !/^\d+$/.test(projectId)) return null
    const prefix = parts.length ? '/' + parts.join('/') : ''
    return { envelopeUrl: `${u.protocol}//${u.host}${prefix}/api/${projectId}/envelope/`, publicKey, dsn: dsn.trim() }
  } catch { return null }
}

interface Frame { function?: string; filename?: string; lineno?: number; colno?: number; in_app?: boolean }

/** V8 stack → Sentry frames (oldest first, as Sentry expects). */
export function parseStack(stack: string | undefined): Frame[] {
  if (!stack) return []
  const frames: Frame[] = []
  for (const line of stack.split('\n').slice(1, 51)) {
    const m = line.match(/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/)
    if (!m) continue
    const filename = m[2]
    frames.push({
      function: m[1] || '<anonymous>', filename, lineno: +m[3], colno: +m[4],
      in_app: !filename.includes('node_modules') && !filename.startsWith('node:'),
    })
  }
  return frames.reverse()
}

export interface CaptureContext {
  tags?:  Record<string, string | number | boolean | null | undefined>
  extra?: Record<string, unknown>
  level?: 'fatal' | 'error' | 'warning'
}

/** Builds the envelope body (exported for tests). */
export function buildEnvelope(err: unknown, ctx: CaptureContext, dsn: ParsedDsn, now = new Date()): { eventId: string; body: string } {
  const eventId = crypto.randomUUID().replace(/-/g, '')
  const e = serializeError(err)
  const tags: Record<string, string> = {}
  for (const [k, v] of Object.entries(ctx.tags ?? {})) if (v != null) tags[k] = String(v).slice(0, 200)
  const event = {
    event_id:    eventId,
    timestamp:   now.getTime() / 1000,
    platform:    'node',
    level:       ctx.level ?? 'error',
    logger:      'tokenfin',
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
    release:     process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    server_name: undefined,
    tags,
    extra:       ctx.extra ? sanitize(ctx.extra) : undefined,
    exception:   { values: [{ type: e.name, value: e.message, stacktrace: { frames: parseStack(e.stack) } }] },
  }
  const header = { event_id: eventId, sent_at: now.toISOString(), dsn: dsn.dsn }
  const body = [JSON.stringify(header), JSON.stringify({ type: 'event' }), JSON.stringify(event)].join('\n') + '\n'
  return { eventId, body }
}

/**
 * Reports an error to Sentry if SENTRY_DSN is configured. Returns the event id
 * (or null when disabled/failed). Never throws. Await it in short-lived
 * handlers so the request is not cut off when the function freezes.
 */
export async function captureException(err: unknown, ctx: CaptureContext = {}): Promise<string | null> {
  const dsn = parseDsn(process.env.SENTRY_DSN)
  if (!dsn) return null
  try {
    const { eventId, body } = buildEnvelope(err, ctx, dsn)
    const res = await fetch(dsn.envelopeUrl, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=tokenfin-fetch/1.0`,
      },
      body,
      signal: AbortSignal.timeout(3000),
      cache:  'no-store',
    })
    return res.ok ? eventId : null
  } catch { return null }
}

/** True when error reporting is configured (for /api/health-style diagnostics). */
export function monitoringEnabled(): boolean {
  return parseDsn(process.env.SENTRY_DSN) !== null
}
