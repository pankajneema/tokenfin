#!/usr/bin/env node
// TokenFin auto-record Stop hook. Reads the finished turn's token usage from the
// session transcript and POSTs it to record_usage. Fail-open & silent (exit 0).
// Installed by `tokenfin setup` into ~/.claude/tokenfin-record-usage.js.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), https = require('https')
const done = () => process.exit(0)
let input = ''
try { input = fs.readFileSync(0, 'utf8') } catch { done() }
let payload; try { payload = JSON.parse(input) } catch { done() }
const transcript = payload.transcript_path, sid = payload.session_id || 'unknown'
if (!transcript || !fs.existsSync(transcript)) done()
let cfg; try { cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'tokenfin-hook.json'), 'utf8')) } catch { done() }
if (!cfg || !cfg.url || !cfg.key) done()
const stateDir = path.join(os.homedir(), '.claude', 'tokenfin-hook-state')
try { fs.mkdirSync(stateDir, { recursive: true }) } catch {}
const statePath = path.join(stateDir, sid + '.offset')
let offset = 0; try { offset = parseInt(fs.readFileSync(statePath, 'utf8'), 10) || 0 } catch {}
const lines = fs.readFileSync(transcript, 'utf8').split('\n').filter(Boolean)
if (lines.length <= offset) done()
// Count cache tokens separately — they're priced very differently (reads ~10%,
// writes ~125% of the input rate); lumping them inflated recorded cost ~5x.
let inTok = 0, outTok = 0, cacheRd = 0, cacheWr = 0, model = null
for (let i = offset; i < lines.length; i++) {
  let o; try { o = JSON.parse(lines[i]) } catch { continue }
  if (o.type === 'assistant' && o.message && o.message.usage) {
    const u = o.message.usage
    inTok   += (u.input_tokens || 0)
    cacheWr += (u.cache_creation_input_tokens || 0)
    cacheRd += (u.cache_read_input_tokens || 0)
    outTok  += (u.output_tokens || 0)
    if (o.message.model) model = o.message.model
  }
}
if (!model || (inTok === 0 && outTok === 0 && cacheRd === 0 && cacheWr === 0)) {
  try { fs.writeFileSync(statePath, String(lines.length)) } catch {}
  done()
}
const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'record_usage', arguments: {
  model, input_tokens: inTok, output_tokens: outTok, cache_read_tokens: cacheRd, cache_creation_tokens: cacheWr,
  event_id: sid + ':' + offset + '-' + lines.length, // idempotency: dedupes an identical resent range
} } })
let u; try { u = new URL(cfg.url) } catch { done() }
const mod = u.protocol === 'http:' ? http : https // support self-hosted / local http endpoints
const req = mod.request({ hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + u.search, method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Authorization': 'Bearer ' + cfg.key, 'Content-Length': Buffer.byteLength(body) } },
  res => {
    res.resume()
    res.on('end', () => {
      // Advance the offset ONLY on success — a failed send retries next turn
      // instead of silently losing the usage forever.
      if (res.statusCode && res.statusCode < 300) { try { fs.writeFileSync(statePath, String(lines.length)) } catch {} }
      done()
    })
  })
req.on('error', done)
req.setTimeout(4000, () => { try { req.destroy() } catch {}; done() })
req.write(body); req.end()
