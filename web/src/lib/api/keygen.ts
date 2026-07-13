/**
 * API key generation — the canonical `tfk_...` format used across key creation,
 * provisioning, and CLI login. Raw keys are shown/handed out exactly once; only
 * the SHA-256 hash and a masked prefix are persisted on `api_keys`.
 */
import crypto from 'crypto'

export function generateApiKey(projectId: string, env: string): string {
  const envShort = env === 'production' ? 'prod' : env === 'staging' ? 'stg' : 'dev'
  const segment  = projectId.replace(/-/g, '').slice(0, 4)
  return `tfk_${envShort}_${segment}_${crypto.randomBytes(16).toString('hex')}`
}

export function maskKey(raw: string): string {
  return `${raw.split('_').slice(0, 3).join('_')}_…${raw.slice(-4)}`
}

export function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}
