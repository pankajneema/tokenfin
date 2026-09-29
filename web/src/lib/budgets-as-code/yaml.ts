/**
 * A small, dependency-free YAML *subset* parser — enough for
 * tokenfin-budgets.yaml, with clear line-numbered errors for anything else.
 *
 * Supported: block mappings and sequences (by indentation, spaces only),
 * "- key: value" sequence items, inline flow lists `[a, b]` and flat flow maps
 * `{a: 1}`, plain / 'single' / "double" quoted scalars, numbers, booleans,
 * null / ~, comments (#) and a leading `---`.
 * Not supported (rejected): anchors/aliases, tags, multi-line strings (| >),
 * multiple documents, tabs for indentation.
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | { [k: string]: YamlValue }

export class YamlError extends Error {
  constructor(message: string, readonly line: number) {
    super(`line ${line}: ${message}`)
    this.name = 'YamlError'
  }
}

interface Line { indent: number; text: string; no: number }

/** Remove a trailing comment that is outside quotes. */
function stripComment(s: string): string {
  let q: string | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (q === '"' && c === '\\') { i++; continue }
      if (c === q) q = null
    } else if (c === '"' || c === "'") {
      q = c
    } else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
      return s.slice(0, i).trimEnd()
    }
  }
  return s.trimEnd()
}

function lex(src: string): Line[] {
  const out: Line[] = []
  const raw = src.replace(/^﻿/, '').split(/\r?\n/)
  let docs = 0
  raw.forEach((l, idx) => {
    const no = idx + 1
    if (/^\t/.test(l) || /^ *\t/.test(l)) throw new YamlError('tabs are not allowed for indentation', no)
    const text = stripComment(l)
    if (!text.trim()) return
    if (text.trim() === '---') {
      if (++docs > 1 || out.length > 0) throw new YamlError('only a single YAML document is supported', no)
      return
    }
    if (text.trim() === '...') return
    const indent = text.length - text.trimStart().length
    out.push({ indent, text: text.trim(), no })
  })
  return out
}

/** Split on commas at depth 0 outside quotes. */
function splitFlow(s: string, no: number): string[] {
  const parts: string[] = []
  let depth = 0, q: string | null = null, cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      cur += c
      if (q === '"' && c === '\\') { cur += s[++i] ?? ''; continue }
      if (c === q) q = null
      continue
    }
    if (c === '"' || c === "'") { q = c; cur += c; continue }
    if (c === '[' || c === '{') depth++
    if (c === ']' || c === '}') depth--
    if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (q || depth !== 0) throw new YamlError('unterminated flow collection', no)
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

/** Index of the "key: value" separator outside quotes, or -1. */
function keySep(s: string): number {
  let q: string | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (q === '"' && c === '\\') { i++; continue }
      if (c === q) q = null
      continue
    }
    if ((c === '"' || c === "'") && i === 0) { q = c; continue }
    if (c === ':' && (i === s.length - 1 || s[i + 1] === ' ')) return i
    if ((c === '[' || c === '{') && i === 0) return -1
  }
  return -1
}

export function parseScalar(raw: string, no: number): YamlValue {
  const s = raw.trim()
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null
  if (/^[&*!|>]/.test(s)) throw new YamlError(`unsupported YAML feature "${s[0]}"`, no)
  if (s.startsWith('[')) {
    if (!s.endsWith(']')) throw new YamlError('unterminated flow list', no)
    return splitFlow(s.slice(1, -1), no).map(p => parseScalar(p, no))
  }
  if (s.startsWith('{')) {
    if (!s.endsWith('}')) throw new YamlError('unterminated flow map', no)
    const obj: Record<string, YamlValue> = {}
    for (const p of splitFlow(s.slice(1, -1), no)) {
      const i = keySep(p)
      if (i < 0) throw new YamlError(`expected "key: value" in flow map, got "${p}"`, no)
      obj[unquoteKey(p.slice(0, i), no)] = parseScalar(p.slice(i + 1), no)
    }
    return obj
  }
  if (s.startsWith('"')) {
    if (!s.endsWith('"') || s.length < 2) throw new YamlError('unterminated double-quoted string', no)
    try { return JSON.parse(s) as string } catch { throw new YamlError('invalid double-quoted string', no) }
  }
  if (s.startsWith("'")) {
    if (!s.endsWith("'") || s.length < 2) throw new YamlError('unterminated single-quoted string', no)
    return s.slice(1, -1).replace(/''/g, "'")
  }
  if (/^(true|True|TRUE|yes|on)$/.test(s)) return true
  if (/^(false|False|FALSE|no|off)$/.test(s)) return false
  if (/^[-+]?(\d[\d_]*)(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return Number(s.replace(/_/g, ''))
  if (/^[-+]?\.\d+$/.test(s)) return Number(s)
  return s
}

function unquoteKey(k: string, no: number): string {
  const v = parseScalar(k, no)
  if (v === null || typeof v === 'object') throw new YamlError(`invalid key "${k}"`, no)
  return String(v)
}

const isSeqItem = (t: string) => t === '-' || t.startsWith('- ')

export function parseYaml(src: string): YamlValue {
  const lines = lex(src)
  let i = 0

  function block(indent: number): YamlValue {
    return isSeqItem(lines[i].text) ? seq(indent) : map(indent)
  }

  function seq(indent: number): YamlValue[] {
    const out: YamlValue[] = []
    while (i < lines.length && lines[i].indent === indent && isSeqItem(lines[i].text)) {
      const ln = lines[i]
      const rest = ln.text === '-' ? '' : ln.text.slice(2).trimStart()
      if (!rest) {
        i++
        if (i < lines.length && lines[i].indent > indent) out.push(block(lines[i].indent))
        else out.push(null)
        continue
      }
      const offset = ln.text.length - rest.length
      if (isSeqItem(rest) || keySep(rest) >= 0) {
        // "- key: v" / "- - x": re-read the remainder as a nested block at its own column.
        lines[i] = { indent: indent + offset, text: rest, no: ln.no }
        out.push(block(indent + offset))
      } else {
        out.push(parseScalar(rest, ln.no)); i++
      }
    }
    return out
  }

  function map(indent: number): Record<string, YamlValue> {
    const out: Record<string, YamlValue> = {}
    while (i < lines.length && lines[i].indent === indent && !isSeqItem(lines[i].text)) {
      const ln = lines[i]
      const sep = keySep(ln.text)
      if (sep < 0) throw new YamlError(`expected "key: value", got "${ln.text}"`, ln.no)
      const key = unquoteKey(ln.text.slice(0, sep), ln.no)
      if (Object.prototype.hasOwnProperty.call(out, key)) throw new YamlError(`duplicate key "${key}"`, ln.no)
      const rest = ln.text.slice(sep + 1).trim()
      i++
      if (rest) {
        out[key] = parseScalar(rest, ln.no)
      } else if (i < lines.length && lines[i].indent > indent) {
        out[key] = block(lines[i].indent)
      } else if (i < lines.length && lines[i].indent === indent && isSeqItem(lines[i].text)) {
        out[key] = seq(indent)                    // "key:\n- a" (sequence at the key's indent)
      } else {
        out[key] = null
      }
    }
    return out
  }

  if (lines.length === 0) return null
  const root = block(lines[0].indent)
  if (i < lines.length) throw new YamlError(`unexpected indentation or content "${lines[i].text}"`, lines[i].no)
  return root
}
