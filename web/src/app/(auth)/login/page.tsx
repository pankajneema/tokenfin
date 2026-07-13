'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, ArrowRight, AlertCircle, ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
// CAPTCHA disabled for now (turned off in Supabase). To re-enable: uncomment the
// import + state + <Captcha/> below and set NEXT_PUBLIC_CAPTCHA_SITE_KEY.
// import { useRef } from 'react'
// import { Captcha, captchaEnabled, type CaptchaHandle } from '@/components/auth/captcha'

/* ── SVG logos ─────────────────────────────────────────────────── */
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path fill="currentColor" d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )
}

/* ── Field wrapper ─────────────────────────────────────────────── */
function Field({
  id, label, aside, children,
}: {
  id: string
  label: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="block text-[11px] font-semibold tracking-widest text-[var(--fg-tertiary)] uppercase">
          {label}
        </label>
        {aside}
      </div>
      {children}
    </div>
  )
}

/* ── Tick icon ─────────────────────────────────────────────────── */
function Tick() {
  return (
    <div className="absolute right-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] rounded-full bg-teal flex items-center justify-center pointer-events-none">
      <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 stroke-white fill-none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 6l3 3 5-5" />
      </svg>
    </div>
  )
}

/* ── Custom checkbox ───────────────────────────────────────────── */
function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer group select-none">
      <span
        role="checkbox"
        aria-checked={checked}
        tabIndex={0}
        onClick={onChange}
        onKeyDown={e => (e.key === ' ' || e.key === 'Enter') && onChange()}
        className={cn(
          'w-[16px] h-[16px] rounded-[4px] border-[1.5px] flex items-center justify-center flex-shrink-0 transition-all duration-150',
          checked
            ? 'bg-coral border-coral'
            : 'border-[var(--border)] bg-[var(--bg-secondary)] group-hover:border-coral/60'
        )}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 stroke-white fill-none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 6l3 3 5-5" />
          </svg>
        )}
      </span>
      <span className="text-[12px] text-[var(--fg-secondary)]">{label}</span>
    </label>
  )
}

/* ── Input base class ──────────────────────────────────────────── */
function inputCls(state: 'default' | 'valid' | 'error', hasPrefix = false, hasSuffix = false) {
  return cn(
    'w-full py-[11px] rounded-xl border text-[var(--fg)] text-[13px]',
    'placeholder:text-[var(--fg-tertiary)] outline-none transition-all duration-150',
    'bg-[var(--bg-secondary)]',
    hasPrefix  ? 'pl-[38px]' : 'pl-3.5',
    hasSuffix  ? 'pr-10'     : 'pr-3.5',
    state === 'valid'   && 'border-teal      focus:border-teal   focus:ring-2 focus:ring-teal/10',
    state === 'error'   && 'border-[var(--red)] focus:border-[var(--red)] focus:ring-2 focus:ring-[rgba(153,60,29,0.1)]',
    state === 'default' && 'border-[var(--border)] focus:border-coral focus:ring-2 focus:ring-coral/10',
  )
}

/* ═══════════════════════════════════════════════════════════════ */
export default function LoginPage() {
  const router   = useRouter()
  const supabase = createClient()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [remember, setRemember] = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [socialLoading, setSocialLoading] = useState<'github' | 'google' | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const [emailTouched, setEmailTouched] = useState(false)
  // const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  // const captchaRef = useRef<CaptchaHandle>(null)

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const emailState = emailTouched
    ? emailValid ? 'valid' : email ? 'error' : 'default'
    : 'default'

  // Post-login destination — honors ?next= (must be a same-site relative path
  // to avoid open redirects), falling back to the dashboard.
  function nextDest() {
    if (typeof window === 'undefined') return '/dashboard'
    const n = new URLSearchParams(window.location.search).get('next')
    return n && n.startsWith('/') ? n : '/dashboard'
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setEmailTouched(true)
    if (!emailValid) return
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false); return }
    router.push(nextDest())
    router.refresh()
  }

  async function handleOAuth(provider: 'github' | 'google') {
    setSocialLoading(provider)
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(nextDest())}` },
    })
    if (error) { setError(error.message); setSocialLoading(null) }
  }

  return (
    <div className="w-full animate-fade-in">

      {/* ── Header ── */}
      <div className="mb-8">
        <h1 className="text-[26px] font-bold text-[var(--fg)] tracking-tight mb-1.5 leading-[1.2]">
          Welcome back
        </h1>
        <p className="text-[13.5px] text-[var(--fg-secondary)]">
          Sign in to your TokenFin workspace
        </p>
      </div>

      {/* ── Social buttons ── */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <button
          type="button"
          onClick={() => handleOAuth('github')}
          disabled={!!socialLoading || loading}
          className="flex items-center justify-center gap-2 px-3 py-[10px] rounded-xl border border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--bg-secondary)] hover:border-[var(--border-strong)] text-[var(--fg)] text-[12.5px] font-medium transition-all duration-150 shadow-soft disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {socialLoading === 'github'
            ? <span className="w-4 h-4 rounded-full border-2 border-[var(--border-strong)] border-t-[var(--fg)] animate-spin" />
            : <GithubIcon className="w-[15px] h-[15px]" />}
          GitHub
        </button>

        <button
          type="button"
          onClick={() => handleOAuth('google')}
          disabled={!!socialLoading || loading}
          className="flex items-center justify-center gap-2 px-3 py-[10px] rounded-xl border border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--bg-secondary)] hover:border-[var(--border-strong)] text-[var(--fg)] text-[12.5px] font-medium transition-all duration-150 shadow-soft disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {socialLoading === 'google'
            ? <span className="w-4 h-4 rounded-full border-2 border-[var(--border-strong)] border-t-[var(--fg)] animate-spin" />
            : <GoogleIcon className="w-[15px] h-[15px]" />}
          Google
        </button>
      </div>

      {/* ── Divider ── */}
      <div className="relative mb-5">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-[var(--border)]" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-[var(--bg-secondary)] px-3 text-[11px] font-medium text-[var(--fg-tertiary)] tracking-widest uppercase">
            or email
          </span>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-[var(--red-bg)] border border-[rgba(153,60,29,0.18)] text-[12px] text-[var(--red)] mb-5 animate-slide-up">
          <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
          >
            <svg viewBox="0 0 12 12" className="w-3 h-3 fill-none stroke-current" strokeWidth={1.75}>
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Form ── */}
      <form onSubmit={handleLogin} className="space-y-4" noValidate>

        {/* Email */}
        <Field id="email" label="Email">
          <div className="relative">
            {/* prefix icon */}
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
              required
              className={inputCls(emailState, true, emailState === 'valid')}
            />
            {emailState === 'valid' && <Tick />}
          </div>
          {emailState === 'error' && (
            <p className="text-[11px] text-[var(--red)] mt-1 pl-1">Enter a valid email address.</p>
          )}
        </Field>

        {/* Password */}
        <Field
          id="password"
          label="Password"
          aside={
            <Link href="/forgot-password" className="text-[11.5px] text-coral hover:text-[var(--accent-hover)] font-medium transition-colors">
              Forgot password?
            </Link>
          }
        >
          <div className="relative">
            <svg viewBox="0 0 20 20" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[14px] h-[14px] fill-none stroke-[var(--fg-tertiary)] pointer-events-none" strokeWidth={1.6}>
              <rect x="3" y="8" width="14" height="10" rx="2"/>
              <path d="M7 8V6a3 3 0 016 0v2" strokeLinecap="round"/>
            </svg>
            <input
              id="password"
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
              className={inputCls('default', true, true)}
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
        </Field>

        {/* Remember me */}
        <Checkbox
          checked={remember}
          onChange={() => setRemember(v => !v)}
          label="Keep me signed in for 30 days"
        />

        {/* <Captcha ref={captchaRef} onToken={setCaptchaToken} /> */}

        {/* Submit */}
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
              Signing in…
            </>
          ) : (
            <>Sign in <ArrowRight size={14} strokeWidth={2.5} /></>
          )}
        </button>
      </form>

      {/* ── Footer links ── */}
      <p className="mt-7 text-center text-[12.5px] text-[var(--fg-secondary)]">
        New to TokenFin?{' '}
        <Link href="/signup" className="text-coral font-semibold hover:underline underline-offset-2">
          Start free trial →
        </Link>
      </p>

      {/* ── Trust badge ── */}
      <div className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-[var(--fg-tertiary)]">
        <ShieldCheck size={11} className="text-teal" strokeWidth={2} />
        <span>Encrypted in transit & at rest</span>
      </div>
    </div>
  )
}
