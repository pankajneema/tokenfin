'use client'
import { useState, useEffect } from 'react'
import { useRouter }           from 'next/navigation'
import Link                    from 'next/link'
import { Eye, EyeOff, Check, AlertCircle, ShieldCheck, ArrowRight } from 'lucide-react'
import { createClient }        from '@/lib/supabase/client'
import { cn }                  from '@/lib/utils'

// ── Password rules (same as signup) ──────────────────────────────────────────
const PW_RULES = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter',  test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One number',            test: (p: string) => /\d/.test(p) },
]

function pwStrength(p: string): { score: number; label: string; color: string } {
  const passed = PW_RULES.filter(r => r.test(p)).length
  const extra  = p.length >= 12 && /[^A-Za-z0-9]/.test(p) ? 1 : 0
  const score  = passed + extra
  if (score === 0) return { score: 0, label: '',       color: 'transparent' }
  if (score === 1) return { score: 1, label: 'Weak',   color: '#E8533A' }
  if (score === 2) return { score: 2, label: 'Fair',   color: '#F5C842' }
  if (score === 3) return { score: 3, label: 'Good',   color: '#00C48C' }
  return              { score: 4, label: 'Strong', color: '#0F6E56' }
}

function inputCls(state: 'default' | 'valid' | 'error', hasSuffix = false) {
  return cn(
    'w-full pl-[38px] py-[11px] rounded-xl border text-[var(--fg)] text-[13px]',
    hasSuffix ? 'pr-10' : 'pr-3.5',
    'placeholder:text-[var(--fg-tertiary)] outline-none transition-all duration-150',
    'bg-[var(--bg-secondary)]',
    state === 'valid'   && 'border-teal      focus:border-teal   focus:ring-2 focus:ring-teal/10',
    state === 'error'   && 'border-[var(--red)] focus:border-[var(--red)] focus:ring-2 focus:ring-[rgba(153,60,29,0.1)]',
    state === 'default' && 'border-[var(--border)] focus:border-coral focus:ring-2 focus:ring-coral/10',
  )
}

export default function ResetPasswordPage() {
  const router   = useRouter()
  const supabase = createClient()

  const [password,    setPassword]    = useState('')
  const [confirm,     setConfirm]     = useState('')
  const [showPw,      setShowPw]      = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [done,        setDone]        = useState(false)
  const [sessionReady, setSessionReady] = useState(false)

  // Supabase's password-reset email sends the user through /auth/callback,
  // which exchanges the code for a session. By the time they reach this page
  // they should already be authenticated. We confirm that here.
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        // Link expired or already used — send them back to forgot-password.
        router.replace('/forgot-password?error=link_expired')
        return
      }
      setSessionReady(true)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const allPwRules    = PW_RULES.every(r => r.test(password))
  const passwordsMatch = password === confirm && confirm.length > 0
  const strength       = pwStrength(password)

  const confirmState: 'default' | 'valid' | 'error' =
    confirm.length === 0  ? 'default'
    : passwordsMatch      ? 'valid'
    : 'error'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!allPwRules || !passwordsMatch) return

    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) { setError(error.message); return }

    setDone(true)
    // Auto-redirect after 3 s
    setTimeout(() => router.replace('/dashboard'), 3000)
  }

  // ── Loading session check ──────────────────────────────────────────────────
  if (!sessionReady) {
    return (
      <div className="w-full flex flex-col items-center justify-center gap-3 py-12 animate-fade-in">
        <span className="w-8 h-8 rounded-full border-2 border-[var(--border)] border-t-coral animate-spin" />
        <p className="text-[13px] text-[var(--fg-secondary)]">Verifying link…</p>
      </div>
    )
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="w-full text-center animate-fade-in">
        <div className="mx-auto mb-7 relative w-[72px] h-[72px]">
          <div className="absolute inset-0 rounded-full bg-teal/10 animate-ping-slow" />
          <div className="relative w-full h-full rounded-full bg-teal/15 flex items-center justify-center border border-teal/30">
            <div className="w-10 h-10 rounded-full bg-teal flex items-center justify-center">
              <Check size={20} className="text-white" strokeWidth={2.5} />
            </div>
          </div>
        </div>

        <h2 className="text-[22px] font-bold text-[var(--fg)] tracking-tight mb-2">
          Password updated
        </h2>
        <p className="text-[13px] text-[var(--fg-secondary)] mb-8 leading-relaxed">
          Your new password is set. Redirecting to dashboard…
        </p>

        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center gap-2 w-full px-4 py-[13px] rounded-xl bg-coral text-white text-[13.5px] font-semibold shadow-[0_2px_6px_rgba(232,83,58,0.35)] hover:bg-[#D4432B] transition-all"
        >
          Go to dashboard <ArrowRight size={14} strokeWidth={2.5} />
        </Link>
      </div>
    )
  }

  // ── Main form ──────────────────────────────────────────────────────────────
  return (
    <div className="w-full animate-fade-in">

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-[26px] font-bold text-[var(--fg)] tracking-tight mb-1.5 leading-[1.2]">
          Choose a new password
        </h1>
        <p className="text-[13.5px] text-[var(--fg-secondary)]">
          Make it strong — you won&apos;t need to change it again for a while
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-[var(--red-bg)] border border-[rgba(153,60,29,0.18)] text-[12px] text-[var(--red)] mb-5 animate-slide-up">
          <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="flex-shrink-0 opacity-60 hover:opacity-100">
            <svg viewBox="0 0 12 12" className="w-3 h-3 fill-none stroke-current" strokeWidth={1.75}><path d="M1 1l10 10M11 1L1 11" /></svg>
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>

        {/* New password */}
        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-[11px] font-semibold tracking-widest text-[var(--fg-tertiary)] uppercase">
            New password
          </label>
          <div className="relative">
            <svg viewBox="0 0 20 20" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[14px] h-[14px] fill-none stroke-[var(--fg-tertiary)] pointer-events-none" strokeWidth={1.6}>
              <rect x="3" y="8" width="14" height="10" rx="2"/><path d="M7 8V6a3 3 0 016 0v2" strokeLinecap="round"/>
            </svg>
            <input
              id="password"
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="New password"
              autoComplete="new-password"
              autoFocus
              required
              className={inputCls(
                password.length === 0 ? 'default' : allPwRules ? 'valid' : 'default',
                true
              )}
            />
            <button
              type="button"
              aria-label={showPw ? 'Hide password' : 'Show password'}
              onClick={() => setShowPw(v => !v)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)] transition-colors p-0.5"
            >
              {showPw ? <EyeOff size={14} strokeWidth={1.75} /> : <Eye size={14} strokeWidth={1.75} />}
            </button>
          </div>

          {/* Strength meter */}
          {password.length > 0 && (
            <div className="mt-2.5 space-y-2">
              <div className="flex items-center gap-2.5">
                <div className="flex-1 flex gap-1">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="flex-1 h-[3px] rounded-full transition-all duration-300"
                      style={{ background: i <= strength.score ? strength.color : 'var(--border)' }} />
                  ))}
                </div>
                {strength.label && (
                  <span className="text-[10.5px] font-semibold tracking-wide" style={{ color: strength.color }}>
                    {strength.label}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {PW_RULES.map(r => {
                  const ok = r.test(password)
                  return (
                    <div key={r.label} className="flex items-center gap-2">
                      <div className={cn(
                        'w-[14px] h-[14px] rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-200',
                        ok ? 'bg-teal' : 'border border-[var(--border)] bg-transparent'
                      )}>
                        {ok && <Check size={8} className="text-white" strokeWidth={3} />}
                      </div>
                      <span className={cn('text-[11px] transition-colors duration-200', ok ? 'text-[var(--fg-secondary)]' : 'text-[var(--fg-tertiary)]')}>
                        {r.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Confirm password */}
        <div className="space-y-1.5">
          <label htmlFor="confirm" className="block text-[11px] font-semibold tracking-widest text-[var(--fg-tertiary)] uppercase">
            Confirm password
          </label>
          <div className="relative">
            <svg viewBox="0 0 20 20" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[14px] h-[14px] fill-none stroke-[var(--fg-tertiary)] pointer-events-none" strokeWidth={1.6}>
              <rect x="3" y="8" width="14" height="10" rx="2"/><path d="M7 8V6a3 3 0 016 0v2" strokeLinecap="round"/>
            </svg>
            <input
              id="confirm"
              type={showConfirm ? 'text' : 'password'}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat password"
              autoComplete="new-password"
              required
              className={inputCls(confirmState, true)}
            />
            <button
              type="button"
              aria-label={showConfirm ? 'Hide password' : 'Show password'}
              onClick={() => setShowConfirm(v => !v)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)] transition-colors p-0.5"
            >
              {showConfirm ? <EyeOff size={14} strokeWidth={1.75} /> : <Eye size={14} strokeWidth={1.75} />}
            </button>
          </div>
          {confirmState === 'error' && (
            <p className="text-[11px] text-[var(--red)] mt-1 pl-1">Passwords don&apos;t match.</p>
          )}
          {confirmState === 'valid' && (
            <p className="text-[11px] text-teal mt-1 pl-1">Passwords match ✓</p>
          )}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading || !allPwRules || !passwordsMatch}
          className={cn(
            'w-full flex items-center justify-center gap-2 px-4 py-[13px] rounded-xl text-white text-[13.5px] font-semibold transition-all duration-150 mt-2',
            loading || !allPwRules || !passwordsMatch
              ? 'bg-coral/40 cursor-not-allowed'
              : 'bg-coral hover:bg-[#D4432B] shadow-[0_2px_6px_rgba(232,83,58,0.35)] hover:shadow-[0_4px_12px_rgba(232,83,58,0.4)] active:scale-[0.985]'
          )}
        >
          {loading ? (
            <>
              <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Updating…
            </>
          ) : (
            <>Update password <ArrowRight size={14} strokeWidth={2.5} /></>
          )}
        </button>
      </form>

      {/* Trust */}
      <div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-[var(--fg-tertiary)]">
        <ShieldCheck size={11} className="text-teal" strokeWidth={2} />
        <span>Password is encrypted at rest · TLS in transit</span>
      </div>
    </div>
  )
}
