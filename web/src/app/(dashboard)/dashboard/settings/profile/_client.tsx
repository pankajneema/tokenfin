'use client'
import { useState, useRef } from 'react'
import {
  Camera, Save, Eye, EyeOff, Shield, Trash2,
  Check, AlertTriangle, Globe, Lock, Mail, Copy,
  Key, LogOut, Monitor,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createBrowserClient } from '@supabase/ssr'

/* ── helpers ── */
function Section({ title, desc, children, danger }: {
  title: string; desc?: string; children: React.ReactNode; danger?: boolean
}) {
  return (
    <div className={cn('bg-white dark:bg-[#141428] border rounded-2xl overflow-hidden',
      danger ? 'border-[var(--red)]/35' : 'border-[var(--border)]')}>
      <div className={cn('px-6 py-4 border-b', danger ? 'border-[var(--red)]/20 bg-[var(--red-bg)]/50' : 'border-[var(--border)]')}>
        <h2 className={cn('text-[13.5px] font-bold', danger ? 'text-[var(--red)]' : 'text-[var(--fg)]')}>{title}</h2>
        {desc && <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">{desc}</p>}
      </div>
      <div className="px-6 py-5 space-y-5">{children}</div>
    </div>
  )
}

function Divider() {
  return <div className="border-t border-[var(--border)] -mx-6" />
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-6 items-start">
      <div className="pt-2.5">
        <p className="text-[12.5px] font-semibold text-[var(--fg)]">{label}</p>
        {hint && <p className="text-[11px] text-[var(--fg-tertiary)] mt-0.5 leading-snug">{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  )
}

function TextInput({ value, onChange, placeholder, disabled, type = 'text' }: {
  value: string; onChange?: (v: string) => void; placeholder?: string; disabled?: boolean; type?: string
}) {
  return (
    <input type={type} value={value} onChange={e => onChange?.(e.target.value)}
      placeholder={placeholder} disabled={disabled}
      className={cn(
        'w-full px-3 py-2.5 rounded-xl border text-[13px] text-[var(--fg)] bg-[var(--bg)] transition-all focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral',
        disabled
          ? 'border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--fg-tertiary)] cursor-not-allowed'
          : 'border-[var(--border)] hover:border-[var(--border-strong)]',
      )}
    />
  )
}

function SaveToast({ show }: { show: boolean }) {
  return (
    <div className={cn(
      'fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2.5 px-4 py-3 bg-[var(--fg)] text-[var(--bg)] rounded-2xl shadow-2xl text-[13px] font-semibold transition-all duration-300 z-50',
      show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none',
    )}>
      <Check size={14} className="text-teal" /> Changes saved
    </div>
  )
}


/* ══════════════════════════════════════════════════════════════
   CLIENT COMPONENT
══════════════════════════════════════════════════════════════ */
interface Props {
  userId:           string
  initialName:      string
  initialHandle:    string
  initialBio:       string
  initialTimezone:  string
  initialLang:      string
  email:            string
  role:             string
  orgName:          string
}

export function ProfileClient({
  userId, initialName, initialHandle, initialBio,
  initialTimezone, initialLang, email, role, orgName,
}: Props) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  const [name,       setName]       = useState(initialName)
  const [handle,     setHandle]     = useState(initialHandle)
  const [bio,        setBio]        = useState(initialBio)
  const [timezone,   setTimezone]   = useState(initialTimezone)
  const [lang,       setLang]       = useState(initialLang)
  const [currPw,     setCurrPw]     = useState('')
  const [newPw,      setNewPw]      = useState('')
  const [confPw,     setConfPw]     = useState('')
  const [showPw,     setShowPw]     = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [toast,      setToast]      = useState(false)
  const [pwSaving,   setPwSaving]   = useState(false)
  const [pwError,    setPwError]    = useState<string | null>(null)
  const [pwSuccess,  setPwSuccess]  = useState(false)
  const [deleteText, setDeleteText] = useState('')
  const [copied,     setCopied]     = useState(false)
  const avatarRef = useRef<HTMLInputElement>(null)

  async function saveProfile() {
    setSaving(true)
    await supabase.auth.updateUser({
      data: { full_name: name, handle, bio, timezone, lang },
    })
    setSaving(false); setToast(true)
    setTimeout(() => setToast(false), 2500)
  }

  async function updatePassword() {
    setPwSaving(true); setPwError(null); setPwSuccess(false)
    const { error } = await supabase.auth.updateUser({ password: newPw })
    if (error) setPwError(error.message)
    else { setPwSuccess(true); setCurrPw(''); setNewPw(''); setConfPw('') }
    setPwSaving(false)
  }

  function copyEmail() {
    navigator.clipboard.writeText(email)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const pwStrength = newPw.length === 0 ? 0 : newPw.length < 6 ? 1 : newPw.length < 8 ? 2 : /[^a-zA-Z0-9]/.test(newPw) ? 4 : 3
  const pwLabel    = ['', 'Too short', 'Weak', 'Good', 'Strong'][pwStrength]
  const pwColors   = ['', 'bg-[var(--red)]', 'bg-[var(--amber)]', 'bg-teal', 'bg-teal']
  const pwMatch    = newPw.length > 0 && confPw.length > 0 && newPw === confPw
  const pwMismatch = confPw.length > 0 && !pwMatch
  const roleLabel  = role.charAt(0).toUpperCase() + role.slice(1)

  return (
    <>
      {/* Avatar + quick info */}
      <Section title="Profile photo & identity">
        <div className="flex items-center gap-6">
          <div className="relative group flex-shrink-0">
            <div className="w-[72px] h-[72px] rounded-2xl bg-gradient-to-br from-coral to-[#f07260] flex items-center justify-center shadow-lg">
              <span className="text-[26px] font-bold text-white select-none">
                {(name || email || 'U')[0].toUpperCase()}
              </span>
            </div>
            <button onClick={() => avatarRef.current?.click()}
              className="absolute inset-0 rounded-2xl bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Camera size={17} className="text-white" />
            </button>
            <input ref={avatarRef} type="file" accept="image/*" className="hidden" />
            <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-teal border-2 border-white dark:border-[#141428]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[16px] font-bold text-[var(--fg)]">{name || email}</p>
              <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-coral/15 text-coral">{roleLabel}</span>
            </div>
            {orgName && <p className="text-[11.5px] text-[var(--fg-tertiary)] mt-0.5">{orgName}</p>}
            <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">@{handle} · {email}</p>
            <div className="flex items-center gap-2 mt-2">
              <button onClick={() => avatarRef.current?.click()} className="btn-secondary text-[11.5px] py-1.5 px-3">
                <Camera size={12} /> Change photo
              </button>
              <span className="text-[10.5px] text-[var(--fg-tertiary)]">JPG, PNG or GIF · max 2 MB</span>
            </div>
          </div>
        </div>
      </Section>

      {/* Personal info */}
      <Section title="Personal information" desc="Your name, handle, bio and locale preferences">
        <Field label="Full name">
          <TextInput value={name} onChange={setName} placeholder="Your full name" />
        </Field>
        <Divider />
        <Field label="Username" hint="Appears in API attribution logs and team views">
          <div className="flex items-center rounded-xl border border-[var(--border)] overflow-hidden focus-within:border-coral focus-within:ring-2 focus-within:ring-coral/30 hover:border-[var(--border-strong)] transition-all">
            <span className="px-3 py-2.5 text-[12.5px] text-[var(--fg-tertiary)] bg-[var(--bg-secondary)] border-r border-[var(--border)] select-none">@</span>
            <input value={handle} onChange={e => setHandle(e.target.value)}
              className="flex-1 px-3 py-2.5 text-[13px] text-[var(--fg)] bg-transparent focus:outline-none" />
          </div>
        </Field>
        <Divider />
        <Field label="Email address" hint="Managed by your auth provider — contact admin to change">
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]" />
              <input value={email} disabled
                className="w-full pl-8 pr-10 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg-tertiary)] bg-[var(--bg-secondary)] cursor-not-allowed" />
              <button onClick={copyEmail}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)] hover:text-coral transition-colors">
                {copied ? <Check size={13} className="text-teal" /> : <Copy size={13} />}
              </button>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--green-bg)] flex-shrink-0">
              <Shield size={11} className="text-teal" />
              <span className="text-[10.5px] font-semibold text-teal whitespace-nowrap">Verified</span>
            </div>
          </div>
        </Field>
        <Divider />
        <Field label="Bio" hint="Shown on team pages · max 160 chars">
          <textarea value={bio} onChange={e => setBio(e.target.value)}
            rows={3} maxLength={160}
            className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] resize-none focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral hover:border-[var(--border-strong)] transition-all" />
          <div className="flex justify-end mt-1">
            <span className={cn('text-[11px]', bio.length > 140 ? 'text-[var(--amber)]' : 'text-[var(--fg-tertiary)]')}>
              {bio.length}/160
            </span>
          </div>
        </Field>
        <Divider />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Timezone">
            <div className="relative">
              <Globe size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)] pointer-events-none" />
              <select value={timezone} onChange={e => setTimezone(e.target.value)}
                className="w-full pl-8 pr-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral hover:border-[var(--border-strong)] transition-all appearance-none">
                <option value="Asia/Kolkata">Asia/Kolkata (IST +5:30)</option>
                <option value="America/New_York">America/New_York (EST −5)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PST −8)</option>
                <option value="Europe/London">Europe/London (GMT)</option>
                <option value="Europe/Berlin">Europe/Berlin (CET +1)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
          </Field>
          <Field label="Language">
            <select value={lang} onChange={e => setLang(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral hover:border-[var(--border-strong)] transition-all appearance-none">
              <option value="en">English</option>
              <option value="hi">हिन्दी</option>
              <option value="ja">日本語</option>
              <option value="de">Deutsch</option>
              <option value="fr">Français</option>
            </select>
          </Field>
        </div>
        <div className="flex justify-end pt-1">
          <button onClick={saveProfile} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving
              ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Saving…</>
              : <><Save size={13} /> Save changes</>
            }
          </button>
        </div>
      </Section>

      {/* Password */}
      <Section title="Password & security" desc="Update your password or enable two-factor authentication">
        <Field label="Current password">
          <div className="relative">
            <TextInput type={showPw ? 'text' : 'password'} value={currPw} onChange={setCurrPw} placeholder="Enter current password" />
            <button type="button" onClick={() => setShowPw(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)] hover:text-[var(--fg)] transition-colors">
              {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>
        <Divider />
        <Field label="New password" hint="Min 8 chars · use a mix of letters, numbers & symbols">
          <TextInput type={showPw ? 'text' : 'password'} value={newPw} onChange={setNewPw} placeholder="New password" />
          {newPw.length > 0 && (
            <div className="mt-2 space-y-1.5">
              <div className="flex gap-1">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className={cn('h-1 flex-1 rounded-full transition-all duration-300',
                    i <= pwStrength ? pwColors[pwStrength] : 'bg-[var(--bg-tertiary)]')} />
                ))}
              </div>
              <p className={cn('text-[11px] font-semibold', pwColors[pwStrength].replace('bg-', 'text-'))}>{pwLabel}</p>
            </div>
          )}
        </Field>
        <Field label="Confirm password">
          <TextInput type={showPw ? 'text' : 'password'} value={confPw} onChange={setConfPw} placeholder="Confirm new password" />
          {confPw.length > 0 && (
            <p className={cn('text-[11.5px] mt-1.5 flex items-center gap-1', pwMatch ? 'text-teal' : 'text-[var(--red)]')}>
              {pwMatch ? <><Check size={11} /> Passwords match</> : <><AlertTriangle size={11} /> Passwords don&apos;t match</>}
            </p>
          )}
          {pwError && <p className="text-[11.5px] mt-1.5 text-[var(--red)]">{pwError}</p>}
          {pwSuccess && <p className="text-[11.5px] mt-1.5 text-teal flex items-center gap-1"><Check size={11} /> Password updated</p>}
        </Field>
        <Divider />
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-semibold text-[var(--fg)]">Two-factor authentication</p>
            <p className="text-[11.5px] text-[var(--fg-secondary)] mt-0.5">Add an authenticator app for extra login security</p>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[var(--amber-bg)] text-[var(--amber)]">Not enabled</span>
            <button className="btn-secondary text-[12px] py-1.5"><Lock size={12} /> Enable 2FA</button>
          </div>
        </div>
        <Divider />
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-semibold text-[var(--fg)]">Personal API token</p>
            <p className="text-[11.5px] text-[var(--fg-secondary)] mt-0.5">Use for CLI tools and personal scripts</p>
          </div>
          <button className="btn-secondary text-[12px] py-1.5"><Key size={12} /> Generate token</button>
        </div>
        <div className="flex justify-end pt-1">
          <button disabled={!currPw || !pwMatch} onClick={updatePassword}
            className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
            {pwSaving
              ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Updating…</>
              : <><Lock size={13} /> Update password</>
            }
          </button>
        </div>
      </Section>

      {/* Active sessions */}
      <Section title="Active sessions" desc="Devices currently signed into your TokenFin account">
        <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
          <div className="w-10 h-10 rounded-xl bg-[var(--bg-secondary)] flex items-center justify-center">
            <Monitor size={18} className="text-[var(--fg-tertiary)]" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-[var(--fg)]">Session tracking not yet available</p>
            <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">
              Active sessions require server-side tracking. Manage your auth sessions via{' '}
              <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer" className="text-coral hover:underline">
                Supabase Auth
              </a>.
            </p>
          </div>
        </div>
        <button onClick={async () => { await supabase.auth.signOut() }}
          className="text-[12px] font-semibold text-[var(--red)] hover:opacity-80 flex items-center gap-1.5 transition-opacity">
          <LogOut size={13} /> Sign out of current session
        </button>
      </Section>

      {/* Danger zone */}
      <Section title="Danger zone" desc="Permanent, irreversible actions" danger>
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-[13px] font-semibold text-[var(--fg)]">Delete account</p>
            <p className="text-[12px] text-[var(--fg-secondary)] mt-1 max-w-[360px] leading-relaxed">
              Permanently deletes your account, all projects, API keys, and usage history. This cannot be undone.
            </p>
          </div>
          <button className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--red)]/40 text-[var(--red)] text-[12.5px] font-semibold hover:bg-[var(--red-bg)] transition-colors">
            <Trash2 size={13} /> Delete account
          </button>
        </div>
        <div className="p-4 bg-[var(--red-bg)] rounded-xl border border-[var(--red)]/20 space-y-2">
          <p className="text-[11.5px] text-[var(--fg-secondary)]">
            Type <code className="font-mono font-bold text-[var(--fg)]">delete my account</code> to confirm
          </p>
          <input value={deleteText} onChange={e => setDeleteText(e.target.value)}
            placeholder="delete my account"
            className="w-full px-3 py-2 rounded-lg border border-[var(--red)]/30 text-[12.5px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:border-[var(--red)] transition-colors" />
          <button disabled={deleteText !== 'delete my account'}
            className="w-full py-2 rounded-lg bg-[var(--red)] text-white text-[12.5px] font-bold transition-opacity disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90">
            Permanently delete account
          </button>
        </div>
      </Section>

      <SaveToast show={toast} />
    </>
  )
}
