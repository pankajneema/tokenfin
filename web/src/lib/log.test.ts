import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatRecord, sanitize, scrubString, serializeError, log } from './log'

describe('log', () => {
  afterEach(() => { vi.restoreAllMocks(); delete process.env.LOG_LEVEL })

  it('formats one JSON record with the standard fields', () => {
    const r = formatRecord('info', 'cron finished', { route: '/api/v1/cron/alerts', org_id: 'o1', duration_ms: 12 }, new Date('2026-09-29T00:00:00Z'))
    expect(r).toEqual({ ts: '2026-09-29T00:00:00.000Z', level: 'info', msg: 'cron finished', route: '/api/v1/cron/alerts', org_id: 'o1', duration_ms: 12 })
  })

  it('serialises errors with name, message and stack', () => {
    const r = formatRecord('error', 'boom', { err: new TypeError('bad thing') })
    const err = r.err as { name: string; message: string; stack?: string }
    expect(err.name).toBe('TypeError')
    expect(err.message).toBe('bad thing')
    expect(err.stack).toContain('TypeError: bad thing')
    expect(serializeError({ message: 'relation missing', code: '42P01' })).toEqual({ name: 'DbError(42P01)', message: 'relation missing' })
  })

  it('redacts sensitive field names but keeps counters', () => {
    const out = sanitize({
      api_key: 'x', password: 'p', authorization: 'a', prompt_text: 'hello', user_email: 'a@b.c', access_token: 't',
      total_tokens: 5, prompts: 3, key_id: 'k1', nested: { client_secret: 's', ok: true },
    }) as Record<string, unknown>
    expect(out).toMatchObject({
      api_key: '[redacted]', password: '[redacted]', authorization: '[redacted]', prompt_text: '[redacted]',
      user_email: '[redacted]', access_token: '[redacted]', total_tokens: 5, prompts: 3, key_id: 'k1',
      nested: { client_secret: '[redacted]', ok: true },
    })
  })

  it('masks credential-looking values anywhere in strings', () => {
    const s = scrubString('key tfk_prod_abcdef123456 and sk-ant-api03-AAAAAAAAAAAAAAAA and Bearer abc.def.ghi-jkl')
    expect(s).not.toMatch(/tfk_prod_abcdef/)
    expect(s).not.toMatch(/sk-ant-api03/)
    expect(s).not.toMatch(/abc\.def\.ghi/)
    expect(formatRecord('error', 'x', { err: new Error('failed with tfk_live_1234567890abcd') }).err).toMatchObject({ message: 'failed with [redacted]' })
  })

  it('writes errors to stderr and respects LOG_LEVEL', () => {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    process.env.LOG_LEVEL = 'info'
    log.child({ route: '/r' }).error('bad', { org_id: 'o' })
    log.debug('hidden')
    expect(out).not.toHaveBeenCalled()
    expect(JSON.parse(String(err.mock.calls[0][0]))).toMatchObject({ level: 'error', msg: 'bad', route: '/r', org_id: 'o' })
  })
})
