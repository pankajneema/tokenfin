import { parseQuestion, type AskIntent } from './intents'
import { answerIntent, ASK_EXAMPLES, type AskAnswer, type AskContext, type AskData } from './answer'

export { parseQuestion, looksLikeQuestion, resolvePeriod } from './intents'
export type { AskIntent } from './intents'
export { answerIntent, exploreLink, ASK_EXAMPLES } from './answer'
export type { AskAnswer, AskData, AskContext, AskTotals, AskTable } from './answer'

export type AskResult = AskAnswer | { intent: null; answer: string; examples: string[] }

/** Deterministic parse first; optional LLM mapping (intent only) as a fallback. */
export async function ask(
  question: string,
  data: AskData,
  ctx: AskContext,
  llm?: (q: string) => Promise<AskIntent | null>,
): Promise<AskResult> {
  let intent = parseQuestion(question)
  let source: AskAnswer['source'] = 'rules'
  if (!intent && llm) {
    intent = await llm(question)
    source = 'llm'
  }
  if (!intent) {
    return { intent: null, answer: 'I can answer spend questions like these:', examples: ASK_EXAMPLES }
  }
  return { ...(await answerIntent(intent, data, ctx)), source }
}
