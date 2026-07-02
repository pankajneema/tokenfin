import { createAdminClient } from '@/lib/supabase/server'
import { openKey } from '@/lib/crypto/key-reveal'
import type { JudgeCfg } from './judge'

const DEFAULT_MODEL = process.env.EVAL_JUDGE_MODEL || 'claude-haiku-4-5'

/**
 * Resolve the eval provider key + judge model for an org.
 *  1. the org's BYO key (encrypted in org_eval_settings) — the org pays, or
 *  2. the server env key (EVAL_JUDGE_KEY / ANTHROPIC_API_KEY) as a fallback.
 * Returns key:'' when neither is set — callers should surface a clear message.
 */
export async function resolveJudge(orgId: string): Promise<JudgeCfg> {
  const { data } = await createAdminClient()
    .from('org_eval_settings')
    .select('key_cipher, key_iv, key_tag, judge_model')
    .eq('org_id', orgId)
    .maybeSingle()

  let key = ''
  if (data?.key_cipher && data.key_iv && data.key_tag) {
    try { key = openKey({ ciphertext: data.key_cipher, iv: data.key_iv, authTag: data.key_tag }) } catch { /* fall back */ }
  }
  if (!key) key = process.env.EVAL_JUDGE_KEY || process.env.ANTHROPIC_API_KEY || ''
  return { key, model: data?.judge_model || DEFAULT_MODEL }
}
