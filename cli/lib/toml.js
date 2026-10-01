'use strict'

// Minimal TOML reader (zero deps) — enough to show ~/.codex/config.toml as
// JSON on the Agents page and to verify our own targeted edits parse.
// Supports: tables, array-of-tables, dotted / quoted keys, basic / literal /
// multi-line strings, integers, floats, booleans, arrays (multi-line, trailing
// commas, comments), inline tables. Dates/times are kept as strings.
// Throws Error('line N: …') on malformed input.

function parseToml(text) {
  const src = String(text || '').replace(/\r\n/g, '\n')
  let i = 0
  const root = {}
  let cur = root
  const lineNo = () => src.slice(0, i).split('\n').length
  const fail = (m) => { throw new Error('line ' + lineNo() + ': ' + m) }
  const peek = (k = 0) => src[i + k]
  const skipWs = () => { while (i < src.length && (src[i] === ' ' || src[i] === '\t')) i++ }
  const skipComment = () => { if (src[i] === '#') while (i < src.length && src[i] !== '\n') i++ }
  const skipAll = () => { for (;;) { skipWs(); skipComment(); if (src[i] === '\n') { i++; continue } break } }
  const endOfLine = () => { skipWs(); skipComment(); if (i < src.length && src[i] !== '\n') fail('expected end of line'); i++ }

  function basicString() {
    i++ // "
    let out = ''
    while (i < src.length && src[i] !== '"') {
      if (src[i] === '\n') fail('newline in string')
      if (src[i] === '\\') { out += escape(); continue }
      out += src[i++]
    }
    if (src[i] !== '"') fail('unterminated string')
    i++
    return out
  }
  function escape() {
    i++ // backslash
    const c = src[i++]
    const map = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' }
    if (c in map) return map[c]
    if (c === 'u' || c === 'U') {
      const len = c === 'u' ? 4 : 8
      const hex = src.slice(i, i + len)
      if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== len) fail('bad unicode escape')
      i += len
      return String.fromCodePoint(parseInt(hex, 16))
    }
    if (c === '\n' || c === ' ' || c === '\t') { // line-ending backslash (multi-line only)
      while (i < src.length && /[\s]/.test(src[i])) i++
      return ''
    }
    return fail('bad escape \\' + c)
  }
  function multiBasic() {
    i += 3
    if (src[i] === '\n') i++
    let out = ''
    while (i < src.length && src.slice(i, i + 3) !== '"""') {
      if (src[i] === '\\') { out += escape(); continue }
      out += src[i++]
    }
    if (src.slice(i, i + 3) !== '"""') fail('unterminated """ string')
    i += 3
    while (src[i] === '"') { out += '"'; i++ }
    return out
  }
  function literal() {
    i++
    const end = src.indexOf("'", i)
    const nl = src.indexOf('\n', i)
    if (end === -1 || (nl !== -1 && nl < end)) fail('unterminated literal string')
    const out = src.slice(i, end)
    i = end + 1
    return out
  }
  function multiLiteral() {
    i += 3
    if (src[i] === '\n') i++
    const end = src.indexOf("'''", i)
    if (end === -1) fail("unterminated ''' string")
    const out = src.slice(i, end)
    i = end + 3
    return out
  }
  function key() {
    skipWs()
    if (src[i] === '"') return basicString()
    if (src[i] === "'") return literal()
    const m = /^[A-Za-z0-9_-]+/.exec(src.slice(i))
    if (!m) fail('expected a key')
    i += m[0].length
    return m[0]
  }
  function keyPath() {
    const parts = [key()]
    for (;;) { skipWs(); if (src[i] !== '.') break; i++; parts.push(key()) }
    return parts
  }
  function value() {
    skipWs()
    const c = src[i]
    if (src.startsWith('"""', i)) return multiBasic()
    if (src.startsWith("'''", i)) return multiLiteral()
    if (c === '"') return basicString()
    if (c === "'") return literal()
    if (c === '[') {
      i++
      const arr = []
      for (;;) {
        skipAll()
        if (src[i] === ']') { i++; return arr }
        arr.push(value())
        skipAll()
        if (src[i] === ',') { i++; continue }
        if (src[i] === ']') { i++; return arr }
        fail('expected , or ] in array')
      }
    }
    if (c === '{') {
      i++
      const obj = {}
      skipWs()
      if (src[i] === '}') { i++; return obj }
      for (;;) {
        const kp = keyPath()
        skipWs(); if (src[i] !== '=') fail('expected ='); i++
        assign(obj, kp, value())
        skipWs()
        if (src[i] === ',') { i++; continue }
        if (src[i] === '}') { i++; return obj }
        fail('expected , or } in inline table')
      }
    }
    const m = /^[0-9A-Za-z_:.+\-]+/.exec(src.slice(i))
    if (!m) fail('expected a value')
    i += m[0].length
    const t = m[0]
    if (t === 'true') return true
    if (t === 'false') return false
    if (/^[+-]?(inf|nan)$/.test(t)) return t.includes('nan') ? NaN : (t.startsWith('-') ? -Infinity : Infinity)
    const clean = t.replace(/_/g, '')
    if (/^[+-]?\d+$/.test(clean)) return Number(clean)
    if (/^0x[0-9a-f]+$/i.test(clean)) return parseInt(clean, 16)
    if (/^0o[0-7]+$/.test(clean)) return parseInt(clean.slice(2), 8)
    if (/^0b[01]+$/.test(clean)) return parseInt(clean.slice(2), 2)
    if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(clean)) return Number(clean)
    // date / time / datetime: a following " HH:MM" belongs to the same value
    if (/^\d{4}-\d{2}-\d{2}$/.test(t) && src[i] === ' ' && /^\d{2}:/.test(src.slice(i + 1))) {
      const rest = /^ [0-9:.+\-Z]+/.exec(src.slice(i))
      if (rest) { i += rest[0].length; return t + rest[0] }
    }
    if (/^\d{4}-\d{2}-\d{2}|^\d{2}:\d{2}/.test(t)) return t
    return fail('invalid value ' + t)
  }
  function assign(obj, kp, v) {
    let o = obj
    for (let k = 0; k < kp.length - 1; k++) {
      if (o[kp[k]] === undefined) o[kp[k]] = {}
      else if (typeof o[kp[k]] !== 'object' || Array.isArray(o[kp[k]])) fail('key ' + kp.slice(0, k + 1).join('.') + ' is not a table')
      o = o[kp[k]]
    }
    const last = kp[kp.length - 1]
    if (Object.prototype.hasOwnProperty.call(o, last)) fail('duplicate key ' + kp.join('.'))
    o[last] = v
  }
  function table(kp, isArray) {
    let o = root
    for (let k = 0; k < kp.length; k++) {
      const part = kp[k]
      const last = k === kp.length - 1
      if (last && isArray) {
        if (o[part] === undefined) o[part] = []
        if (!Array.isArray(o[part])) fail('key ' + kp.join('.') + ' is not an array of tables')
        const t = {}
        o[part].push(t)
        return t
      }
      if (o[part] === undefined) o[part] = {}
      let next = o[part]
      if (Array.isArray(next)) next = next[next.length - 1]
      if (!next || typeof next !== 'object') fail('key ' + kp.slice(0, k + 1).join('.') + ' is not a table')
      o = next
    }
    return o
  }

  for (;;) {
    skipAll()
    if (i >= src.length) break
    if (src[i] === '[') {
      const isArray = peek(1) === '['
      i += isArray ? 2 : 1
      const kp = keyPath()
      skipWs()
      if (isArray ? src.slice(i, i + 2) !== ']]' : src[i] !== ']') fail('expected ]')
      i += isArray ? 2 : 1
      cur = table(kp, isArray)
      endOfLine()
      continue
    }
    const kp = keyPath()
    skipWs()
    if (src[i] !== '=') fail('expected =')
    i++
    assign(cur, kp, value())
    endOfLine()
  }
  return root
}

module.exports = { parseToml }
