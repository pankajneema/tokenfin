/**
 * LLM-as-judge evaluators. Server-only.
 *
 * The provider key + judge model are passed in per call (a JudgeCfg) so each org
 * uses its OWN key — see resolveJudge() in ./config. Nothing here reads global
 * env directly except as a fallback provided by the resolver.
 *
 * - faithfulness (reference-free hallucination check): decompose the answer into
 *   atomic claims, verify each against the context; score = supported/total.
 * - correctness (reference-based): compare answer to a reference.
 * - generate: produce an answer from a model (offline/pairwise).
 * - pairwise: head-to-head preference.
 */
export interface JudgeCfg { key: string; model: string }
export interface JudgeResult { score: number; passed: boolean; rationale: string; judgeModel: string }
export interface PairwiseResult { winner: 'A' | 'B' | 'tie'; rationale: string; judgeModel: string }

async function callAnthropic(key: string, model: string, opts: { system?: string; prompt: string; maxTokens: number; temperature?: number }): Promise<string> {
  if (!key) throw new Error('No eval key configured for this org (set one in Evals settings, or EVAL_JUDGE_KEY).')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: opts.maxTokens, temperature: opts.temperature ?? 0,
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: 'user', content: opts.prompt }],
    }),
  })
  if (!res.ok) throw new Error(`provider call failed: ${res.status}`)
  const data = await res.json()
  return (data.content ?? []).map((b: any) => b.text ?? '').join('')
}

function parseJson(text: string): any {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('judge returned no JSON')
  return JSON.parse(m[0])
}
const clamp01 = (n: number) => Math.max(0, Math.min(1, Number(n) || 0))

export async function judgeFaithfulness(cfg: JudgeCfg, answer: string, context: string): Promise<JudgeResult> {
  const system =
    'You are a strict RAG faithfulness grader. Decompose the ANSWER into atomic factual claims. ' +
    'For each claim decide if it is supported by the CONTEXT. Do NOT use outside knowledge. ' +
    'Return ONLY JSON: {"total_claims": int, "supported_claims": int, "unsupported": [string], "rationale": string}.'
  const prompt = `CONTEXT:\n${context.slice(0, 12000)}\n\nANSWER:\n${answer.slice(0, 8000)}`
  const j = parseJson(await callAnthropic(cfg.key, cfg.model, { system, prompt, maxTokens: 512 }))
  const total = Math.max(1, Number(j.total_claims) || 1)
  const score = clamp01((Number(j.supported_claims) || 0) / total)
  return { score, passed: score >= 0.8, rationale: String(j.rationale ?? ''), judgeModel: cfg.model }
}

export async function judgeCorrectness(cfg: JudgeCfg, question: string, answer: string, reference: string): Promise<JudgeResult> {
  const system =
    'You are a grader. Compare the ANSWER to the REFERENCE for the QUESTION. Score 0.0–1.0 for correctness ' +
    '(1 = fully correct/equivalent, 0 = wrong). Return ONLY JSON: {"score": number, "rationale": string}.'
  const prompt = `QUESTION:\n${question.slice(0, 4000)}\n\nREFERENCE:\n${reference.slice(0, 6000)}\n\nANSWER:\n${answer.slice(0, 6000)}`
  const j = parseJson(await callAnthropic(cfg.key, cfg.model, { system, prompt, maxTokens: 512 }))
  const score = clamp01(j.score)
  return { score, passed: score >= 0.7, rationale: String(j.rationale ?? ''), judgeModel: cfg.model }
}

/** Generate an answer from `model` using the org's key (for offline/pairwise). */
export async function generate(cfg: JudgeCfg, model: string, prompt: string): Promise<string> {
  return callAnthropic(cfg.key, model, { prompt, maxTokens: 1024, temperature: 1 })
}

export async function judgePairwise(cfg: JudgeCfg, question: string, a: string, b: string): Promise<PairwiseResult> {
  const system =
    'You compare two answers (A and B) to the same QUESTION and pick the better one on helpfulness, ' +
    'correctness, and clarity. Return ONLY JSON: {"winner": "A" | "B" | "tie", "rationale": string}.'
  const prompt = `QUESTION:\n${question.slice(0, 4000)}\n\nANSWER A:\n${a.slice(0, 6000)}\n\nANSWER B:\n${b.slice(0, 6000)}`
  const j = parseJson(await callAnthropic(cfg.key, cfg.model, { system, prompt, maxTokens: 512 }))
  const w = j.winner === 'A' || j.winner === 'B' ? j.winner : 'tie'
  return { winner: w, rationale: String(j.rationale ?? ''), judgeModel: cfg.model }
}
