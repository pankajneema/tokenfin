/**
 * OTLP records → usage rows.
 *
 * Per-turn attribution comes from the LOGS stream: Claude Code emits a
 * `claude_code.api_request` event per API call carrying model, token counts,
 * cost, and correlation ids. Metrics (`claude_code.token.usage` etc.) are
 * cumulative counters of the SAME tokens — using them too would double-count —
 * so /v1/metrics is health-only (temporality + unrecognized-name checks).
 */
import crypto from 'crypto'
import { attrVal, attrsToMap, nanoToIso, num } from './attrs'
import { detectSource, costBasisFor, isRecognizedMetric, isDeltaTemporality, warnUnrecognizedMetric } from './mapping'
import { computeCost } from '@/lib/mcp/pricing'
import type { KeyCtx } from './auth'

export interface UsageRow {
  event_id: string
  ts: string
  source: string
  provider_request_id: string | null
  correlation_id: string | null
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  cost_usd: number
  cost_basis: string
  user_email: string | null
  session_id: string | null
  actor_id?: string | null
  actor_name?: string | null
  tool_name?: string | null
  provider?: string | null
  prompt_hash?: string | null
  prompt_preview?: string | null
  prompt_chars?: number | null
  prompt_text?: string | null
  latency_ms?: number | null
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

/** Extract usage rows from an OTLP logs payload (JSON or decoded protobuf). */
export function normalizeLogs(body: any, _ctx: KeyCtx): UsageRow[] {
  const rows: UsageRow[] = []
  let idx = 0
  for (const rl of body?.resourceLogs ?? []) {
    const resAttrs = attrsToMap(rl?.resource?.attributes ?? [])
    for (const sl of rl?.scopeLogs ?? []) {
      for (const rec of sl?.logRecords ?? []) {
        const a = attrsToMap(rec?.attributes ?? [])
        // Agent/account identity is commonly exported on the OTLP resource,
        // while token counts live on the individual record. Merge both so
        // changing Claude/Codex accounts cannot silently lose attribution.
        const identity = { ...resAttrs, ...a }
        const eventName = String(rec?.eventName ?? a['event.name'] ?? '')
        const model = String(a['model'] ?? a['gen_ai.request.model'] ?? identity['model'] ?? '')

        const input  = Math.max(0, num(a['input_tokens'] ?? a['gen_ai.usage.input_tokens']))
        const output = Math.max(0, num(a['output_tokens'] ?? a['gen_ai.usage.output_tokens']))
        const cacheR = Math.max(0, num(a['cache_read_tokens']))
        const cacheW = Math.max(0, num(a['cache_creation_tokens'] ?? a['cache_write_tokens']))
        const reason = Math.max(0, num(a['reasoning_tokens']))

        // Only turn-bearing events: has a model and some tokens. Skips prompts,
        // tool results, errors, refusals — none of which carry token counts.
        if (!model || (input + output + cacheR + cacheW) <= 0) continue
        if (/error|refusal/.test(eventName)) continue

        const source = detectSource(resAttrs, eventName || model)
        const userEmail = String(identity['user.email'] ?? identity['user_email'] ?? identity['email'] ?? '') || null
        const actorId = String(identity['user.id'] ?? identity['user_id'] ?? identity['account.id'] ?? identity['account_id'] ?? '') || null
        const actorName = String(identity['user.name'] ?? identity['user.username'] ?? identity['username'] ?? '') || null
        const toolName = String(identity['tool.name'] ?? identity['client.name'] ?? resAttrs['service.name'] ?? '') || null
        const provider = String(identity['gen_ai.system'] ?? identity['provider'] ?? '') || null
        const promptHash = String(identity['prompt_hash'] ?? identity['prompt.id'] ?? identity['conversation.id'] ?? identity['session.id'] ?? '') || null
        const promptPreview = String(identity['prompt_preview'] ?? identity['prompt.preview'] ?? '') || null
        const bodyValue = attrVal(rec?.body)
        const promptTextValue = identity['prompt_text'] ?? identity['prompt.text'] ?? identity['user_prompt'] ?? identity['user.prompt']
        const promptText = String(promptTextValue ?? (typeof bodyValue === 'string' && /prompt|request/i.test(eventName) ? bodyValue : '')) || null
        const promptChars = num(identity['prompt_chars'] ?? identity['prompt.length']) || null
        const latencyMs = num(identity['latency_ms'] ?? identity['gen_ai.server.request.duration_ms']) || null
        const providerReqId = (identity['request_id'] ?? identity['gen_ai.response.id'] ?? null) as string | null
        const correlationId = (identity['prompt.id'] ?? identity['conversation.id'] ?? identity['session.id'] ?? null) as string | null
        const timeNano = rec?.timeUnixNano ?? rec?.observedTimeUnixNano
        const ts = nanoToIso(timeNano) ?? new Date().toISOString()

        // event_id: prefer a real provider request id; else a stable hash of
        // (source, correlation, time, batch index) so replays dedupe cleanly.
        const eventId = providerReqId
          ? `${source}:${providerReqId}`
          : sha(`${source}|${correlationId ?? ''}|${timeNano ?? ts}|${idx}`)

        // Cost is ALWAYS computed server-side, never taken from the event
        // (spec: cost_usd is server-computed, never client-supplied). computeCost
        // has sane defaults for models it doesn't know, so this is never 0.
        const cost = computeCost(model, input + cacheR + cacheW, output)

        rows.push({
          event_id: eventId,
          ts,
          source,
          provider_request_id: providerReqId,
          correlation_id: correlationId,
          model,
          input_tokens: input,
          output_tokens: output,
          cache_read_tokens: cacheR,
          cache_write_tokens: cacheW,
          reasoning_tokens: reason,
          cost_usd: +cost.toFixed(8),
          cost_basis: costBasisFor(source),
          user_email: userEmail,
          session_id: (identity['session.id'] ?? identity['session_id'] ?? null) as string | null,
          actor_id: actorId,
          actor_name: actorName,
          tool_name: toolName,
          provider,
          prompt_hash: promptHash,
          prompt_preview: promptPreview,
          prompt_text: promptText,
          prompt_chars: promptChars,
          latency_ms: latencyMs,
        })
        idx++
      }
    }
  }
  return rows
}

export interface MetricsHealth { recognized: number; unrecognized: string[]; sawDelta: boolean }

/** Health-only scan of an OTLP metrics payload. Does NOT create usage rows. */
export function scanMetrics(body: any): MetricsHealth {
  const out: MetricsHealth = { recognized: 0, unrecognized: [], sawDelta: false }
  for (const rm of body?.resourceMetrics ?? []) {
    for (const sm of rm?.scopeMetrics ?? []) {
      for (const m of sm?.metrics ?? []) {
        const name = String(m?.name ?? '')
        if (!name) continue
        if (isRecognizedMetric(name)) {
          out.recognized++
          const temporality = m?.sum?.aggregationTemporality ?? m?.histogram?.aggregationTemporality
          if (isDeltaTemporality(temporality)) out.sawDelta = true
        } else {
          out.unrecognized.push(name)
          warnUnrecognizedMetric(name)
        }
      }
    }
  }
  return out
}
