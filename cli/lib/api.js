'use strict'

// Tiny HTTP client for talking to the TokenFin backend (zero deps).

const http = require('http')
const https = require('https')

function request(method, url, key, body, extraHeaders) {
  return new Promise((resolve) => {
    let u
    try { u = new URL(url) } catch { return resolve({ ok: false, status: 0, why: 'invalid URL: ' + url }) }
    const mod = u.protocol === 'http:' ? http : https
    const headers = Object.assign({ Accept: 'application/json' }, key ? { Authorization: 'Bearer ' + key } : {}, extraHeaders || {})
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
const REVOKED = 'key revoked or invalid (401) — run `npx tokenfin@latest login` to get a fresh key for this device'
const INGEST_ONLY = 'this is an ingest-only key (403) — status/doctor/budget need the read key. Run `npx tokenfin@latest login` (stores both), or pass --read-key'
const connWhy = (r) => r.status === 401 ? REVOKED : r.status === 403 ? INGEST_ONLY : (r.why || 'HTTP ' + r.status)

async function getConnStatus(appUrl, key, source) {
  const r = await request('GET', base(appUrl) + '/api/v1/connections?source=' + encodeURIComponent(source), key)
  if (!r.ok) return { ok: false, status: r.status, why: connWhy(r) }
  return { ok: true, status: r.json }
}

async function getConnAll(appUrl, key) {
  const r = await request('GET', base(appUrl) + '/api/v1/connections', key)
  if (!r.ok) return { ok: false, status: r.status, why: connWhy(r) }
  return { ok: true, sources: (r.json && r.json.sources) || [] }
}

// Check an INGEST key the way an agent will use it: an empty OTLP/JSON metrics
// export to the receiver (a no-op server-side). Works for write-only keys,
// which /api/mcp and /api/v1/connections (read scope) would reject.
async function verifyIngestKey(appUrl, key) {
  const r = await request('POST', base(appUrl) + '/api/otel/v1/metrics', key, { resourceMetrics: [] })
  if (r.status === 401) return { ok: false, status: 401, why: 'the server rejected this ingest key (401) — it was revoked, expired, is read-only, or belongs to another workspace. Run `npx tokenfin@latest login`, or pass a key with --key (Dashboard → API Keys).' }
  if (!r.ok && r.status >= 400) return { ok: false, status: r.status, why: 'server returned HTTP ' + r.status }
  if (!r.ok) return { ok: false, status: 0, why: r.why || 'request failed' }
  return { ok: true }
}

// Back-compat name.
const verifyKey = verifyIngestKey

// Exchange a single-use reveal token for this device's keys. The server
// returns { raw_key, kind, ingest_key, read_key } — a split per-device pair
// (ingest + read), a single legacy read+write key (both fields = raw_key), or
// for viewers a read key only (ingest_key null).
async function revealKeys(appUrl, token) {
  const r = await request('POST', base(appUrl) + '/api/v1/keys/reveal', null, { token })
  if (!r.ok || !r.json || !r.json.raw_key) throw new Error((r.json && r.json.error) || r.why || 'could not retrieve the key (HTTP ' + r.status + ')')
  const j = r.json
  const hasSplit = 'ingest_key' in j || 'read_key' in j
  return {
    key: hasSplit ? (j.ingest_key || null) : j.raw_key,
    read_key: hasSplit ? (j.read_key || j.raw_key) : j.raw_key,
    kind: j.kind || 'legacy',
  }
}

// Ask the server to revoke THIS device's key(s). Returns { ok, why }.
// Uses DELETE /api/v1/cli/token (Bearer = the device's own key). Older servers
// without that endpoint answer 404/405 → caller tells the user to revoke in
// Dashboard → API Keys.
async function revokeDeviceKey(appUrl, key, deviceId) {
  const r = await request('DELETE', base(appUrl) + '/api/v1/cli/token', key, { device_id: deviceId || null })
  if (r.ok) return { ok: true }
  if (r.status === 404 || r.status === 405) return { ok: false, unsupported: true, why: 'this TokenFin server has no self-revoke endpoint' }
  if (r.status === 401) return { ok: true, already: true }
  return { ok: false, why: r.why || 'HTTP ' + r.status }
}

module.exports = { request, getConnStatus, getConnAll, verifyKey, verifyIngestKey, revealKeys, revokeDeviceKey, REVOKED, INGEST_ONLY }
