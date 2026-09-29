import { describe, it, expect } from 'vitest'
import { originAllowed, wwwAuthenticate } from './auth'

const ALLOWED = ['https://app.tokenfin.test', 'https://claude.ai', undefined]

describe('MCP origin guard', () => {
  it('allows non-browser clients (no Origin)', () => {
    expect(originAllowed(null, ALLOWED)).toBe(true)
  })
  it('allows exact allow-listed origins and loopback on any port', () => {
    expect(originAllowed('https://claude.ai', ALLOWED)).toBe(true)
    expect(originAllowed('https://app.tokenfin.test', ALLOWED)).toBe(true)
    expect(originAllowed('http://localhost:6274', ALLOWED)).toBe(true)
    expect(originAllowed('http://127.0.0.1', ALLOWED)).toBe(true)
    expect(originAllowed('http://[::1]:3000', ALLOWED)).toBe(true)
  })
  it('rejects look-alike hosts that only share a prefix', () => {
    expect(originAllowed('http://localhost.evil.com', ALLOWED)).toBe(false)
    expect(originAllowed('http://127.0.0.1.nip.io', ALLOWED)).toBe(false)
    expect(originAllowed('https://claude.ai.evil.com', ALLOWED)).toBe(false)
    expect(originAllowed('http://claude.ai', ALLOWED)).toBe(false) // scheme must match
    expect(originAllowed('https://evil.com', ALLOWED)).toBe(false)
  })
  it('rejects garbage and non-http schemes', () => {
    expect(originAllowed('null', ALLOWED)).toBe(false)
    expect(originAllowed('file://localhost', ALLOWED)).toBe(false)
  })
})

describe('WWW-Authenticate', () => {
  it('omits error= when no token was sent (RFC 6750 §3.1)', () => {
    expect(wwwAuthenticate(false)).toBe('Bearer realm="TokenFin MCP"')
  })
  it('includes invalid_token when a token was sent', () => {
    expect(wwwAuthenticate(true)).toContain('error="invalid_token"')
  })
})
