#!/usr/bin/env node
/**
 * TokenFin — Real-World Integration Test
 *
 * Tests:
 *   1. Direct ingest  — sends simulated usage events → visible in dashboard
 *   2. Real Claude    — makes actual Anthropic API call, tracks real tokens
 *
 * Usage:
 *   TOKENFIN_API_KEY=tfk_dev_xxxx \
 *   TOKENFIN_BASE_URL=http://localhost:3000 \
 *   ANTHROPIC_API_KEY=sk-ant-xxxx \        # optional — for real Claude call
 *   node scripts/test-realworld.mjs
 */

// ── ANSI colours ──────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
}
const ok   = (s) => `${C.green}✓${C.reset} ${s}`
const fail = (s) => `${C.red}✗${C.reset} ${s}`
const info = (s) => `${C.blue}→${C.reset} ${s}`
const warn = (s) => `${C.yellow}⚠${C.reset} ${s}`
const head = (s) => `\n${C.bold}${C.cyan}${s}${C.reset}`

// ── Config ────────────────────────────────────────────────────────────────────
const TF_KEY      = process.env.TOKENFIN_API_KEY
const TF_BASE     = (process.env.TOKENFIN_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const ANT_KEY     = process.env.ANTHROPIC_API_KEY
const PROJECT_ID  = process.env.TOKENFIN_PROJECT_ID ?? ''   // optional override

// ── Helpers ───────────────────────────────────────────────────────────────────
async function ingest(payload) {
  const res = await fetch(`${TF_BASE}/api/v1/ingest`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${TF_KEY}`,
    },
    body: JSON.stringify(payload),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body: json }
}

function fmtCost(n) {
  return `$${n.toFixed(6)}`
}

// ── Validation ────────────────────────────────────────────────────────────────
console.log(head('TokenFin — Real-World Test'))
console.log(`${C.dim}${'─'.repeat(52)}${C.reset}`)

if (!TF_KEY) {
  console.log(fail('TOKENFIN_API_KEY is not set'))
  console.log(info('Get your key from: Dashboard → API Keys → Create key'))
  console.log(info('Then run:'))
  console.log(`  ${C.yellow}TOKENFIN_API_KEY=tfk_dev_xxxx node scripts/test-realworld.mjs${C.reset}\n`)
  process.exit(1)
}

console.log(ok(`API key   : ${TF_KEY.slice(0, 16)}…`))
console.log(ok(`Base URL  : ${TF_BASE}`))
if (ANT_KEY) console.log(ok(`Anthropic : set (real Claude call enabled)`))
else         console.log(warn('ANTHROPIC_API_KEY not set — skipping real Claude test'))
if (PROJECT_ID) console.log(ok(`Project ID: ${PROJECT_ID}`))

// ── Test 1: Ping ──────────────────────────────────────────────────────────────
console.log(head('Test 1 — Ingest API health check'))

try {
  const res = await fetch(`${TF_BASE}/api/v1/ingest`)
  const json = await res.json().catch(() => ({}))
  if (json.status === 'ok') {
    console.log(ok(`Ingest endpoint live (${TF_BASE}/api/v1/ingest)`))
  } else {
    console.log(warn(`Unexpected response: ${JSON.stringify(json)}`))
  }
} catch (e) {
  console.log(fail(`Cannot reach ${TF_BASE} — is the app running?`))
  console.log(`  ${C.dim}${e.message}${C.reset}\n`)
  process.exit(1)
}

// ── Test 2: Direct simulated events ──────────────────────────────────────────
console.log(head('Test 2 — Simulated usage events (direct ingest)'))

const simulatedEvents = [
  { model: 'claude-sonnet-4-6',         input_tokens: 1_200, output_tokens:  340, tags: { env: 'test', feature: 'chat'      } },
  { model: 'gpt-4o',                    input_tokens: 2_500, output_tokens:  780, tags: { env: 'test', feature: 'summary'   } },
  { model: 'claude-haiku-4-5-20251001', input_tokens:   400, output_tokens:  120, tags: { env: 'test', feature: 'classify'  } },
  { model: 'gemini-1.5-flash',          input_tokens: 3_100, output_tokens:  900, tags: { env: 'test', feature: 'translate' } },
  { model: 'gpt-4o-mini',               input_tokens:   800, output_tokens:  200, tags: { env: 'test', feature: 'embed'     } },
]

let allOk = true
for (const event of simulatedEvents) {
  const payload = { ...event, ...(PROJECT_ID ? { project_id: PROJECT_ID } : {}) }
  try {
    const r = await ingest(payload)
    if (r.ok) {
      const cost = r.body.cost_usd ?? 0
      console.log(ok(`${event.model.padEnd(32)} ${(event.input_tokens + event.output_tokens).toString().padStart(6)} tok  ${fmtCost(cost)}`))
    } else {
      console.log(fail(`${event.model} → ${r.status}: ${r.body.error ?? JSON.stringify(r.body)}`))
      allOk = false
    }
  } catch (e) {
    console.log(fail(`${event.model} → network error: ${e.message}`))
    allOk = false
  }
}

if (allOk) {
  console.log(`\n${ok('All simulated events ingested — check your dashboard!')}`)
  console.log(info(`Dashboard: ${TF_BASE}/dashboard`))
}

// ── Test 3: Real Claude call ──────────────────────────────────────────────────
if (!ANT_KEY) {
  console.log(head('Test 3 — Real Claude call (skipped)'))
  console.log(warn('Set ANTHROPIC_API_KEY to enable this test'))
} else {
  console.log(head('Test 3 — Real Claude API call + TokenFin tracking'))

  const prompt = 'In one sentence, explain what an LLM cost attribution platform does.'
  console.log(info(`Prompt: "${prompt}"`))

  let claudeRes
  try {
    claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANT_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })
  } catch (e) {
    console.log(fail(`Anthropic API error: ${e.message}`))
    process.exit(1)
  }

  if (!claudeRes.ok) {
    const err = await claudeRes.json().catch(() => ({}))
    console.log(fail(`Anthropic ${claudeRes.status}: ${err.error?.message ?? JSON.stringify(err)}`))
    process.exit(1)
  }

  const claudeData  = await claudeRes.json()
  const reply       = claudeData.content?.[0]?.text ?? '(no text)'
  const inputTok    = claudeData.usage?.input_tokens  ?? 0
  const outputTok   = claudeData.usage?.output_tokens ?? 0

  console.log(ok(`Claude responded:`))
  console.log(`  ${C.white}${reply}${C.reset}`)
  console.log(info(`Usage: ${inputTok} input + ${outputTok} output = ${inputTok + outputTok} tokens`))

  // Now track it in TokenFin
  const trackPayload = {
    model:         'claude-haiku-4-5-20251001',
    input_tokens:  inputTok,
    output_tokens: outputTok,
    tags:          { env: 'test', source: 'real-claude', feature: 'e2e-test' },
    metadata:      { prompt_preview: prompt.slice(0, 80), reply_preview: reply.slice(0, 80) },
    ...(PROJECT_ID ? { project_id: PROJECT_ID } : {}),
  }

  const tfRes = await ingest(trackPayload)
  if (tfRes.ok) {
    console.log(ok(`Tracked in TokenFin! cost=${fmtCost(tfRes.body.cost_usd ?? 0)}, bucket=${tfRes.body.bucket}`))
    console.log(info(`See it live → ${TF_BASE}/dashboard`))
  } else {
    console.log(fail(`TokenFin ingest failed: ${tfRes.status} — ${tfRes.body.error ?? JSON.stringify(tfRes.body)}`))
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${C.dim}${'─'.repeat(52)}${C.reset}`)
console.log(`${C.bold}Done.${C.reset} Open your dashboard to see the data:`)
console.log(`  ${C.cyan}${TF_BASE}/dashboard${C.reset}\n`)
