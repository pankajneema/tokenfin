'use strict'

// Tiny HTTP client for talking to the TokenFin backend (zero deps).

const http = require('http')
const https = require('https')

function request(method, url, key, body, extraHeaders) {
  return new Promise((resolve) => {
    let u
    try { u = new URL(url) } catch { return resolve({ ok: false, status: 0, why: 'invalid URL: ' + url }) }
    const mod = u.protocol === 'http:' ? http : https
    const headers = Object.assign({ Accept: 'application/json', Authorization: 'Bearer ' + key }, extraHeaders || {})
    let data = null
    if (body) {
      data = JSON.stringify(body)
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = Buffer.byteLength(data)
    }
    const req = mod.request(
      { hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + u.search, method, headers },
      (res) => {
        let buf = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (buf += c))
        res.on('end', () => {
          let json = null
          try { json = JSON.parse(buf) } catch { /* non-JSON body */ }
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json })
        })
      }
    )
    req.on('error', (e) => resolve({ ok: false, status: 0, why: 'could not reach ' + url + (e && e.code ? ' (' + e.code + ')' : '') }))
    req.setTimeout(8000, () => { try { req.destroy() } catch {} ; resolve({ ok: false, status: 0, why: 'timed out reaching ' + url }) })
    if (data) req.write(data)
    req.end()
  })
}

const base = (appUrl) => String(appUrl).replace(/\/$/, '')

async function getConnStatus(appUrl, key, source) {
  const r = await request('GET', base(appUrl) + '/api/v1/connections?source=' + encodeURIComponent(source), key)
  if (!r.ok) return { ok: false, why: r.why || 'HTTP ' + r.status }
  return { ok: true, status: r.json }
}

async function getConnAll(appUrl, key) {
  const r = await request('GET', base(appUrl) + '/api/v1/connections', key)
  if (!r.ok) return { ok: false, why: r.why || 'HTTP ' + r.status }
  return { ok: true, sources: (r.json && r.json.sources) || [] }
}

// Sanity-check a key against the read-only MCP get_spend tool (loud failure at
// setup time instead of silently capturing nothing).
async function verifyKey(appUrl, key) {
  const r = await request('POST', base(appUrl) + '/api/mcp', key,
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_spend', arguments: { days: 1 } } },
    { Accept: 'application/json, text/event-stream' })
  if (r.status === 401) return { ok: false, why: 'the server rejected this key (401). Copy the full raw key from Dashboard → API Keys.' }
  if (!r.ok && r.status >= 400) return { ok: false, why: 'server returned HTTP ' + r.status }
  if (!r.ok) return { ok: false, why: r.why || 'request failed' }
  return { ok: true }
}

module.exports = { request, getConnStatus, getConnAll, verifyKey }
