import { describe, it, expect } from 'vitest'
import { countPrompts, callsPerPrompt, promptKey } from './prompts'

describe('prompt counting', () => {
  it('counts one prompt per correlation id, however many LLM calls it made', () => {
    const rows = [
      { id: 'e1', correlation_id: 'p-1' },
      { id: 'e2', correlation_id: 'p-1' },
      { id: 'e3', correlation_id: 'p-1' },
      { id: 'e4', correlation_id: 'p-2' },
    ]
    expect(countPrompts(rows)).toBe(2)
    expect(callsPerPrompt(rows.length, countPrompts(rows))).toBe(2)
  })

  it('treats each SDK request without a correlation id as its own prompt', () => {
    expect(countPrompts([{ id: 'a' }, { id: 'b', correlation_id: null }, { id: 'c', correlation_id: '' }])).toBe(3)
    expect(promptKey({ id: 'x', correlation_id: null })).toBe('x')
  })

  it('handles no data', () => {
    expect(countPrompts([])).toBe(0)
    expect(callsPerPrompt(0, 0)).toBeNull()
  })
})
