import { describe, it, expect } from 'vitest'
import fixture from './fixtures/litellm-sample.json'
import { comparePrices, lookupUpstream, parseLiteLLM } from './compare'
import { describeFinding } from './run'
import { priceFor } from '@/lib/mcp/pricing'

describe('parseLiteLLM', () => {
  const up = parseLiteLLM(fixture)
  it('keeps chat models of anthropic/openai/gemini, per 1M tokens', () => {
    expect(up.get('claude-sonnet-4-6')).toEqual({ in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75, provider: 'anthropic' })
    expect(up.get('gemini-2.5-pro')?.in).toBe(1.25)         // "gemini/" prefix stripped
    expect(up.has('mistral-large-latest')).toBe(false)       // other provider
    expect(up.has('text-embedding-3-small')).toBe(false)     // not chat
    expect(up.has('sample_spec')).toBe(false)
    expect(Array.from(up.keys()).some(k => k.startsWith('ft:') || k.includes('/'))).toBe(false)
  })
  it('handles garbage input', () => {
    expect(parseLiteLLM(null).size).toBe(0)
    expect(parseLiteLLM({ x: 5 }).size).toBe(0)
  })
})

describe('comparePrices', () => {
  it('reports only >1% differences for models we price', () => {
    const up = parseLiteLLM(fixture)
    const out = comparePrices(up, priceFor)
    const byModel = Object.fromEntries(out.map(m => [m.model, m.fields]))
    expect(byModel['claude-opus-4-7']).toEqual(['in', 'out'])
    expect(byModel['gpt-4o']).toEqual(['cacheRead'])          // ours defaults to 0.1× input
    expect(byModel['claude-sonnet-4-6']).toBeUndefined()      // matches incl. cache prices
    expect(byModel['brand-new-model-x']).toBeUndefined()      // we don't price it → not a mismatch
  })
  it('works with a stubbed price table', () => {
    const up = new Map([['m-1', { in: 1, out: 2, cacheRead: null, cacheWrite: null, provider: 'openai' }]])
    const stub = () => ({ in: 1.005, out: 2, known: true })
    expect(comparePrices(up, stub)).toEqual([])
    expect(comparePrices(up, () => ({ in: 1.2, out: 2, known: true }))[0].fields).toEqual(['in'])
  })
})

describe('lookupUpstream', () => {
  it('exact, then longest prefix', () => {
    const up = parseLiteLLM(fixture)
    expect(lookupUpstream(up, 'gpt-4o-mini')?.key).toBe('gpt-4o-mini')
    expect(lookupUpstream(up, 'gpt-4o-mini-2024-07-18')?.key).toBe('gpt-4o-mini')
    expect(lookupUpstream(up, 'unknown')).toBeNull()
  })
})

describe('describeFinding', () => {
  it('writes readable notifications', () => {
    const a = describeFinding({ model: 'x-1', kind: 'unpriced_seen', ours: {}, theirs: { in: 1, out: 2, matched: 'x-1' } })
    expect(a.title).toBe('Unpriced model in use: x-1')
    expect(a.body).toMatch(/\$1 in \/ \$2 out/)
    const b = describeFinding({ model: 'y', kind: 'price_mismatch', ours: { in: 5, out: 25 }, theirs: { in: 15, out: 75, fields: ['in', 'out'] } })
    expect(b.body).toMatch(/differs: in, out/)
  })
})
