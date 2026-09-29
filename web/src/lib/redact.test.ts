import { describe, it, expect } from 'vitest'
import { redact, redactPreview, isCardNumber } from './redact'

describe('redact', () => {
  it('removes provider and TokenFin API keys', () => {
    const t = redact('use sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv and sk-proj-1234567890abcdefXYZ and tfk_prod_abc123def456ghi789')
    expect(t).not.toMatch(/sk-ant|sk-proj|tfk_prod/)
    expect(t.match(/\[REDACTED_API_KEY\]/g)).toHaveLength(3)
  })

  it('removes AWS keys, GitHub tokens and JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    const t = redact(`AKIAIOSFODNN7EXAMPLE ghp_${'a'.repeat(36)} Bearer ${jwt}`)
    expect(t).toBe('[REDACTED_AWS_KEY] [REDACTED_GITHUB_TOKEN] Bearer [REDACTED_JWT]')
  })

  it('removes private key blocks', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----'
    expect(redact(`key:\n${pem}\ndone`)).toBe('key:\n[REDACTED_PRIVATE_KEY]\ndone')
  })

  it('removes emails and Luhn-valid card numbers, keeps ordinary numbers', () => {
    const t = redact('mail jane.doe+x@example.co.uk, card 4111 1111 1111 1111, order 1234567890123, ts 1727600000000')
    expect(t).toBe('mail [REDACTED_EMAIL], card [REDACTED_CARD], order 1234567890123, ts 1727600000000')
    expect(isCardNumber('4111111111111112')).toBe(false)   // bad checksum
  })

  it('leaves normal prose and code alone', () => {
    const s = 'refactor the auth module; const sk = getKey(); x = a - b'
    expect(redact(s)).toBe(s)
  })

  it('previews are redacted before trimming', () => {
    expect(redactPreview('email me at a@b.io please', 12)).toBe('email me at ')
    expect(redactPreview('   ')).toBeNull()
    expect(redactPreview(null)).toBeNull()
  })
})
