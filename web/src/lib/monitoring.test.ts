import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseDsn, parseStack, buildEnvelope, captureException, monitoringEnabled } from './monitoring'

describe('monitoring', () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.SENTRY_DSN })

  it('parses DSNs into the envelope endpoint', () => {
    expect(parseDsn('https://abc123@o42.ingest.sentry.io/4507')).toMatchObject({
      envelopeUrl: 'https://o42.ingest.sentry.io/api/4507/envelope/', publicKey: 'abc123',
    })
    expect(parseDsn('https://k@sentry.example.com/sub/path/9')?.envelopeUrl).toBe('https://sentry.example.com/sub/path/api/9/envelope/')
    expect(parseDsn('')).toBeNull()
    expect(parseDsn('not a url')).toBeNull()
    expect(parseDsn('https://sentry.io/1')).toBeNull()          // no key
    expect(parseDsn('https://k@sentry.io/abc')).toBeNull()      // bad project id
  })

  it('parses V8 stacks oldest-first', () => {
    const frames = parseStack('Error: x\n    at inner (/app/src/a.ts:10:5)\n    at /app/node_modules/lib.js:1:2')
    expect(frames).toEqual([
      { function: '<anonymous>', filename: '/app/node_modules/lib.js', lineno: 1, colno: 2, in_app: false },
      { function: 'inner', filename: '/app/src/a.ts', lineno: 10, colno: 5, in_app: true },
    ])
  })

  it('builds a 3-line envelope with a scrubbed exception', () => {
    const dsn = parseDsn('https://pub@sentry.test/1')!
    const { eventId, body } = buildEnvelope(new Error('leak tfk_live_abcdefghijkl'), { tags: { job: 'alerts' }, extra: { password: 'p', n: 1 } }, dsn)
    const [h, t, e] = body.trim().split('\n').map(l => JSON.parse(l))
    expect(h.event_id).toBe(eventId)
    expect(t).toEqual({ type: 'event' })
    expect(e.exception.values[0].value).toBe('leak [redacted]')
    expect(e.tags).toEqual({ job: 'alerts' })
    expect(e.extra).toEqual({ password: '[redacted]', n: 1 })
  })

  it('is a no-op without SENTRY_DSN', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(monitoringEnabled()).toBe(false)
    expect(await captureException(new Error('x'))).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('posts to the envelope endpoint with the auth header and never throws', async () => {
    process.env.SENTRY_DSN = 'https://pub@sentry.test/7'
    const f = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', f)
    const id = await captureException(new Error('x'))
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://sentry.test/api/7/envelope/')
    expect((init.headers as Record<string, string>)['X-Sentry-Auth']).toContain('sentry_key=pub')

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    expect(await captureException(new Error('y'))).toBeNull()
  })
})
