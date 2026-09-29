import { describe, it, expect, beforeAll } from 'vitest'
import { sealConfig, readSecret, publicConfig, integrationUrl, maskSecret, isSupportedIntegration } from './config'
import { deliveryDetail } from './delivery'

beforeAll(() => { process.env.KEY_ENCRYPTION_SECRET = 'test-only-secret-for-vitest' })

const SLACK = 'https://hooks.slack.com/services/T000/B000/abcdefghijklmnop'

describe('integration secret sealing', () => {
  it('round-trips a sealed webhook URL and stores no plaintext', () => {
    const cfg = sealConfig({ webhook_url: SLACK, label: '#alerts' })
    expect(JSON.stringify(cfg)).not.toContain('abcdefghijklmnop')
    expect(cfg.label).toBe('#alerts')
    expect((cfg.webhook_url as { enc: { ciphertext: string } }).enc.ciphertext).toBeTruthy()
    expect(readSecret(cfg, 'webhook_url')).toBe(SLACK)
    expect(integrationUrl([{ provider: 'slack', config: cfg }], 'slack')).toBe(SLACK)
  })

  it('reads legacy plaintext rows transparently', () => {
    const legacy = { url: ' https://example.com/hook ' }
    expect(readSecret(legacy, 'url')).toBe('https://example.com/hook')
    expect(integrationUrl([{ provider: 'webhook', config: legacy }], 'webhook')).toBe('https://example.com/hook')
    expect(integrationUrl([{ provider: 'webhook', config: { endpoint: 'https://e.example/x' } }], 'webhook')).toBe('https://e.example/x')
    expect(integrationUrl([{ provider: 'webhook', config: legacy }], 'slack')).toBeNull()
  })

  it('never exposes secrets via publicConfig (sealed or legacy)', () => {
    const sealed = publicConfig(sealConfig({ webhook_url: SLACK, label: 'x' }))
    expect(sealed.webhook_url).toBe(maskSecret(SLACK))
    expect(JSON.stringify(sealed)).not.toMatch(/abcdefghijklmnop|ciphertext|authTag/)
    const legacy = publicConfig({ api_key: 'dd-secret-key-1234567890', webhook_url: SLACK })
    expect(JSON.stringify(legacy)).not.toMatch(/dd-secret-key-123456|abcdefghijklmnop/)
  })

  it('returns null for tampered ciphertext instead of throwing', () => {
    const cfg = sealConfig({ webhook_url: SLACK }) as Record<string, { enc: { authTag: string } }>
    cfg.webhook_url.enc.authTag = Buffer.alloc(16).toString('base64')
    expect(readSecret(cfg, 'webhook_url')).toBeNull()
  })

  it('allow-lists only real channels', () => {
    expect(['slack', 'webhook', 'email'].every(isSupportedIntegration)).toBe(true)
    expect(['datadog', 'teams', 'bigquery', 'github-actions', ''].some(isSupportedIntegration)).toBe(false)
  })

  it('delivery detail reflects the real send result', () => {
    const at = new Date('2026-09-29T10:00:00Z')
    expect(deliveryDetail({ sent: true }, at)).toBe('Last delivery OK · 2026-09-29 10:00 UTC')
    expect(deliveryDetail({ sent: false, reason: 'slack 404' }, at)).toContain('failed: slack 404')
  })
})
