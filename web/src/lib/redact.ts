/**
 * Scrub secrets and personal data from prompt text before it is stored
 * (prompt_captures.prompt_text, usage_events.prompt_preview).
 *
 * Deliberately conservative: patterns target well-known credential shapes,
 * email addresses and Luhn-valid card numbers, so ordinary prose and code are
 * left alone. Redaction is one-way — the original text is never persisted.
 */

type Rule = { name: string; re: RegExp; test?: (m: string) => boolean }

// Order matters: multi-line / longer shapes first so a shorter rule can't
// split them.
const RULES: Rule[] = [
  { name: 'PRIVATE_KEY', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  // Anthropic (sk-ant-…), OpenAI (sk-…, sk-proj-…) and similar sk- keys.
  { name: 'API_KEY', re: /\bsk-[A-Za-z0-9_-]{16,}/g },
  // TokenFin keys (tfk_prod_…, tfk_…).
  { name: 'API_KEY', re: /\btfk_[A-Za-z0-9_]{12,}/g },
  // AWS access key ids.
  { name: 'AWS_KEY', re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[0-9A-Z]{16}\b/g },
  // GitHub tokens (classic + fine-grained).
  { name: 'GITHUB_TOKEN', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g },
  // Slack tokens, Google API keys, Stripe secret keys.
  { name: 'API_KEY', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { name: 'API_KEY', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'API_KEY', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { name: 'EMAIL', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // 13–19 digits, optionally grouped by single spaces or dashes, with a card
  // network prefix and a valid Luhn checksum (so ids / timestamps survive).
  { name: 'CARD', re: /\b\d(?:[ -]?\d){12,18}\b/g, test: m => isCardNumber(m.replace(/[ -]/g, '')) },
]

const CARD_PREFIX = /^(?:4|5[1-5]|2[2-7]|3[47]|3[068]|35|6(?:011|5|4[4-9]|22))/

export function isCardNumber(digits: string): boolean {
  return CARD_PREFIX.test(digits) && luhn(digits)
}

export function luhn(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false
  let sum = 0
  let dbl = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (dbl) { d *= 2; if (d > 9) d -= 9 }
    sum += d
    dbl = !dbl
  }
  return sum % 10 === 0
}

/** Replace secrets / emails / card numbers with `[REDACTED_<KIND>]`. */
export function redact(text: string): string
export function redact(text: string | null | undefined): string | null
export function redact(text: string | null | undefined): string | null {
  if (text == null) return null
  let out = String(text)
  for (const r of RULES) {
    out = out.replace(r.re, m => (r.test && !r.test(m) ? m : `[REDACTED_${r.name}]`))
  }
  return out
}

/** Redacted preview, trimmed to `max` characters. */
export function redactPreview(text: string | null | undefined, max = 120): string | null {
  const r = redact(text)
  if (r == null) return null
  const t = r.trim()
  return t ? t.slice(0, max) : null
}
