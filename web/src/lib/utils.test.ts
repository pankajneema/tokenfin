import { describe, it, expect } from 'vitest'
import { formatCost, formatTokens, formatNumber } from './utils'

describe('formatCost', () => {
  it('shows zero and tiny amounts honestly', () => {
    expect(formatCost(0)).toBe('$0.00')
    expect(formatCost(null)).toBe('$0.00')
    expect(formatCost(0.0004)).toBe('<$0.01')
    expect(formatCost(0.004)).toBe('<$0.01')
  })
  it('uses 2 decimals under $100 and none above', () => {
    expect(formatCost(0.01)).toBe('$0.01')
    expect(formatCost(1.5)).toBe('$1.50')
    expect(formatCost(99.99)).toBe('$99.99')
    expect(formatCost(99.999)).toBe('$100')
    expect(formatCost(1234.56)).toBe('$1,235')
    expect(formatCost(2_500_000)).toBe('$2.5M')
    expect(formatCost(-3.2)).toBe('-$3.20')
  })
})

describe('formatTokens', () => {
  it('is compact', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(1000)).toBe('1K')
    expect(formatTokens(12_345)).toBe('12.3K')
    expect(formatTokens(999_999)).toBe('1M')
    expect(formatTokens(1_200_000)).toBe('1.2M')
    expect(formatTokens(3_000_000_000)).toBe('3B')
  })
})

describe('formatNumber', () => {
  it('groups whole numbers', () => {
    expect(formatNumber(1234567)).toBe('1,234,567')
    expect(formatNumber(undefined)).toBe('0')
  })
})
