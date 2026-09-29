import { describe, it, expect } from 'vitest'
import { pickMembership } from './org-context'

const A = { org_id: 'aaaa', role: 'viewer', joined_at: '2026-01-02T00:00:00Z' }
const B = { org_id: 'bbbb', role: 'owner',  joined_at: '2026-01-01T00:00:00Z' }
const C = { org_id: '0000', role: 'admin',  joined_at: '2026-01-01T00:00:00Z' }

describe('pickMembership', () => {
  it('returns null with no memberships', () => {
    expect(pickMembership([])).toBeNull()
  })
  it('picks the earliest joined_at', () => {
    expect(pickMembership([A, B])).toEqual({ orgId: 'bbbb', role: 'owner' })
  })
  it('breaks joined_at ties by org_id, regardless of input order', () => {
    expect(pickMembership([B, C, A])).toEqual({ orgId: '0000', role: 'admin' })
    expect(pickMembership([A, C, B])).toEqual({ orgId: '0000', role: 'admin' })
  })
  it('honours the tf_org cookie only for an org the user belongs to', () => {
    expect(pickMembership([A, B], 'aaaa')).toEqual({ orgId: 'aaaa', role: 'viewer' })
    expect(pickMembership([A, B], 'not-mine')).toEqual({ orgId: 'bbbb', role: 'owner' })
  })
  it('treats unknown roles as viewer (fail closed)', () => {
    expect(pickMembership([{ org_id: 'x', role: 'superuser', joined_at: null }])).toEqual({ orgId: 'x', role: 'viewer' })
  })
})
