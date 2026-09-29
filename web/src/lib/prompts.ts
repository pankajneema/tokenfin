/**
 * Prompt counting — shared by every page that shows "LLM calls".
 *
 * A prompt is one thing a person asked. CLI agents (Claude Code, Codex,
 * Gemini) make several LLM calls per prompt; all of them carry the same
 * correlation_id (prompt.id / conversation id), so they count once.
 * SDK / direct API events have no correlation id: each request is one prompt.
 */
export type PromptRow = { id: string; correlation_id?: string | null }

export const promptKey = (r: PromptRow): string => r.correlation_id || r.id

export function countPrompts(rows: readonly PromptRow[]): number {
  const keys = new Set<string>()
  for (const r of rows) keys.add(promptKey(r))
  return keys.size
}

/** Average LLM calls per prompt, or null when there are no prompts. */
export function callsPerPrompt(calls: number, prompts: number): number | null {
  return prompts > 0 ? +(calls / prompts).toFixed(1) : null
}
