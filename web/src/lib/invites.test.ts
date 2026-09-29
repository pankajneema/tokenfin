import { describe, it, expect } from 'vitest'
import { confirmUrl, inviteEmail, ACCEPT_PATH } from './invites'

describe('confirmUrl', () => {
  it('points at /auth/confirm with the token, type and the accept page', () => {
    const u = new URL(confirmUrl('https://app.example.com', 'abc123', 'invite'))
    expect(u.origin + u.pathname).toBe('https://app.example.com/auth/confirm')
    expect(u.searchParams.get('token_hash')).toBe('abc123')
    expect(u.searchParams.get('type')).toBe('invite')
    expect(u.searchParams.get('next')).toBe(ACCEPT_PATH)
  })
})

describe('inviteEmail', () => {
  const base = { orgName: 'Acme', inviter: 'Priya', link: 'https://app/x?a=1&b=2', existingAccount: false, appUrl: 'https://app' }

  it('names the team and inviter, with the link in text and html', () => {
    const m = inviteEmail(base)
    expect(m.subject).toBe('Priya invited you to Acme on TokenFin')
    expect(m.text).toContain('Accept invitation: https://app/x?a=1&b=2')
    expect(m.html).toContain('href="https://app/x?a=1&amp;b=2"')
    expect(m.html).toContain('Join Acme')
  })

  it('uses sign-in wording for existing accounts', () => {
    const m = inviteEmail({ ...base, existingAccount: true })
    expect(m.text).toContain('Sign in and join:')
    expect(m.text).toContain('https://app/accept-invitation')
  })

  it('escapes HTML in org and inviter names', () => {
    const m = inviteEmail({ ...base, orgName: '<b>Evil</b>', inviter: 'a"b' })
    expect(m.html).not.toContain('<b>Evil</b>')
    expect(m.html).toContain('&lt;b&gt;Evil&lt;/b&gt;')
  })

  it('falls back when the inviter is unknown', () => {
    expect(inviteEmail({ ...base, inviter: null }).subject).toBe('Your team invited you to Acme on TokenFin')
  })
})
