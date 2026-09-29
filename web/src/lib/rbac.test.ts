import { describe, it, expect } from 'vitest'
import { can, promptScope, NO_USER_SCOPE, kindForScopes, scopesForKind, keyCanRead, keyCanIngest } from './rbac'

describe('prompts privacy', () => {
  it('only owners/admins may view everyone’s prompts', () => {
    expect(can('owner', 'prompts:view_all')).toBe(true)
    expect(can('admin', 'prompts:view_all')).toBe(true)
    expect(can('member', 'prompts:view_all')).toBe(false)
    expect(can('viewer', 'prompts:view_all')).toBe(false)
  })
  it('promptScope: null (org-wide) for admins, own id for members/viewers', () => {
    expect(promptScope('owner', 'u1')).toBeNull()
    expect(promptScope('admin', 'u1')).toBeNull()
    expect(promptScope('member', 'u1')).toBe('u1')
    expect(promptScope('viewer', 'u1')).toBe('u1')
  })
  it('promptScope fails closed without a role or user', () => {
    expect(promptScope(null, 'u1')).toBe('u1')
    expect(promptScope('member', null)).toBe(NO_USER_SCOPE)
  })
})

describe('key scopes', () => {
  it('maps kinds to scopes and back', () => {
    expect(scopesForKind('ingest')).toEqual(['ingest'])
    expect(scopesForKind('read')).toEqual(['read'])
    expect(scopesForKind('legacy')).toEqual(['read', 'write'])
    expect(kindForScopes(['ingest'])).toBe('ingest')
    expect(kindForScopes(['read'])).toBe('read')
    expect(kindForScopes(['read', 'write'])).toBe('legacy')
  })
  it('ingest-only keys cannot read; read-only keys cannot ingest; legacy keys can do both', () => {
    expect(keyCanRead(['ingest'])).toBe(false)
    expect(keyCanIngest(['ingest'])).toBe(true)
    expect(keyCanRead(['read'])).toBe(true)
    expect(keyCanIngest(['read'])).toBe(false)
    expect(keyCanRead(['read', 'write'])).toBe(true)
    expect(keyCanIngest(['read', 'write'])).toBe(true)
    expect(keyCanRead([])).toBe(true) // pre-scope legacy rows
  })
})
