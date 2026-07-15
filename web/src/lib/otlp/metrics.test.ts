import { describe, it, expect } from 'vitest'
import { deriveMetricEvents, type MetricState } from './metrics'
import type { KeyCtx } from './auth'

const CTX: KeyCtx = { orgId: 'org1', projectId: 'proj1', keyId: 'key1', userId: null }

function fakeState(): MetricState {
  const m = new Map<string, number>()
  return { get: async (k) => (m.has(k) ? m.get(k)! : null), set: async (k, v) => { m.set(k, v) } }
}
const kv = (key: string, s: string) => ({ key, value: { stringValue: s } })
const metricsBody = (metrics: any[], res: any[] = []) => ({ resourceMetrics: [{ resource: { attributes: res }, scopeMetrics: [{ metrics }] }] })
const cumSum = (name: string, dataPoints: any[]) => ({ name, sum: { aggregationTemporality: 2, dataPoints } })
const deltaSum = (name: string, dataPoints: any[]) => ({ name, sum: { aggregationTemporality: 1, dataPoints } })
const dp = (type: string, value: number, o: { model?: string; conv?: string; time?: number } = {}) => ({
  timeUnixNano: o.time ?? 1e15, asInt: value,
  attributes: [kv('type', type), kv('model', o.model ?? 'gpt-5-codex'), kv('conversation.id', o.conv ?? 'c1')],
})

describe('deriveMetricEvents', () => {
  it('cumulative first-seen stores a baseline and emits nothing', async () => {
    const st = fakeState()
    const r = await deriveMetricEvents(metricsBody([cumSum('codex.turn.token_usage', [dp('input', 100), dp('output', 50)])]), CTX, st)
    expect(r.rows).toHaveLength(0)
    expect(r.skippedFirstSeen).toBe(2)
  })

  it('cumulative growth emits only the delta, grouped into one turn', async () => {
    const st = fakeState()
    await deriveMetricEvents(metricsBody([cumSum('codex.turn.token_usage', [dp('input', 100), dp('output', 50)])]), CTX, st)
    const r = await deriveMetricEvents(metricsBody([cumSum('codex.turn.token_usage', [dp('input', 180, { time: 2e15 }), dp('output', 75, { time: 2e15 })])]), CTX, st)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].input_tokens).toBe(80)   // 180 − 100
    expect(r.rows[0].output_tokens).toBe(25)  // 75 − 50
    expect(r.rows[0].source).toBe('codex_cli')
    expect(r.rows[0].cost_basis).toBe('notional')
  })

  it('delta temporality emits the value directly (no prior state needed)', async () => {
    const r = await deriveMetricEvents(metricsBody([deltaSum('codex.turn.token_usage', [dp('input', 30), dp('output', 20)])]), CTX, fakeState())
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].input_tokens).toBe(30)
    expect(r.rows[0].output_tokens).toBe(20)
  })

  it('a counter reset (value drops) emits nothing — never negative', async () => {
    const st = fakeState()
    await deriveMetricEvents(metricsBody([cumSum('codex.turn.token_usage', [dp('input', 100)])]), CTX, st)
    const r = await deriveMetricEvents(metricsBody([cumSum('codex.turn.token_usage', [dp('input', 40, { time: 2e15 })])]), CTX, st)
    expect(r.rows).toHaveLength(0)
  })

  it('does NOT derive Claude Code metrics (logs already own those rows)', async () => {
    const st = fakeState()
    await deriveMetricEvents(metricsBody([cumSum('claude_code.token.usage', [dp('input', 100)])]), CTX, st)
    const r = await deriveMetricEvents(metricsBody([cumSum('claude_code.token.usage', [dp('input', 500, { time: 2e15 })])]), CTX, st)
    expect(r.rows).toHaveLength(0)
    expect(r.skippedFirstSeen).toBe(0)
  })

  it('derives Gemini GenAI-semconv metrics (gen_ai.token.type / gen_ai.request.model)', async () => {
    const gdp = (type: string, val: number) => ({
      timeUnixNano: 1e15, asInt: val,
      attributes: [{ key: 'gen_ai.token.type', value: { stringValue: type } }, { key: 'gen_ai.request.model', value: { stringValue: 'gemini-2.5' } }],
    })
    const r = await deriveMetricEvents(metricsBody([deltaSum('gen_ai.client.token.usage', [gdp('input', 12), gdp('output', 8)])]), CTX, fakeState())
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].source).toBe('gemini_cli')
    expect(r.rows[0].model).toBe('gemini-2.5')
    expect(r.rows[0].input_tokens).toBe(12)
    expect(r.rows[0].output_tokens).toBe(8)
  })

  it('event_id is deterministic across identical exports (persist dedupes)', async () => {
    const body = metricsBody([deltaSum('codex.turn.token_usage', [dp('input', 30)])])
    const a = (await deriveMetricEvents(body, CTX, fakeState())).rows[0].event_id
    const b = (await deriveMetricEvents(body, CTX, fakeState())).rows[0].event_id
    expect(a).toBe(b)
  })
})
