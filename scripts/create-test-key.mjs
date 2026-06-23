#!/usr/bin/env node
/**
 * Creates a test API key directly in Supabase and prints the full raw key.
 * Run from tokenfin/ root:
 *   node scripts/create-test-key.mjs
 */
import crypto from 'crypto'
import https  from 'https'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath }    from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const envFile = resolve(__dir, '../web/.env.local')

// parse .env.local
const env = {}
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.+)$/)
  if (m) env[m[1]] = m[2].trim()
}

const SUPABASE_URL = env['NEXT_PUBLIC_SUPABASE_URL']
const SERVICE_KEY  = env['SUPABASE_SERVICE_ROLE_KEY']

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in web/.env.local')
  process.exit(1)
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url  = new URL(SUPABASE_URL + path)
    const data = body ? JSON.stringify(body) : null
    const opts = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method,
      headers: {
        apikey:          SERVICE_KEY,
        Authorization:   'Bearer ' + SERVICE_KEY,
        'Content-Type':  'application/json',
        Prefer:          'return=representation',
      },
    }
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data)
    const req = https.request(opts, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => resolve({ status: res.statusCode, body: d }))
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

async function main() {
  // 1. Get first org
  const { body: orgsRaw } = await request('GET', '/rest/v1/organizations?select=id,name&limit=1')
  const orgs = JSON.parse(orgsRaw)
  if (!orgs.length) { console.error('No org found in DB'); process.exit(1) }
  const org = orgs[0]

  // 2. Get first project in that org
  const { body: projRaw } = await request('GET', `/rest/v1/projects?select=id,name&org_id=eq.${org.id}&limit=1`)
  const projs = JSON.parse(projRaw)
  if (!projs.length) { console.error('No project found — create one in the UI first'); process.exit(1) }
  const proj = projs[0]

  // 3. Generate key (same algorithm as /api/v1/keys route)
  const segment = proj.id.replace(/-/g, '').slice(0, 4)
  const secret  = crypto.randomBytes(16).toString('hex')
  const rawKey  = `tfk_dev_${segment}_${secret}`
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex')
  const keyPfx  = rawKey.slice(0, 22)

  // 4. Insert into api_keys
  const { status, body: insRaw } = await request('POST', '/rest/v1/api_keys', {
    org_id:     org.id,
    project_id: proj.id,
    name:       'test-curl-key',
    key_hash:   keyHash,
    key_prefix: keyPfx,
    env:        'development',
    scopes:     ['read', 'write'],
    is_active:  true,
  })

  if (status >= 300) {
    console.error('Insert failed', status, insRaw)
    process.exit(1)
  }

  console.log('\n✅  Test API key created!')
  console.log(`   Org:     ${org.name}`)
  console.log(`   Project: ${proj.name}`)
  console.log('\n🔑  FULL RAW KEY — use this in curl:')
  console.log(`\n   ${rawKey}\n`)
  console.log('─'.repeat(60))
  console.log('Hit Go ingest directly (port 8001):')
  console.log(`
curl -X POST http://localhost:8001/v1/ingest \\
  -H "Authorization: Bearer ${rawKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o","input_tokens":800,"output_tokens":200}'
`)
  console.log('Hit Next.js proxy (port 3001):')
  console.log(`
curl -X POST http://localhost:3001/api/v1/ingest \\
  -H "Authorization: Bearer ${rawKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o","input_tokens":800,"output_tokens":200}'
`)
  console.log('─'.repeat(60))
  console.log('⚠  This key is stored. Delete it when done: dashboard → API Keys → Revoke\n')
}

main().catch(e => { console.error(e); process.exit(1) })
