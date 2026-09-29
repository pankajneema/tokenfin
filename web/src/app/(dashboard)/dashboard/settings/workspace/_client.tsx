'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Globe2, KeyRound, Check, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

const card = 'bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-6'

function allTimeZones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone')
    if (list?.length) return ['UTC', ...list.filter(z => z !== 'UTC')]
  } catch { /* older runtimes */ }
  return ['UTC', 'Asia/Kolkata', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney']
}

export function WorkspaceClient({ orgId, isOwner, name: initialName, slug, timezone: initialTz, capturePrompts: initialCapture }: {
  orgId: string; isOwner: boolean; name: string; slug: string; timezone: string; capturePrompts: boolean
}) {
  const router = useRouter()
  const zones = useMemo(allTimeZones, [])
  const [name, setName]     = useState(initialName)
  const [tz, setTz]         = useState(initialTz)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [capture, setCapture] = useState(initialCapture)
  const dirty = name.trim() !== initialName || tz !== initialTz || capture !== initialCapture

  const now = useMemo(() => {
    try { return new Intl.DateTimeFormat(undefined, { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date()) }
    catch { return '' }
  }, [tz])

  async function save() {
    setSaving(true); setSaved(false); setError(null)
    const body: Record<string, string | boolean> = { org_id: orgId }
    if (name.trim() !== initialName) body.name = name.trim()
    if (tz !== initialTz) body.timezone = tz
    if (capture !== initialCapture) body.capture_prompts = capture
    const res = await fetch('/api/v1/orgs', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setSaving(false)
    if (!res.ok) { setError('Could not save. Only the workspace owner can change these settings.'); return }
    setSaved(true)
    router.refresh()
  }

  return (
    <div className="space-y-5">
      <div className={card}>
        <div className="flex items-center gap-2 mb-4">
          <Building2 size={15} className="text-[var(--fg-secondary)]" />
          <h2 className="text-[15px] font-bold text-[var(--fg)]">Workspace</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-[12px] font-medium text-[var(--fg-secondary)]">Name</span>
            <input id="workspace-name" value={name} disabled={!isOwner} onChange={e => { setName(e.target.value); setSaved(false) }}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[13px] text-[var(--fg)] disabled:opacity-60" />
          </label>
          <label className="space-y-1.5">
            <span className="text-[12px] font-medium text-[var(--fg-secondary)]">Workspace ID (slug)</span>
            <input value={slug} disabled className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[13px] text-[var(--fg-tertiary)] font-mono" />
          </label>
        </div>

        <div className="mt-5 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Globe2 size={13} className="text-[var(--fg-secondary)]" />
            <span className="text-[12px] font-medium text-[var(--fg-secondary)]">Time zone</span>
          </div>
          <select id="workspace-timezone" value={tz} disabled={!isOwner} onChange={e => { setTz(e.target.value); setSaved(false) }}
            className="w-full sm:w-80 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[13px] text-[var(--fg)] disabled:opacity-60">
            {zones.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
          <p className="text-[11.5px] text-[var(--fg-tertiary)]">
            Daily charts, “today”, month-to-date and budgets use this zone. Now there: {now}.
            Pick UTC to match Anthropic and OpenAI billing reports. Daily totals already recorded keep the day they were recorded under.
          </p>
        </div>

        <div className="mt-5 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <EyeOff size={13} className="text-[var(--fg-secondary)]" />
            <span className="text-[12px] font-medium text-[var(--fg-secondary)]">Prompt text</span>
          </div>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input id="workspace-capture-prompts" type="checkbox" checked={capture} disabled={!isOwner}
              onChange={e => { setCapture(e.target.checked); setSaved(false) }}
              className="mt-0.5 h-4 w-4 accent-[var(--blue)] disabled:opacity-60" />
            <span className="text-[12.5px] text-[var(--fg)]">Store prompt text sent by Claude Code and the SDKs</span>
          </label>
          <p className="text-[11.5px] text-[var(--fg-tertiary)] pl-[26px]">
            When off, prompt text is dropped the moment it arrives. Tokens, cost and prompt counts are still recorded.
            Stored prompts are always redacted for secrets first.
          </p>
        </div>

        <div className="flex items-center gap-3 mt-5">
          <button onClick={save} disabled={!isOwner || !dirty || saving} className="btn-primary disabled:opacity-50">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {saved && <span className="text-[12px] text-[var(--green)] flex items-center gap-1"><Check size={12} /> Saved</span>}
          {error && <span className="text-[12px] text-[var(--red)]">{error}</span>}
          {!isOwner && <span className="text-[12px] text-[var(--fg-tertiary)]">Only the workspace owner can change these settings.</span>}
        </div>
      </div>

      <div className={card}>
        <div className="flex items-center gap-2 mb-1">
          <KeyRound size={15} className="text-[var(--fg-secondary)]" />
          <h2 className="text-[15px] font-bold text-[var(--fg)]">Single sign-on (SAML SSO)</h2>
        </div>
        <p className="text-[12.5px] text-[var(--fg-secondary)] leading-relaxed">
          Team members can sign in with your company identity provider (Okta, Microsoft Entra ID, Google Workspace, …)
          using <span className="font-semibold">Sign in with SSO</span> on the login page.
        </p>
        <ol className={cn('mt-3 space-y-1.5 text-[12.5px] text-[var(--fg-secondary)] list-decimal pl-5')}>
          <li>Enable SAML SSO in your Supabase project (Authentication → Providers → SAML 2.0).</li>
          <li>Register your identity provider for your email domain, e.g. <code className="font-mono text-[11.5px]">supabase sso add --type saml --metadata-url &lt;url&gt; --domains yourcompany.com</code>.</li>
          <li>Invite teammates from Teams as usual; they then sign in with their company account.</li>
        </ol>
      </div>
    </div>
  )
}
