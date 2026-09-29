import { describe, it, expect, beforeAll } from 'vitest'
import {
  newUserCode, isValidUserCode, normalizeUserCode, formatUserCode,
  signDeviceCode, verifyDeviceCode, approvalHandle,
} from './_codes'

beforeAll(() => { process.env.KEY_ENCRYPTION_SECRET = 'test-secret' })

describe('device login codes', () => {
  it('user codes are 10 chars with a valid check suffix', () => {
    for (let i = 0; i < 50; i++) {
      const c = newUserCode()
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{10}$/)
      expect(isValidUserCode(c)).toBe(true)
      expect(isValidUserCode(normalizeUserCode(formatUserCode(c).toLowerCase()))).toBe(true)
    }
  })
  it('rejects typos, made-up and malformed codes', () => {
    // A wrong check suffix only passes the 10-bit check by chance (~1/1024).
    let accepted = 0
    for (let i = 0; i < 200; i++) if (isValidUserCode(newUserCode().slice(0, 8) + 'AA')) accepted++
    expect(accepted).toBeLessThan(10)
    expect(isValidUserCode('SHORT')).toBe(false)
    expect(isValidUserCode('ABCDEFGHI0')).toBe(false) // 0 is not in the alphabet
  })
  it('device codes verify, carry the payload, and reject tampering', () => {
    const dc = signDeviceCode({ uc: 'ABCDEFGH23', exp: 123, did: 'dev-1', lbl: 'host' })
    expect(verifyDeviceCode(dc)).toEqual({ uc: 'ABCDEFGH23', exp: 123, did: 'dev-1', lbl: 'host' })
    const [body, sig] = dc.split('.')
    const forged = Buffer.from(JSON.stringify({ uc: 'ZZZZZZZZ23', exp: 123, did: null, lbl: null })).toString('base64url')
    expect(verifyDeviceCode(forged + '.' + sig)).toBeNull()
    expect(verifyDeviceCode(body + '.AAAA')).toBeNull()
    expect(verifyDeviceCode('garbage')).toBeNull()
  })
  it('approval handle is deterministic, secret-dependent and not a .read token', () => {
    const h = approvalHandle('ABCDEFGH23')
    expect(h).toBe(approvalHandle('ABCDEFGH23'))
    expect(h).not.toBe(approvalHandle('ABCDEFGH24'))
    expect(h.endsWith('.read')).toBe(false)
    process.env.KEY_ENCRYPTION_SECRET = 'other'
    expect(approvalHandle('ABCDEFGH23')).not.toBe(h)
    process.env.KEY_ENCRYPTION_SECRET = 'test-secret'
  })
})
