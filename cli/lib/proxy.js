'use strict'

// TokenFin recorder-proxy. A tiny, fail-open reverse proxy to Anthropic / OpenAI.
// Point any tool's ANTHROPIC_BASE_URL / OPENAI_BASE_URL at it; every LLM call is
// forwarded UNCHANGED and its token usage is recorded to your dashboard. If
// anything in the recording path fails, the original response still passes
// through untouched. The tool's provider key rides through in its normal header
// and is never stored.

const http = require('http')
const https = require('https')
const { readConfig } = require('./config')

const DEFAULT_PORT = 8788

// Route by provider: Anthropic messages vs OpenAI chat/completions.
function providerFor(req) {
  const path = req.url || ''
  if (req.headers['anthropic-version'] || path.startsWith('/v1/messages')) return 'anthropic'
  return 'openai'
}

// Fire record_usage at the MCP endpoint. Fail-open, never throws.
function record(cfg, args) {
  try {
    if (!cfg || !cfg.url || !cfg.key) return
    const u = new URL(cfg.url)
    const lib = u.protocol === 'http:' ? http : https
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'record_usage', arguments: args } })
    const r = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Authorization': 'Bearer ' + cfg.key, 'Content-Length': Buffer.byteLength(body) },
    })
    r.on('error', () => {})
    r.setTimeout(4000, () => { try { r.destroy() } catch {} })
    r.write(body); r.end()
  } catch {}
}

function usageFromJson(provider, json) {
  if (!json || !json.model) return null
  const u = json.usage || {}
  if (provider === 'anthropic') return { model: json.model, input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0, cache_read_tokens: u.cache_read_input_tokens || 0, cache_creation_tokens: u.cache_creation_input_tokens || 0 }
  return { model: json.model, input_tokens: u.prompt_tokens || 0, output_tokens: u.completion_tokens || 0 }
}

// Parse token usage out of a buffered SSE stream (Anthropic message_start/delta,
// or OpenAI's final usage chunk when stream_options.include_usage is set).
function usageFromSSE(provider, text) {
  let model = null, inTok = 0, outTok = 0, cacheR = 0, cacheW = 0, got = false
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('data:')) continue
    const payload = t.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    let o; try { o = JSON.parse(payload) } catch { continue }
    if (provider === 'anthropic') {
      if (o.type === 'message_start' && o.message) {
        model = o.message.model || model
        const mu = o.message.usage || {}
        inTok = mu.input_tokens || inTok; cacheR = mu.cache_read_input_tokens || cacheR; cacheW = mu.cache_creation_input_tokens || cacheW; got = true
      }
      if (o.type === 'message_delta' && o.usage) { outTok = o.usage.output_tokens || outTok; got = true }
    } else {
      if (o.model) model = o.model
      if (o.usage) { inTok = o.usage.prompt_tokens || inTok; outTok = o.usage.completion_tokens || outTok; got = true }
    }
  }
  if (!got || !model) return null
  return provider === 'anthropic'
    ? { model, input_tokens: inTok, output_tokens: outTok, cache_read_tokens: cacheR, cache_creation_tokens: cacheW }
    : { model, input_tokens: inTok, output_tokens: outTok }
}

function runProxy(flags = {}) {
  const cfg = { ...readConfig() }
  if (flags.key) cfg.key = flags.key
  if (flags.url) cfg.url = flags.url
  if (!cfg.key || !cfg.url) throw new Error('not signed in. Run `tokenfin login` first, or pass --key/--url.')

  const port = parseInt(flags.port || process.env.TOKENFIN_PROXY_PORT || DEFAULT_PORT, 10)
  // host[:port] override — for self-hosted gateways or tests.
  const override = flags.upstream || process.env.TOKENFIN_PROXY_UPSTREAM || ''

  const server = http.createServer((cReq, cRes) => {
    const provider = providerFor(cReq)
    let host = provider === 'anthropic' ? 'api.anthropic.com' : 'api.openai.com'
    let uport = 443, ulib = https
    if (override) {
      const [h, p] = override.split(':'); host = h; if (p) uport = parseInt(p, 10)
      if (host === '127.0.0.1' || host === 'localhost') { ulib = http; if (!p) uport = 80 }
    }

    const headers = { ...cReq.headers, host }
    delete headers['accept-encoding'] // keep bodies parseable (no gzip)

    const uReq = ulib.request({ host, port: uport, path: cReq.url, method: cReq.method, headers }, uRes => {
      cRes.writeHead(uRes.statusCode || 502, uRes.headers)
      const isStream = String(uRes.headers['content-type'] || '').includes('text/event-stream')
      const chunks = []; let size = 0
      uRes.on('data', d => {
        cRes.write(d) // pass through immediately — zero added latency
        if (size < 4_000_000) { chunks.push(d); size += d.length } // bounded tee for parsing
      })
      uRes.on('end', () => {
        cRes.end()
        try {
          const buf = Buffer.concat(chunks).toString('utf8')
          const usage = isStream ? usageFromSSE(provider, buf) : (() => { try { return usageFromJson(provider, JSON.parse(buf)) } catch { return null } })()
          if (usage && usage.model) record(cfg, usage)
        } catch {}
      })
    })
    uReq.on('error', () => { try { cRes.writeHead(502); cRes.end('upstream error') } catch {} })
    cReq.pipe(uReq)
  })

  server.on('error', e => { throw e })
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`\nTokenFin proxy running → http://127.0.0.1:${port}\n`)
    process.stdout.write('Point your AI tool at it — every call is recorded automatically (fail-open):\n')
    process.stdout.write(`  Anthropic:  ANTHROPIC_BASE_URL=http://127.0.0.1:${port}\n`)
    process.stdout.write(`  OpenAI:     OPENAI_BASE_URL=http://127.0.0.1:${port}/v1\n`)
    process.stdout.write(`Recording to ${cfg.url}. Press Ctrl-C to stop.\n\n`)
  })
  return server
}

module.exports = { runProxy, usageFromJson, usageFromSSE, providerFor }
