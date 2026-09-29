/**
 * Optional LLM intent mapper for "Ask your spend".
 *
 * Only used when ANTHROPIC_API_KEY is set AND the deterministic parser found
 * nothing. Privacy: the request carries ONLY the user's question and the intent
 * schema below — never usage rows, names, costs or org data. The model's reply
 * is validated against askIntentSchema; anything else is discarded.
 *
 * Raw fetch (the web app does not depend on @anthropic-ai/sdk). Server-only.
 */
import { askIntentSchema, type AskIntent } from './intents'

export const ASK_LLM_MODEL = process.env.TOKENFIN_ASK_MODEL || 'claude-opus-5'
const TIMEOUT_MS = 8_000

const PERIOD = `{"kind":"today"|"yesterday"|"this_week"|"last_week"|"this_month"|"last_month"} or {"kind":"last_n_days","n":1-366}`
export const INTENT_SCHEMA_TEXT = [
  'Reply with ONE JSON object and nothing else, matching exactly one of:',
  `{"kind":"total","period":PERIOD}  — total spend over a period`,
  `{"kind":"spend_by","dim":"model"|"project"|"member"|"source"|"repo"|"agent"|"day","period":PERIOD}`,
  `{"kind":"top","dim":"model"|"project"|"member"|"source"|"repo"|"agent","n":1-50,"period":PERIOD}`,
  `{"kind":"compare","unit":"week"|"month"}  — this week/month so far vs the same days of the previous one`,
  `{"kind":"member_spend","member":"<name or email as written by the user, or \\"me\\">","period":PERIOD}`,
  `{"kind":"mtd"}  — month-to-date spend and projected month total`,
  `{"kind":"none"}  — the question is not about LLM spend/usage`,
  `PERIOD is ${PERIOD}. Default period when none is stated: {"kind":"last_n_days","n":30}.`,
].join('\n')

type FetchLike = (input: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>

/** Extract the first {...} JSON object from model text. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(text.slice(start, end + 1)) } catch { return null }
}

/**
 * Map a question to an intent with Claude. Returns null on any failure, when
 * no key is configured, or when the model says the question is out of scope.
 */
export async function mapQuestionWithLLM(
  question: string,
  opts: { apiKey?: string | null; fetchImpl?: FetchLike } = {},
): Promise<AskIntent | null> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  const doFetch: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i))
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await doFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ASK_LLM_MODEL,
        max_tokens: 1024,
        output_config: { effort: 'low' },
        system: 'You classify questions about an organization\'s LLM API spend into a fixed set of intents for a FinOps dashboard.\n' + INTENT_SCHEMA_TEXT,
        messages: [{ role: 'user', content: question.slice(0, 300) }],
      }),
      signal: ctrl.signal,
      cache: 'no-store',
    })
    if (!res.ok) return null
    const body = await res.json() as { stop_reason?: string; content?: { type: string; text?: string }[] }
    if (body.stop_reason === 'refusal') return null
    const text = (body.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('')
    const parsed = askIntentSchema.safeParse(extractJson(text))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
