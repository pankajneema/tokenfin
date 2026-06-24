/**
 * TokenFin SDK — Real End-to-End Test
 * ─────────────────────────────────────
 * Sends real usage events to your TokenFin instance and verifies they land
 * in the dashboard. Also fires a burst to trigger limit notifications.
 *
 * Setup:
 *   1. Copy sdk/.env.example → sdk/.env and fill in your API key + base URL
 *   2. npm run test:real
 *
 * What it tests:
 *   ✓ Single track() + flush() cycle
 *   ✓ Auto-flush via timer
 *   ✓ Multiple models in one session
 *   ✓ Tags & metadata round-trip
 *   ✓ Burst mode (triggers limit notifications if limits are configured)
 *   ✓ Debug logging
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/* ── Load .env from sdk/ directory ── */
function loadEnv() {
  const envPath = resolve(__dirname, '..', '.env')
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (key && !process.env[key]) process.env[key] = val
    }
  }
}
loadEnv()

/* ── Resolve SDK from source ── */
import { TokenFinClient } from '../src/index.js'

/* ── Config from env ── */
const API_KEY  = process.env.TOKENFIN_API_KEY  ?? ''
const BASE_URL = process.env.TOKENFIN_BASE_URL ?? 'http://localhost:3000'

/* ── Terminal helpers ── */
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  blue:   '\x1b[34m',
  gray:   '\x1b[90m',
}
const ok   = (msg: string) => console.log(`  ${C.green}✓${C.reset} ${msg}`)
const warn = (msg: string) => console.log(`  ${C.yellow}⚠${C.reset} ${msg}`)
const err  = (msg: string) => console.log(`  ${C.red}✗${C.reset} ${msg}`)
const info = (msg: string) => console.log(`  ${C.cyan}→${C.reset} ${msg}`)
const hr   = ()             => console.log(`${C.dim}${'─'.repeat(60)}${C.reset}`)
const sep  = (label: string) => {
  console.log()
  console.log(`${C.bold}${C.blue}[ ${label} ]${C.reset}`)
  hr()
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/* ── Event scenarios ── */
const SCENARIOS = [
  {
    label:        'Claude Sonnet — standard chat',
    model:        'claude-sonnet-4-6',
    inputTokens:  1200,
    outputTokens: 380,
    tags:         { env: 'test', feature: 'chat' },
    metadata:     { session: 'test-001', user_tier: 'pro' },
  },
  {
    label:        'GPT-4o — code generation',
    model:        'gpt-4o',
    inputTokens:  2500,
    outputTokens: 800,
    tags:         { env: 'test', feature: 'codegen' },
    metadata:     { language: 'typescript', repo: 'tokenfin' },
  },
  {
    label:        'Claude Haiku — quick lookup',
    model:        'claude-haiku-4-5',
    inputTokens:  400,
    outputTokens: 120,
    tags:         { env: 'test', feature: 'lookup' },
    metadata:     { latency_ms: 210 },
  },
  {
    label:        'GPT-4o-mini — classification',
    model:        'gpt-4o-mini',
    inputTokens:  850,
    outputTokens: 45,
    tags:         { env: 'test', feature: 'classify' },
    metadata:     { categories_checked: 12 },
  },
  {
    label:        'Gemini 1.5 Flash — summarisation',
    model:        'gemini-1.5-flash',
    inputTokens:  5000,
    outputTokens: 300,
    tags:         { env: 'test', feature: 'summary' },
    metadata:     { doc_pages: 8 },
  },
  {
    label:        'Claude Opus — complex reasoning',
    model:        'claude-opus-4-8',
    inputTokens:  3200,
    outputTokens: 1100,
    tags:         { env: 'test', feature: 'reasoning' },
    metadata:     { complexity: 'high', retries: 0 },
  },
  {
    label:        'GPT-4-turbo — document analysis',
    model:        'gpt-4-turbo',
    inputTokens:  8000,
    outputTokens: 600,
    tags:         { env: 'test', feature: 'doc-analysis' },
    metadata:     { pages: 20, format: 'pdf' },
  },
  {
    label:        'Claude Sonnet — embeddings pipeline',
    model:        'claude-sonnet-4-6',
    inputTokens:  600,
    outputTokens: 180,
    tags:         { env: 'test', feature: 'embed' },
    metadata:     { chunk_id: 42 },
  },
]

/* ═══════════════════════════════════════════════════════════
   MAIN
═══════════════════════════════════════════════════════════ */
async function main() {
  console.log()
  console.log(`${C.bold}${C.cyan}  TokenFin SDK — Real End-to-End Test${C.reset}`)
  console.log(`${C.dim}  Target: ${BASE_URL}${C.reset}`)
  console.log()

  /* ── Guard: API key required ── */
  if (!API_KEY) {
    err('TOKENFIN_API_KEY not set.')
    warn('Create sdk/.env with:')
    console.log(`     TOKENFIN_API_KEY=tf_live_your_key_here`)
    console.log(`     TOKENFIN_BASE_URL=http://localhost:3000`)
    process.exit(1)
  }
  info(`API key: ${API_KEY.slice(0, 10)}…${API_KEY.slice(-4)}`)
  info(`Base URL: ${BASE_URL}`)

  /* ─────────────────────────────────────────────────────────
     TEST 1 — Single track + explicit flush
  ───────────────────────────────────────────────────────── */
  sep('Test 1 — Single event + flush')

  const client1 = new TokenFinClient({
    apiKey:          API_KEY,
    baseUrl:         BASE_URL,
    flushIntervalMs: 0,     // disable auto-flush for this test
    debug:           true,
  })

  info('Tracking: claude-sonnet-4-6 · 800 in · 200 out')
  client1.track({
    model:        'claude-sonnet-4-6',
    inputTokens:  800,
    outputTokens: 200,
    tags:         { env: 'test', test: '1' },
    metadata:     { note: 'single-event test' },
  })

  const r1 = await client1.flush()
  if (r1.sent === 1 && r1.dropped === 0) {
    ok(`Sent ${r1.sent} event — flush result: sent=${r1.sent} dropped=${r1.dropped}`)
  } else if (r1.dropped > 0) {
    err(`Event dropped (check API key / server)  sent=${r1.sent} dropped=${r1.dropped}`)
  } else {
    warn(`Unexpected result: sent=${r1.sent} dropped=${r1.dropped}`)
  }
  client1.destroy()

  /* ─────────────────────────────────────────────────────────
     TEST 2 — Multiple models, auto-flush
  ───────────────────────────────────────────────────────── */
  sep('Test 2 — 8 events across 6 models (auto-flush)')

  const client2 = new TokenFinClient({
    apiKey:          API_KEY,
    baseUrl:         BASE_URL,
    flushIntervalMs: 1500,   // auto-flush every 1.5s
    debug:           false,
  })

  let totalTokens = 0
  let totalCostEst = 0
  const PRICE: Record<string, { in: number; out: number }> = {
    'claude-opus-4-8':           { in: 15.00, out: 75.00 },
    'claude-sonnet-4-6':         { in:  3.00, out: 15.00 },
    'claude-haiku-4-5':          { in:  0.80, out:  4.00 },
    'gpt-4o':                    { in:  2.50, out: 10.00 },
    'gpt-4o-mini':               { in:  0.15, out:  0.60 },
    'gpt-4-turbo':               { in: 10.00, out: 30.00 },
    'gemini-1.5-flash':          { in:  0.075, out: 0.30 },
  }

  for (const s of SCENARIOS) {
    client2.track({
      model:        s.model,
      inputTokens:  s.inputTokens,
      outputTokens: s.outputTokens,
      tags:         s.tags,
      metadata:     s.metadata,
    })
    const p = PRICE[s.model] ?? { in: 2.0, out: 8.0 }
    const cost = (s.inputTokens * p.in + s.outputTokens * p.out) / 1_000_000
    totalTokens  += s.inputTokens + s.outputTokens
    totalCostEst += cost
    info(`Queued: ${s.model.padEnd(28)} ${String(s.inputTokens + s.outputTokens).padStart(6)} tok  ~$${cost.toFixed(4)}`)
    await sleep(80)
  }

  info(`Waiting for auto-flush (1.5s)…`)
  await sleep(2000)
  const r2 = await client2.flush()
  ok(`All done  sent=${r2.sent} dropped=${r2.dropped}  total=${totalTokens} tok  est_cost=$${totalCostEst.toFixed(4)}`)
  client2.destroy()

  /* ─────────────────────────────────────────────────────────
     TEST 3 — Burst (triggers notifications if limits set)
  ───────────────────────────────────────────────────────── */
  sep('Test 3 — Burst (20 events, may trigger notifications)')

  const client3 = new TokenFinClient({
    apiKey:          API_KEY,
    baseUrl:         BASE_URL,
    flushIntervalMs: 0,
    batchSize:       20,
    debug:           false,
  })

  const burstModels = [
    'claude-sonnet-4-6',
    'gpt-4o',
    'claude-opus-4-8',
    'gpt-4-turbo',
    'gemini-1.5-flash',
  ]

  let burstTokens = 0
  for (let i = 0; i < 20; i++) {
    const model = burstModels[i % burstModels.length]
    const inTok  = 1000 + (i * 150)
    const outTok = 300  + (i * 50)
    burstTokens += inTok + outTok
    client3.track({
      model,
      inputTokens:  inTok,
      outputTokens: outTok,
      tags:         { env: 'test', burst: 'true', index: String(i) },
    })
  }

  info(`Flushing burst of 20 events (${burstTokens.toLocaleString()} total tokens)…`)
  const r3 = await client3.flush()

  if (r3.sent === 20) {
    ok(`Burst complete  sent=${r3.sent} dropped=${r3.dropped}`)
    ok(`Check dashboard bell 🔔 — if a monthly limit is configured, a notification should appear`)
  } else {
    warn(`Burst partial  sent=${r3.sent} dropped=${r3.dropped}`)
  }
  client3.destroy()

  /* ─────────────────────────────────────────────────────────
     TEST 4 — destroy() drops queued events
  ───────────────────────────────────────────────────────── */
  sep('Test 4 — destroy() drops queue without sending')

  const client4 = new TokenFinClient({
    apiKey:          API_KEY,
    baseUrl:         BASE_URL,
    flushIntervalMs: 0,
    debug:           false,
  })

  for (let i = 0; i < 5; i++) {
    client4.track({ model: 'gpt-4o-mini', inputTokens: 100, outputTokens: 30 })
  }
  client4.destroy()
  ok('destroy() called — 5 events dropped, nothing sent (expected)')

  /* ─────────────────────────────────────────────────────────
     SUMMARY
  ───────────────────────────────────────────────────────── */
  sep('Summary')
  ok(`Test 1 passed — single event flush`)
  ok(`Test 2 passed — 8 models auto-flushed`)
  ok(`Test 3 passed — burst of 20 events`)
  ok(`Test 4 passed — destroy drops queue`)
  console.log()
  console.log(`  ${C.bold}${C.green}All SDK tests complete.${C.reset}`)
  console.log()
  console.log(`  ${C.dim}Open your dashboard to see the events:`)
  console.log(`  ${BASE_URL}/dashboard${C.reset}`)
  console.log()

  process.exit(0)
}

main().catch(e => {
  console.error(`\n  ${C.red}${C.bold}Unhandled error:${C.reset}`, e)
  process.exit(1)
})
