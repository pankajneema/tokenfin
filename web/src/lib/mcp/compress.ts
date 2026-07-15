import crypto from 'crypto'

// Reversible CCR compression for the MCP `compress` tool. Bulky JSON arrays
// keep the first N rows; large text keeps head+tail. The original is cached so
// `retrieve` can return it verbatim. ~4 chars/token heuristic for estimates.

const MIN_TOKENS = 200
const KEEP_ITEMS = 20
const HEAD_CHARS = 1500
const TAIL_CHARS = 500

export const estTokens = (s: string) => Math.max(1, Math.floor(Array.from(s).length / 4))
export const ccrHash = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16)

export interface CompressResult {
  compressed: string
  hash: string | null
  tokensSaved: number
  changed: boolean
}

export function compressContent(s: string): CompressResult {
  if (estTokens(s) < MIN_TOKENS) return { compressed: s, hash: null, tokensSaved: 0, changed: false }
  const hash = ccrHash(s)

  // 1. JSON array of records → keep first N, summarize the rest.
  try {
    const arr = JSON.parse(s)
    if (Array.isArray(arr) && arr.length > KEEP_ITEMS) {
      const summary = {
        _ccr: `<<ccr:${hash}>>`,
        kept: arr.slice(0, KEEP_ITEMS),
        total_items: arr.length,
        dropped_items: arr.length - KEEP_ITEMS,
        note: 'Truncated to save tokens. Call the retrieve tool with the hash for all items.',
      }
      const out = JSON.stringify(summary)
      return { compressed: out, hash, tokensSaved: estTokens(s) - estTokens(out), changed: true }
    }
  } catch { /* not JSON — fall through */ }

  // 2. Large free text / logs → head + tail with a marker.
  const r = Array.from(s)
  if (r.length > HEAD_CHARS + TAIL_CHARS + 200) {
    const out =
      r.slice(0, HEAD_CHARS).join('') +
      `\n…[${r.length - HEAD_CHARS - TAIL_CHARS} chars omitted — retrieve <<ccr:${hash}>> for full content]…\n` +
      r.slice(r.length - TAIL_CHARS).join('')
    return { compressed: out, hash, tokensSaved: estTokens(s) - estTokens(out), changed: true }
  }

  return { compressed: s, hash: null, tokensSaved: 0, changed: false }
}
