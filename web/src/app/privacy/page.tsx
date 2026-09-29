import type { Metadata } from 'next'
import Link from 'next/link'
import { Zap, ArrowLeft } from 'lucide-react'

export const metadata: Metadata = { title: 'Privacy Policy · TokenFin' }

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">

      {/* Top bar */}
      <header className="border-b border-[var(--border)] px-6 py-4 flex items-center justify-between max-w-3xl mx-auto">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-7 h-7 bg-coral rounded-lg flex items-center justify-center">
            <Zap size={13} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="font-bold text-[15px] text-[var(--fg)]">TokenFin</span>
        </Link>
        <Link href="/login" className="flex items-center gap-1.5 text-[12px] text-[var(--fg-secondary)] hover:text-coral transition-colors">
          <ArrowLeft size={13} /> Back to login
        </Link>
      </header>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-[28px] font-bold mb-2">Privacy Policy</h1>
        <p className="text-[13px] text-[var(--fg-tertiary)] mb-10">Last updated: September 29, 2026</p>

        {[
          {
            title: '1. Information We Collect',
            body: 'We collect information you provide directly (name, email, organization details), usage data (model, token counts, cost, session and repository identifiers, and the email your coding agent reports), and technical data (IP address, browser type, device info) to operate and improve the Service. If prompt capture is on (see section 2), we also receive the text of the prompts you type into connected coding agents.',
          },
          {
            title: '2. Prompt Text',
            body: 'By default, `npx tokenfin@latest setup` turns on prompt logging in Claude Code, Codex and Gemini CLI, so the text of each prompt you type is sent to TokenFin alongside its token counts and shown to your workspace in Prompt Analytics. We never receive model responses, your files, or your model-provider API keys. You can opt out on any machine with `npx tokenfin@latest setup --no-prompts`; a workspace owner or admin can switch prompt capture off for the whole workspace in Settings → Workspace, in which case prompt text is discarded on arrival. Captured prompt text is deleted automatically after 90 days, and owners can delete it sooner in Settings → Data.',
          },
          {
            title: '3. How We Use Your Information',
            body: 'We use collected data to provide and improve the Service, send transactional emails (account confirmations, alerts), generate aggregated analytics, and comply with legal obligations. We do not sell your personal data.',
          },
          {
            title: '4. Data Storage & Security',
            body: 'Your data is stored on Supabase-hosted PostgreSQL in the US. We use 256-bit TLS encryption in transit and AES-256 at rest. API keys are stored as SHA-256 hashes. The few keys we must be able to show again (the workspace setup key and unopened one-time reveal links, which expire) are additionally kept AES-256-GCM encrypted.',
          },
          {
            title: '5. Cookies & Tracking',
            body: 'We use session cookies for authentication and local storage for UI preferences. We do not use third-party advertising trackers. You can disable cookies in your browser but some features may not function correctly.',
          },
          {
            title: '6. Data Sharing',
            body: 'We share data with subprocessors necessary to operate the Service (Supabase, email providers). We do not share your data with third parties for marketing. We may disclose data if required by law.',
          },
          {
            title: '7. Data Retention',
            body: 'Usage data is kept until you delete it. Workspace owners can delete monitoring data older than 7, 30 or 90 days, or all of it, at any time in Settings → Data, and can set automatic retention so older data is deleted daily. Captured prompt text expires after 90 days, and prompt capture can be switched off per machine or for the whole workspace (section 2). Account data is retained while your account is active and for 30 days after deletion, then permanently erased.',
          },
          {
            title: '8. Your Rights',
            body: 'Depending on your jurisdiction, you may have the right to access, correct, export, or delete your personal data. To exercise these rights, contact us at privacy@tokenfin.io. We respond within 30 days.',
          },
          {
            title: '9. Children\'s Privacy',
            body: 'The Service is not directed to children under 16. We do not knowingly collect personal information from minors. If you believe we have collected such data, contact us immediately.',
          },
          {
            title: '10. Changes to This Policy',
            body: 'We may update this policy from time to time. We will notify you of significant changes via email or an in-app banner. Your continued use of the Service after changes constitutes acceptance.',
          },
          {
            title: '11. Contact Us',
            body: 'For privacy-related questions or data requests, email us at privacy@tokenfin.io or write to CuriousDevs, Privacy Team.',
          },
        ].map(({ title, body }) => (
          <section key={title} className="mb-8">
            <h2 className="text-[15px] font-semibold mb-2">{title}</h2>
            <p className="text-[13.5px] text-[var(--fg-secondary)] leading-relaxed">{body}</p>
          </section>
        ))}

        <div className="mt-12 pt-6 border-t border-[var(--border)] text-[12px] text-[var(--fg-tertiary)] flex items-center justify-between">
          <span>© {new Date().getFullYear()} CuriousDevs</span>
          <Link href="/terms" className="hover:text-coral transition-colors">Terms of Service →</Link>
        </div>
      </div>
    </div>
  )
}
