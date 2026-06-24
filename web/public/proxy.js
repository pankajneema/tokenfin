#!/usr/bin/env node
/**
 * TokenFin Usage Proxy — with full debug logging
 */
const http = require('http')
const net  = require('net')

const PROXY_PORT    = parseInt(process.env.PROXY_PORT    || '7070')
const UPSTREAM_HOST = process.env.UPSTREAM_HOST          || '127.0.0.1'
const UPSTREAM_PORT = parseInt(process.env.UPSTREAM_PORT || '6767')
const TOKENFIN_KEY  = process.env.TOKENFIN_API_KEY       || 'tfk_prod_eafa_119033f4390c03da82e32f6be48258de'
const TOKENFIN_URL  = (process.env.TOKENFIN_BASE_URL     || 'https://tokenfin.curiousdevs.com') + '/api/v1/ingest'

let reqCount = 0

function log(...args) { console.log(new Date().toISOString(), ...args) }

// ── Prompt fingerprinting (no raw text stored) ────────────────────────────────
// djb2 hash over the first 500 chars of the concatenated prompt text.
// Same prompt → same hash. Lets analytics group expensive/slow patterns
// without storing anything sensitive.
function djb2Hash(str) {
  let hash = 5381
  const len = Math.min(str.length, 500)
  for (let i = 0; i < len; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i)
    hash = hash >>> 0   // keep as unsigned 32-bit
  }
  return hash.toString(16).padStart(8, '0')
}

function extractPromptMeta(parsed) {
  if (!parsed) return {}
  try {
    // Chat completions format: messages[]
    const messages = parsed.messages || parsed.input || []
    if (!Array.isArray(messages) || messages.length === 0) return {}

    const text = messages
      .map(m => (typeof m.content === 'string' ? m.content : ''))
      .join(' ')

    return {
      prompt_chars:       text.length,
      prompt_hash:        djb2Hash(text),
      messages_count:     messages.length,
      has_system_prompt:  messages.some(m => m.role === 'system'),
    }
  } catch {
    return {}
  }
}

// ── Send usage to TokenFin ────────────────────────────────────────────────────
function track(model, inputTokens, outputTokens, extraMeta = {}) {
  if (!inputTokens && !outputTokens) return
  const payload = JSON.stringify({
    model: model || 'unknown',
    input_tokens:  inputTokens  || 0,
    output_tokens: outputTokens || 0,
    tags:     { tool: 'codex' },
    metadata: extraMeta,
  })
  const u    = new URL(TOKENFIN_URL)
  const isHttps = u.protocol === 'https:'
  const transport = isHttps ? require('https') : http
  const req = transport.request({
    hostname: u.hostname,
    port:     parseInt(u.port) || (isHttps ? 443 : 80),
    path:     u.pathname,
    method:   'POST',
    headers: {
      'Content-Type':   'application/json',
      'Authorization':  `Bearer ${TOKENFIN_KEY}`,
      'Content-Length': Buffer.byteLength(payload),
    },
  })
  req.on('response', res => {
    res.resume()
    log(`✅ TRACKED: ${model} in=${inputTokens} out=${outputTokens} → ingest:${res.statusCode}`)
  })
  req.on('error', e => log('❌ ingest error:', e.message))
  req.write(payload)
  req.end()
}

function extractFromStream(text) {
  for (const line of text.split('\n').reverse()) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
    try {
      const d = JSON.parse(line.slice(6))
      if (d.usage?.prompt_tokens != null)
        return { model: d.model, input: d.usage.prompt_tokens, output: d.usage.completion_tokens || 0 }
    } catch {}
  }
  return null
}

// ── HTTP proxy ────────────────────────────────────────────────────────────────
const server = http.createServer((clientReq, clientRes) => {
  const id = ++reqCount
  log(`[${id}] HTTP ${clientReq.method} ${clientReq.url}`)

  const chunks = []
  const reqStart = Date.now()   // capture before any async work
  clientReq.on('data', c => chunks.push(c))
  clientReq.on('end', () => {
    let bodyBuf = Buffer.concat(chunks)
    let parsed  = null
    // Match both /chat/completions and /responses (OpenAI Responses API used by Codex)
    const isCompletions = clientReq.url.includes('/chat/completions') || clientReq.url.includes('/responses')

    if (isCompletions && bodyBuf.length) {
      try {
        parsed = JSON.parse(bodyBuf.toString())
        log(`[${id}] model=${parsed.model} stream=${parsed.stream}`)
        if (parsed.stream && clientReq.url.includes('/chat/completions')) {
          parsed.stream_options = { ...(parsed.stream_options || {}), include_usage: true }
          bodyBuf = Buffer.from(JSON.stringify(parsed))
        }
      } catch {}
    }

    const upstreamReq = http.request({
      hostname: UPSTREAM_HOST,
      port:     UPSTREAM_PORT,
      path:     clientReq.url,
      method:   clientReq.method,
      headers:  { ...clientReq.headers, host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}`, 'content-length': bodyBuf.length },
    }, upstreamRes => {
      log(`[${id}] upstream responded: ${upstreamRes.statusCode}`)
      clientRes.writeHead(upstreamRes.statusCode, upstreamRes.headers)

      if (!isCompletions) { upstreamRes.pipe(clientRes); return }

      const modelHint = parsed?.model || 'unknown'
      let accumulated = ''
      upstreamRes.on('data', chunk => { clientRes.write(chunk); accumulated += chunk.toString() })
      upstreamRes.on('end', () => {
        clientRes.end()
        const latency_ms   = Date.now() - reqStart
        const promptMeta   = extractPromptMeta(parsed)

        // Try to extract usage from SSE stream (both /responses and /chat/completions formats)
        if (parsed?.stream || accumulated.includes('data:')) {
          // /responses API: look for response.completed or response.done event
          for (const line of accumulated.split('\n').reverse()) {
            if (!line.startsWith('data:')) continue
            const raw = line.slice(line.indexOf(':') + 1).trim()
            if (!raw || raw === '[DONE]') continue
            try {
              const d = JSON.parse(raw)
              // Responses API: event has usage at top level or nested in response
              const usage = d.usage || d.response?.usage
              if (usage) {
                const input  = usage.input_tokens  ?? usage.prompt_tokens     ?? 0
                const output = usage.output_tokens ?? usage.completion_tokens ?? 0
                const model  = d.model || d.response?.model || modelHint
                if (input || output) {
                  track(model, input, output, { latency_ms, ...promptMeta })
                  break
                }
              }
            } catch {}
          }
        } else {
          // Non-streaming: parse full JSON body
          try {
            const d = JSON.parse(accumulated)
            const usage = d.usage || d.response?.usage
            if (usage) {
              const input  = usage.input_tokens  ?? usage.prompt_tokens     ?? 0
              const output = usage.output_tokens ?? usage.completion_tokens ?? 0
              track(d.model || modelHint, input, output, { latency_ms, ...promptMeta })
            } else {
              log(`[${id}] no usage in response — body:`, accumulated.slice(0, 300))
            }
          } catch {
            log(`[${id}] response not JSON — first 200:`, accumulated.slice(0, 200))
          }
        }
      })
    })

    // Headroom upgrades HTTP → WebSocket (server-side upgrade)
    upstreamReq.on('upgrade', (upstreamRes, upstreamSocket, head) => {
      log(`[${id}] upstream upgraded to WebSocket — tunneling`)
      const clientSocket = clientReq.socket
      let raw = `HTTP/1.1 101 Switching Protocols\r\n`
      for (let i = 0; i < upstreamRes.rawHeaders.length; i += 2)
        raw += `${upstreamRes.rawHeaders[i]}: ${upstreamRes.rawHeaders[i+1]}\r\n`
      raw += '\r\n'
      clientSocket.write(raw)
      if (head?.length) clientSocket.write(head)
      upstreamSocket.pipe(clientSocket)
      clientSocket.pipe(upstreamSocket)
    })

    upstreamReq.on('error', err => {
      log(`[${id}] upstream error:`, err.message)
      if (!clientRes.headersSent) clientRes.writeHead(502)
      clientRes.end(JSON.stringify({ error: err.message }))
    })

    upstreamReq.write(bodyBuf)
    upstreamReq.end()
  })
})

// ── Client-side WebSocket upgrade ─────────────────────────────────────────────
server.on('upgrade', (req, socket, head) => {
  const id = ++reqCount
  log(`[${id}] WebSocket upgrade: ${req.url}`)

  const upstreamSocket = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`
    for (let i = 0; i < req.rawHeaders.length; i += 2)
      raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i+1]}\r\n`
    raw += '\r\n'
    upstreamSocket.write(raw)
    if (head?.length) upstreamSocket.write(head)
    upstreamSocket.pipe(socket)
    socket.pipe(upstreamSocket)
    log(`[${id}] WebSocket tunnel active`)
  })

  upstreamSocket.on('error', err => { log(`[${id}] WS tunnel error:`, err.message); socket.destroy() })
  socket.on('error', () => upstreamSocket.destroy())
  socket.on('close', () => upstreamSocket.destroy())
})

server.listen(PROXY_PORT, '127.0.0.1', () => {
  log(`✅ Proxy on 127.0.0.1:${PROXY_PORT} → ${UPSTREAM_HOST}:${UPSTREAM_PORT}`)
  log(`   TokenFin: ${TOKENFIN_URL}`)
})
