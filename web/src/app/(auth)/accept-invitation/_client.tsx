'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff, AlertTriangle, Clock } from 'lucide-react'
import { ROLE_LABELS, ROLE_COLORS, type Role } from '@/lib/rbac'

interface Props {
  email:   string
  orgName: string
  orgId:   string
  role:    string
  expired: boolean
}

export function AcceptInvitationClient({ email, orgName, role, expired }: Props) {
  const router   = useRouter()
  const supabase = createClient()

  const [name,        setName]        = useState('')
  const [password,    setPassword]    = useState('')
  const [confirm,     setConfirm]     = useState('')
  const [showPass,    setShowPass]    = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [cancelling,  setCancelling]  = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  const safeRole   = (role as Role) in ROLE_LABELS ? (role as Role) : 'member'
  const roleLabel  = ROLE_LABELS[safeRole]
  const roleColors = ROLE_COLORS[safeRole]

  /* ── Accept ── */
  async function handleAccept(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim())                       return setError('Please enter your name.')
    if (password.length < 8)               return setError('Password must be at least 8 characters.')
    if (password !== confirm)              return setError('Passwords do not match.')

    setLoading(true)
    try {
      // 1. Set password on the already-authenticated account
      const { error: passErr } = await supabase.auth.updateUser({ password })
      if (passErr) throw new Error(passErr.message)

      // 2. Accept invite — creates membership + sets display name
      const res = await fetch('/api/v1/invites/accept', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: name.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to accept invitation.')

      router.refresh()
      router.push('/dashboard')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  /* ── Cancel ── */
  async function handleCancel() {
    setCancelling(true)
    try {
      await fetch('/api/v1/invites/accept', { method: 'DELETE' })
      await supabase.auth.signOut()
      router.push('/login?info=invitation_declined')
    } catch {
      await supabase.auth.signOut()
      router.push('/login')
    }
  }

  /* ── Expired state ── */
  if (expired) {
    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center text-center gap-3 py-4">
          <div className="w-12 h-12 rounded-2xl bg-[var(--amber-bg)] flex items-center justify-center">
            <Clock size={22} className="text-[var(--amber)]" />
          </div>
          <div>
            <h1 className="text-[20px] font-bold text-[var(--fg)] tracking-tight">Invitation expired</h1>
            <p className="text-[13px] text-[var(--fg-secondary)] mt-1">
              This invitation to <span className="font-semibold text-[var(--fg)]">{orgName}</span> has expired.
              Ask the team owner to send a new invite.
            </p>
          </div>
        </div>
        <button
          onClick={() => { supabase.auth.signOut(); router.push('/login') }}
          className="btn-secondary w-full"
        >
          Back to sign in
        </button>
      </div>
    )
  }

  /* ── Main form ── */
  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="text-center space-y-1">
          <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">
            You&apos;re invited
          </h1>
        <p className="text-[13.5px] text-[var(--fg-secondary)]">
          Join <span className="font-semibold text-[var(--fg)]">{orgName}</span> on TokenFin
        </p>
      </div>

      {/* Role + email pill */}
      <div className="flex items-center gap-2.5 p-3.5 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-[var(--fg-tertiary)] font-medium uppercase tracking-wide mb-0.5">Joining as</p>
          <p className="text-[13px] text-[var(--fg)] font-medium truncate">{email}</p>
        </div>
        <span
          className="text-[11.5px] font-bold px-2.5 py-1 rounded-lg flex-shrink-0"
          style={{ background: roleColors.bg, color: roleColors.text }}
        >
          {roleLabel}
        </span>
      </div>

      {/* Form */}
      <form onSubmit={handleAccept} className="space-y-3.5">

        {/* Name */}
        <div className="space-y-1.5">
          <label className="text-[12.5px] font-semibold text-[var(--fg-secondary)]">
            Your name
          </label>
          <input
            type="text"
            autoComplete="name"
            placeholder="Jane Smith"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--border)]
                       bg-[var(--bg)] text-[var(--fg)] text-[13.5px]
                       placeholder:text-[var(--fg-tertiary)]
                       focus:outline-none focus:ring-2 focus:ring-[var(--green)]/40 focus:border-[var(--green)]
                       transition-colors"
            required
          />
        </div>

        {/* Email — readonly */}
        <div className="space-y-1.5">
          <label className="text-[12.5px] font-semibold text-[var(--fg-secondary)]">
            Email
          </label>
          <input
            type="email"
            value={email}
            readOnly
            className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--border)]
                       bg-[var(--bg-secondary)] text-[var(--fg-secondary)] text-[13.5px]
                       cursor-not-allowed select-none"
          />
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <label className="text-[12.5px] font-semibold text-[var(--fg-secondary)]">
            Set a password
          </label>
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="Min. 8 characters"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 pr-10 rounded-xl border border-[var(--border)]
                         bg-[var(--bg)] text-[var(--fg)] text-[13.5px]
                         placeholder:text-[var(--fg-tertiary)]
                         focus:outline-none focus:ring-2 focus:ring-[var(--green)]/40 focus:border-[var(--green)]
                         transition-colors"
              required
            />
            <button
              type="button"
              onClick={() => setShowPass(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]"
            >
              {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        {/* Confirm password */}
        <div className="space-y-1.5">
          <label className="text-[12.5px] font-semibold text-[var(--fg-secondary)]">
            Confirm password
          </label>
          <div className="relative">
            <input
              type={showConfirm ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="Repeat password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className="w-full px-3.5 py-2.5 pr-10 rounded-xl border border-[var(--border)]
                         bg-[var(--bg)] text-[var(--fg)] text-[13.5px]
                         placeholder:text-[var(--fg-tertiary)]
                         focus:outline-none focus:ring-2 focus:ring-[var(--green)]/40 focus:border-[var(--green)]
                         transition-colors"
              required
            />
            <button
              type="button"
              onClick={() => setShowConfirm(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]"
            >
              {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {/* Inline match indicator */}
          {confirm.length > 0 && (
            <p className={`text-[11.5px] font-medium ${password === confirm ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
              {password === confirm ? '✓ Passwords match' : '✗ Passwords do not match'}
            </p>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2.5 px-3.5 py-3 bg-[var(--red-bg)] border border-[var(--red)]/20 rounded-xl">
            <AlertTriangle size={14} className="text-[var(--red)] mt-0.5 flex-shrink-0" />
            <p className="text-[12.5px] text-[var(--fg)] leading-snug">{error}</p>
          </div>
        )}

        {/* Accept button */}
        <button
          type="submit"
          disabled={loading || cancelling}
          className="btn-primary w-full py-2.5 text-[13.5px] font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? 'Accepting…' : `Accept invitation →`}
        </button>
      </form>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-[var(--border)]" />
        <span className="text-[11.5px] text-[var(--fg-tertiary)]">or</span>
        <div className="flex-1 h-px bg-[var(--border)]" />
      </div>

      {/* Cancel */}
      <button
        onClick={handleCancel}
        disabled={loading || cancelling}
        className="btn-secondary w-full py-2.5 text-[13px] disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {cancelling ? 'Cancelling…' : 'Decline invitation'}
      </button>

      <p className="text-center text-[11.5px] text-[var(--fg-tertiary)] leading-relaxed">
        Declining will remove your session. You can ask the team owner to send a new invite anytime.
      </p>
    </div>
  )
}
