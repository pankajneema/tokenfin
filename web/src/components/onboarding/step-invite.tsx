'use client'
import { useState, useRef, type KeyboardEvent, type ChangeEvent } from 'react'
import { X, Upload, Users, ArrowRight, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function EmailChip({ email, onRemove }: { email: string; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 bg-coral/10 border border-coral/25 rounded-lg text-[12px] font-medium text-coral max-w-[220px]">
      <span className="truncate">{email}</span>
      <button
        type="button"
        onClick={onRemove}
        className="flex-shrink-0 hover:text-[var(--red)] transition-colors"
        aria-label={`Remove ${email}`}
      >
        <X size={11} strokeWidth={2.5} />
      </button>
    </span>
  )
}

export function StepInvite({
  saving,
  onNext,
  onSkip,
}: {
  saving: boolean
  onNext: (emails: string[]) => void
  onSkip: () => void
}) {
  const [emails,   setEmails]   = useState<string[]>([])
  const [input,    setInput]    = useState('')
  const [inputErr, setInputErr] = useState('')
  const [csvError, setCsvError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  /* ── Add email ── */
  function addEmail(raw: string) {
    const val = raw.trim().toLowerCase()
    if (!val) return
    if (!EMAIL_RE.test(val))  { setInputErr('Invalid email address'); return }
    if (emails.includes(val)) { setInputErr('Already added'); return }
    setEmails(e => [...e, val])
    setInput('')
    setInputErr('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault()
      addEmail(input)
    }
    if (e.key === 'Backspace' && !input && emails.length) {
      setEmails(e => e.slice(0, -1))
    }
  }

  /* ── CSV upload ── */
  function handleCsv(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvError('')
    const reader = new FileReader()
    reader.onload = ev => {
      const text   = ev.target?.result as string
      const parsed = text
        .split(/[\r\n,;]+/)
        .map(s => s.trim().toLowerCase())
        .filter(s => EMAIL_RE.test(s))
        .filter(s => !emails.includes(s))
      if (parsed.length === 0) { setCsvError('No valid emails found in the file'); return }
      setEmails(prev => [...prev, ...parsed])
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  /* ── Paste ── */
  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    if (text.includes(',') || text.includes('\n')) {
      e.preventDefault()
      const parsed = text
        .split(/[\r\n,;]+/)
        .map(s => s.trim().toLowerCase())
        .filter(s => EMAIL_RE.test(s))
        .filter(s => !emails.includes(s))
      setEmails(prev => [...prev, ...parsed])
    }
  }

  return (
    <div className="p-7">

      {/* Invite input area */}
      <div className="space-y-1.5 mb-6">
        <label className="block text-[11px] font-semibold tracking-widest text-[var(--fg-tertiary)] uppercase">
          Team email addresses
        </label>

        {/* Chip input */}
        <div className={cn(
          'min-h-[110px] flex flex-wrap gap-2 p-3 rounded-xl border bg-[var(--bg-secondary)] transition-all cursor-text',
          inputErr ? 'border-[var(--red)]' : 'border-[var(--border)] focus-within:border-coral focus-within:ring-2 focus-within:ring-coral/10'
        )}
          onClick={() => document.getElementById('invite-input')?.focus()}
        >
          {emails.map(e => (
            <EmailChip key={e} email={e} onRemove={() => setEmails(prev => prev.filter(x => x !== e))} />
          ))}
          <input
            id="invite-input"
            type="email"
            value={input}
            onChange={e => { setInput(e.target.value); setInputErr('') }}
            onKeyDown={handleKeyDown}
            onBlur={() => input && addEmail(input)}
            onPaste={handlePaste}
            placeholder={emails.length === 0 ? 'Type emails, press Enter or comma to add...' : 'Add more...'}
            className="flex-1 min-w-[180px] bg-transparent text-[13px] text-[var(--fg)] placeholder:text-[var(--fg-tertiary)] outline-none py-0.5"
          />
        </div>
        {inputErr && <p className="text-[11px] text-[var(--red)] pl-1">{inputErr}</p>}

        {/* Hint row */}
        <div className="flex items-center justify-between px-1">
          <p className="text-[11.5px] text-[var(--fg-tertiary)]">
            {emails.length > 0
              ? <><span className="font-semibold text-coral">{emails.length}</span> teammate{emails.length !== 1 ? 's' : ''} to invite</>
              : 'Separate multiple emails with Enter or comma'}
          </p>
          {input && (
            <button
              type="button"
              onClick={() => addEmail(input)}
              className="flex items-center gap-1 text-[11.5px] text-coral font-medium hover:underline"
            >
              <Plus size={11} /> Add
            </button>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-[var(--border)]" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-[var(--bg)] px-3 text-[11px] font-medium text-[var(--fg-tertiary)] tracking-widest uppercase">or</span>
        </div>
      </div>

      {/* CSV upload */}
      <div className="mb-7">
        <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleCsv} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] hover:border-coral/50 text-[12.5px] text-[var(--fg-secondary)] font-medium transition-all group"
        >
          <Upload size={14} className="group-hover:text-coral transition-colors" />
          Upload CSV file with emails
        </button>
        {csvError && <p className="text-[11px] text-[var(--red)] mt-1.5 text-center">{csvError}</p>}
        <p className="text-center text-[11px] text-[var(--fg-tertiary)] mt-2">
          CSV with one email per line, or comma-separated
        </p>
      </div>

      {/* CTAs */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => onNext(emails)}
          disabled={saving}
          className={cn(
            'w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-[13.5px] font-semibold transition-all duration-150',
            emails.length > 0 && !saving
              ? 'bg-coral text-white hover:bg-[#D4432B] shadow-[0_2px_8px_rgba(232,83,58,0.3)] hover:shadow-[0_4px_14px_rgba(232,83,58,0.38)] active:scale-[0.985]'
              : emails.length === 0
              ? 'bg-[var(--bg-secondary)] text-[var(--fg-secondary)] border border-[var(--border)] hover:bg-[var(--bg-tertiary)]'
              : 'bg-coral/50 text-white cursor-not-allowed'
          )}
        >
          {saving ? (
            <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
          ) : (
            <>
              <Users size={14} strokeWidth={2} />
              {emails.length > 0 ? `Send ${emails.length} invite${emails.length !== 1 ? 's' : ''}` : 'Send invites'}
              <ArrowRight size={14} strokeWidth={2.5} />
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onSkip}
          className="w-full py-2.5 text-[12.5px] text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)] transition-colors font-medium"
        >
          Skip for now — I&apos;ll invite later
        </button>
      </div>
    </div>
  )
}
