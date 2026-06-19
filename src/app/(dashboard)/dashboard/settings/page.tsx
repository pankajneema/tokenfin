'use client'
import { useState, useRef } from 'react'
import {
  Camera, Save, Eye, EyeOff, Shield, Trash2,
  Check, AlertTriangle, Globe, Lock, Mail,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ── Section card ── */
function Section({ title, desc, children, danger }: {
  title: string; desc?: string; children: React.ReactNode; danger?: boolean
}) {
  return (
    <div className={cn(
      'bg-white dark:bg-[#141428] border rounded-2xl overflow-hidden',
      danger ? 'border-[var(--red)]/30' : 'border-[var(--border)]',
    )}>
      <div className={cn('px-6 py-4 border-b', danger ? 'border-[var(--red)]/20 bg-[var(--red-bg)]/40' : 'border-[var(--border)]')}>
        <h2 className={cn('text-[13.5px] font-bold', danger ? 'text-[var(--red)]' : 'text-[var(--fg)]')}>{title}</h2>
        {desc && <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">{desc}</p>}
      </div>
      <div className="px-6 py-5 space-y-4">{children}</div>
    </div>
  )
}

/* ── Field ── */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-4 items-start">
      <div className="pt-2.5">
        <p className="text-[12.5px] font-semibold text-[var(--fg)]">{label}</p>
        {hint && <p className="text-[11px] text-[var(--fg-tertiary)] mt-0.5 leading-snug">{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  )
}

/* ── Input ── */
function TextInput({ value, onChange, placeholder, disabled, type = 'text' }: {
  value: string; onChange?: (v: string) => void; placeholder?: string
  disabled?: boolean; type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange?.(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={cn(
        'w-full px-3 py-2.5 rounded-xl border text-[13px] text-[var(--fg)] bg-[var(--bg)] transition-all focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral',
        disabled
          ? 'border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--fg-tertiary)] cursor-not-allowed'
          : 'border-[var(--border)] hover:border-[var(--border-strong)]',
      )}
    />
  )
}

/* ── Save toast ── */
function SaveToast({ show }: { show: boolean }) {
  return (
    <div className={cn(
      'fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2.5 px-4 py-3 bg-[var(--fg)] text-[var(--bg)] rounded-2xl shadow-2xl text-[13px] font-semibold transition-all duration-300 z-50',
      show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none',
    )}>
      <Check size={15} className="text-teal" /> Changes saved
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════ */
export default function ProfilePage() {
  /* ── State ── */
  const [name,      setName]      = useState('Pankaj Kumar')
  const [handle,    setHandle]    = useState('pankaj')
  const [email,     _setEmail]    = useState('pankaj200321@gmail.com')
  const [bio,       setBio]       = useState('Building TokenFin — LLM cost attribution & FinOps platform.')
  const [timezone,  setTimezone]  = useState('Asia/Kolkata')
  const [lang,      setLang]      = useState('en')
  const [currPw,    setCurrPw]    = useState('')
  const [newPw,     setNewPw]     = useState('')
  const [confPw,    setConfPw]    = useState('')
  const [showPw,    setShowPw]    = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [toast,     setToast]     = useState(false)
  const [deleteText,setDeleteText]= useState('')
  const avatarRef = useRef<HTMLInputElement>(null)

  async function handleSave() {
    setSaving(true)
    await new Promise(r => setTimeout(r, 800))
    setSaving(false)
    setToast(true)
    setTimeout(() => setToast(false), 2500)
  }

  const pwMatch    = newPw && confPw && newPw === confPw
  const pwMismatch = newPw && confPw && newPw !== confPw

  return (
    <>
      {/* ── Avatar ── */}
      <Section title="Profile photo" desc="Your avatar is shown across the dashboard and emails">
        <div className="flex items-center gap-5">
          <div className="relative group">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-coral to-[#f07260] flex items-center justify-center shadow-md">
              <span className="text-[28px] font-bold text-white">P</span>
            </div>
            <button
              onClick={() => avatarRef.current?.click()}
              className="absolute inset-0 rounded-2xl bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
            >
              <Camera size={18} className="text-white" />
            </button>
            <input ref={avatarRef} type="file" accept="image/*" className="hidden" />
          </div>
          <div>
            <button
              onClick={() => avatarRef.current?.click()}
              className="btn-secondary text-[12.5px] py-2"
            >
              <Camera size={13} /> Change photo
            </button>
            <p className="text-[11px] text-[var(--fg-tertiary)] mt-2">JPG, PNG or GIF · max 2MB</p>
          </div>
        </div>
      </Section>

      {/* ── Personal info ── */}
      <Section title="Personal information" desc="Update your name, handle and bio">
        <Field label="Full name">
          <TextInput value={name} onChange={setName} placeholder="Your full name" />
        </Field>

        <div className="border-t border-[var(--border)] -mx-6 my-1" />

        <Field label="Username" hint="Used in API attribution logs">
          <div className="flex items-center gap-0 rounded-xl border border-[var(--border)] overflow-hidden hover:border-[var(--border-strong)] focus-within:border-coral focus-within:ring-2 focus-within:ring-coral/30 transition-all">
            <span className="px-3 py-2.5 text-[12.5px] text-[var(--fg-tertiary)] bg-[var(--bg-secondary)] border-r border-[var(--border)] select-none">
              @
            </span>
            <input
              value={handle}
              onChange={e => setHandle(e.target.value)}
              className="flex-1 px-3 py-2.5 text-[13px] text-[var(--fg)] bg-transparent focus:outline-none"
            />
          </div>
        </Field>

        <div className="border-t border-[var(--border)] -mx-6 my-1" />

        <Field label="Email address" hint="Managed by your SSO provider">
          <div className="flex items-center gap-2">
            <TextInput value={email} disabled />
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--green-bg)] flex-shrink-0">
              <Shield size={11} className="text-teal" />
              <span className="text-[10.5px] font-semibold text-teal">Verified</span>
            </div>
          </div>
        </Field>

        <div className="border-t border-[var(--border)] -mx-6 my-1" />

        <Field label="Bio" hint="Shown on team member pages">
          <textarea
            value={bio}
            onChange={e => setBio(e.target.value)}
            rows={3}
            maxLength={160}
            className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] resize-none focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral hover:border-[var(--border-strong)] transition-all"
          />
          <p className="text-[11px] text-[var(--fg-tertiary)] mt-1 text-right">{bio.length}/160</p>
        </Field>

        <div className="border-t border-[var(--border)] -mx-6 my-1" />

        <div className="grid grid-cols-2 gap-4">
          <Field label="Timezone">
            <div className="relative">
              <Globe size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]" />
              <select
                value={timezone}
                onChange={e => setTimezone(e.target.value)}
                className="w-full pl-8 pr-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral hover:border-[var(--border-strong)] transition-all appearance-none"
              >
                <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                <option value="America/New_York">America/New_York (EST)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
                <option value="Europe/London">Europe/London (GMT)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
          </Field>
          <Field label="Language">
            <select
              value={lang}
              onChange={e => setLang(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral hover:border-[var(--border-strong)] transition-all appearance-none"
            >
              <option value="en">English</option>
              <option value="hi">हिन्दी</option>
              <option value="ja">日本語</option>
            </select>
          </Field>
        </div>

        <div className="flex justify-end pt-2">
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving
              ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Saving…</>
              : <><Save size={13} /> Save changes</>
            }
          </button>
        </div>
      </Section>

      {/* ── Password ── */}
      <Section title="Password & security" desc="Change your password or set up two-factor auth">
        <Field label="Current password">
          <div className="relative">
            <TextInput
              type={showPw ? 'text' : 'password'}
              value={currPw}
              onChange={setCurrPw}
              placeholder="Enter current password"
            />
            <button
              type="button"
              onClick={() => setShowPw(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)] hover:text-[var(--fg)] transition-colors"
            >
              {showPw ? <EyeOff size={14}/> : <Eye size={14}/>}
            </button>
          </div>
        </Field>

        <div className="border-t border-[var(--border)] -mx-6 my-1" />

        <Field label="New password" hint="Minimum 8 characters">
          <TextInput
            type={showPw ? 'text' : 'password'}
            value={newPw}
            onChange={setNewPw}
            placeholder="New password"
          />
          {newPw && (
            <div className="flex gap-1 mt-2">
              {[4,6,8,10].map((len, i) => (
                <div key={i} className={cn('h-1 flex-1 rounded-full transition-colors', newPw.length >= len ? ['bg-[var(--red)]','bg-[var(--amber)]','bg-teal','bg-teal'][i] : 'bg-[var(--bg-tertiary)]')} />
              ))}
              <span className="text-[10.5px] text-[var(--fg-tertiary)] ml-1">
                {newPw.length < 4 ? 'Too short' : newPw.length < 6 ? 'Weak' : newPw.length < 8 ? 'Fair' : 'Strong'}
              </span>
            </div>
          )}
        </Field>

        <Field label="Confirm password">
          <TextInput
            type={showPw ? 'text' : 'password'}
            value={confPw}
            onChange={setConfPw}
            placeholder="Confirm new password"
          />
          {confPw && (
            <p className={cn('text-[11.5px] mt-1.5 flex items-center gap-1', pwMatch ? 'text-teal' : 'text-[var(--red)]')}>
              {pwMatch ? <><Check size={11}/> Passwords match</> : <><AlertTriangle size={11}/> Passwords don't match</>}
            </p>
          )}
        </Field>

        <div className="border-t border-[var(--border)] -mx-6 my-1" />

        {/* 2FA row */}
        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-[13px] font-semibold text-[var(--fg)]">Two-factor authentication</p>
            <p className="text-[11.5px] text-[var(--fg-secondary)] mt-0.5">Add an extra layer of security to your account</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[var(--amber-bg)] text-[var(--amber)]">Not enabled</span>
            <button className="btn-secondary text-[12px] py-1.5">
              <Lock size={12}/> Enable 2FA
            </button>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            disabled={!currPw || !pwMatch}
            className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Lock size={13}/> Update password
          </button>
        </div>
      </Section>

      {/* ── Danger zone ── */}
      <Section title="Danger zone" desc="Irreversible actions — proceed with caution" danger>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[13px] font-semibold text-[var(--fg)]">Delete account</p>
            <p className="text-[12px] text-[var(--fg-secondary)] mt-1 max-w-[380px]">
              Permanently removes your account, all projects, API keys and usage data. This cannot be undone.
            </p>
          </div>
          <button className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--red)]/40 text-[var(--red)] text-[12.5px] font-semibold hover:bg-[var(--red-bg)] transition-colors">
            <Trash2 size={13}/> Delete account
          </button>
        </div>

        {/* Confirmation input */}
        <div className="mt-2 p-4 bg-[var(--red-bg)] rounded-xl border border-[var(--red)]/20">
          <p className="text-[11.5px] text-[var(--fg-secondary)] mb-2">
            Type <span className="font-mono font-bold text-[var(--fg)]">delete my account</span> to confirm
          </p>
          <input
            value={deleteText}
            onChange={e => setDeleteText(e.target.value)}
            placeholder="delete my account"
            className="w-full px-3 py-2 rounded-lg border border-[var(--red)]/30 text-[12.5px] text-[var(--fg)] bg-[var(--bg)] focus:outline-none focus:border-[var(--red)] transition-colors"
          />
        </div>
      </Section>

      <SaveToast show={toast} />
    </>
  )
}
