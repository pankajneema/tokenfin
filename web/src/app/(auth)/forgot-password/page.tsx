'use client'
import { useState }        from 'react'
import Link                from 'next/link'
import { ArrowLeft, Mail, ShieldCheck, AlertCircle, Check } from 'lucide-react'
import { createClient }    from '@/lib/supabase/client'
import { cn }              from '@/lib/utils'

function inputCls(state: 'default' | 'valid' | 'error') {
  return cn(
    'w-full pl-[38px] pr-3.5 py-[11px] rounded-xl border text-[var(--fg)] text-[13px]',
    'placeholder:text-[var(--fg-tertiary)] outline-none transition-all duration-150',
    'bg-[var(--bg-secondary)]',
    state === 'valid'   && 'border-teal      focus:border-teal   focus:ring-2 focus:ring-teal/10',
    state === 'error'   && 'border-[var(--red)] focus:border-[var(--red)] focus:ring-2 focus:ring-[rgba(153,60,29,0.1)]',
    state === 'default' && 'border-[var(--border)] focus:border-coral focus:ring-2 focus:ring-coral/10',
  )
}

export default function ForgotPasswordPage() {
  const supabase = createClient()

  const [email,        setEmail]        = useState('')
  const [emailTouched, setEmailTouched] = useState(false)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [sent,         setSent]         = useState(false)

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const emailState: 'default' | 'valid' | 'error' =
    !emailTouched  ? 'default'
    : emailValid   ? 'valid'
    : email        ? 'error'
    : 'default'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setEmailTouched(true)
    if (!emailValid) return

    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/auth/callback?next=/reset-password`,
    })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    setSent(true)
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (sent) {
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
          Check your inbox
        </h2>
        <p className="text-[13px] text-[var(--fg-secondary)] mb-1 leading-relaxed">
          We sent a password-reset link to
        </p>
        <p className="text-[13.5px] font-semibold text-[var(--fg)] mb-2 flex items-center justify-center gap-1.5">
          <Mail size={13} className="text-coral" />
          {email}
        </p>
        <p className="text-[12px] text-[var(--fg-tertiary)] mb-8 leading-relaxed max-w-[300px] mx-auto">
          The link expires in 1 hour. Check your spam folder if you don&apos;t see it.
        </p>

        <button
          type="button"
          onClick={() => { setSent(false); setEmail(''); setEmailTouched(false) }}
          className="w-full flex items-center justify-center gap-2 px-4 py-[13px] rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] hover:border-[var(--border-strong)] text-[var(--fg)] text-[13px] font-medium transition-all duration-150 mb-4"
        >
          Try a different email
        </button>

        <Link
          href="/login"
          className="flex items-center justify-center gap-1.5 text-[12.5px] text-[var(--fg-secondary)] hover:text-coral transition-colors"
        >
          <ArrowLeft size={12} strokeWidth={2} />
          Back to sign in
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
          Reset your password
        </h1>
        <p className="text-[13.5px] text-[var(--fg-secondary)]">
          Enter your email and we&apos;ll send a reset link
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-[var(--red-bg)] border border-[rgba(153,60,29,0.18)] text-[12px] text-[var(--red)] mb-5 animate-slide-up">
          <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="flex-shrink-0 opacity-60 hover:opacity-100">
            <svg viewBox="0 0 12 12" className="w-3 h-3 fill-none stroke-current" strokeWidth={1.75}>
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-[11px] font-semibold tracking-widest text-[var(--fg-tertiary)] uppercase">
            Email address
          </label>
          <div className="relative">
            <svg viewBox="0 0 20 20" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[14px] h-[14px] fill-none stroke-[var(--fg-tertiary)] pointer-events-none" strokeWidth={1.6}>
              <path d="M2 5.5A1.5 1.5 0 013.5 4h13A1.5 1.5 0 0118 5.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 012 14.5v-9z"/>
              <path d="M2 6l8 5 8-5" strokeLinejoin="round"/>
            </svg>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onBlur={() => setEmailTouched(true)}
              placeholder="you@company.com"
              autoComplete="email"
              autoFocus
              required
              className={inputCls(emailState)}
            />
          </div>
          {emailState === 'error' && (
            <p className="text-[11px] text-[var(--red)] mt-1 pl-1">Enter a valid email address.</p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className={cn(
            'w-full flex items-center justify-center gap-2 px-4 py-[13px] rounded-xl text-white text-[13.5px] font-semibold transition-all duration-150 mt-2',
            loading
              ? 'bg-coral/55 cursor-not-allowed'
              : 'bg-coral hover:bg-[#D4432B] shadow-[0_2px_6px_rgba(232,83,58,0.35)] hover:shadow-[0_4px_12px_rgba(232,83,58,0.4)] active:scale-[0.985]'
          )}
        >
          {loading ? (
            <>
              <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Sending…
            </>
          ) : (
            'Send reset link'
          )}
        </button>
      </form>

      {/* Back link */}
      <div className="mt-7 flex items-center justify-center">
        <Link
          href="/login"
          className="flex items-center gap-1.5 text-[12.5px] text-[var(--fg-secondary)] hover:text-coral transition-colors"
        >
          <ArrowLeft size={12} strokeWidth={2} />
          Back to sign in
        </Link>
      </div>

      {/* Trust */}
      <div className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-[var(--fg-tertiary)]">
        <ShieldCheck size={11} className="text-teal" strokeWidth={2} />
        <span>Link expires in 1 hour · TLS encrypted</span>
      </div>
    </div>
  )
}
