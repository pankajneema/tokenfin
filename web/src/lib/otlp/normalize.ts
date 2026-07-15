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
import { attrsToMap, nanoToIso, num } from './attrs'
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
        const eventName = String(rec?.eventName ?? a['event.name'] ?? '')
        const model = String(a['model'] ?? a['gen_ai.request.model'] ?? '')

        const input  = num(a['input_tokens'] ?? a['gen_ai.usage.input_tokens'])
        const output = num(a['output_tokens'] ?? a['gen_ai.usage.output_tokens'])
        const cacheR = num(a['cache_read_tokens'])
        const cacheW = num(a['cache_creation_tokens'] ?? a['cache_write_tokens'])
        const reason = num(a['reasoning_tokens'])

        // Only turn-bearing events: has a model and some tokens. Skips prompts,
        // tool results, errors, refusals — none of which carry token counts.
        if (!model || (input + output + cacheR + cacheW) <= 0) continue
        if (/error|refusal/.test(eventName)) continue

        const source = detectSource(resAttrs, eventName || model)
        const providerReqId = (a['request_id'] ?? a['gen_ai.response.id'] ?? null) as string | null
        const correlationId = (a['prompt.id'] ?? a['conversation.id'] ?? a['session.id'] ?? null) as string | null
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
          user_email: (a['user.email'] ?? null) as string | null,
          session_id: (a['session.id'] ?? null) as string | null,
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
