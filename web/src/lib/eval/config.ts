import { createAdminClient } from '@/lib/supabase/server'
import { openKey } from '@/lib/crypto/key-reveal'
import type { JudgeCfg } from './judge'

/**
 * Models an org may use as judge / candidate generator. Anything else is
 * rejected (prevents arbitrary/expensive model ids being billed to a key).
 */
import { ALLOWED_EVAL_MODELS } from './models'
export { ALLOWED_EVAL_MODELS }
export type EvalModel = typeof ALLOWED_EVAL_MODELS[number]

export function isAllowedEvalModel(m: unknown): m is EvalModel {
  return typeof m === 'string' && (ALLOWED_EVAL_MODELS as readonly string[]).includes(m)
}

const ENV_MODEL = process.env.EVAL_JUDGE_MODEL
const DEFAULT_MODEL: EvalModel = isAllowedEvalModel(ENV_MODEL) ? ENV_MODEL : 'claude-haiku-4-5'

/** Server keys may only be spent on org evals when explicitly opted in. */
export const serverKeyAllowed = () => process.env.EVAL_ALLOW_SERVER_KEY === '1'

/**
 * Resolve the eval provider key + judge model for an org.
 *  1. the org's BYO key (encrypted in org_eval_settings) — the org pays, or
 *  2. the server env key (EVAL_JUDGE_KEY / ANTHROPIC_API_KEY) — ONLY when
 *     EVAL_ALLOW_SERVER_KEY=1, so tenants can't spend the operator's key by default.
 * Returns key:'' when neither is available — callers should surface a clear message.
 * A stored judge_model outside the allow-list falls back to the default.
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
  if (!key && serverKeyAllowed()) key = process.env.EVAL_JUDGE_KEY || process.env.ANTHROPIC_API_KEY || ''
  const model = isAllowedEvalModel(data?.judge_model) ? data!.judge_model as EvalModel : DEFAULT_MODEL
  return { key, model }
}
