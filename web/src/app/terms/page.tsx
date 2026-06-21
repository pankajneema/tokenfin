import type { Metadata } from 'next'
import Link from 'next/link'
import { Zap, ArrowLeft } from 'lucide-react'

export const metadata: Metadata = { title: 'Terms of Service · TokenFin' }

export default function TermsPage() {
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
        <h1 className="text-[28px] font-bold mb-2">Terms of Service</h1>
        <p className="text-[13px] text-[var(--fg-tertiary)] mb-10">Last updated: June 15, 2026</p>

        {[
          {
            title: '1. Acceptance of Terms',
            body: 'By accessing or using TokenFin ("the Service"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service.',
          },
          {
            title: '2. Description of Service',
            body: 'TokenFin is an LLM cost attribution and FinOps platform that provides token-level usage tracking, budget management, and analytics for AI workloads. We reserve the right to modify or discontinue the Service at any time.',
          },
          {
            title: '3. Account Registration',
            body: 'You must provide accurate, complete information when creating an account. You are responsible for maintaining the confidentiality of your credentials and for all activity under your account.',
          },
          {
            title: '4. Acceptable Use',
            body: 'You agree not to misuse the Service — including attempting to reverse-engineer, scrape, overload, or use the platform for unlawful purposes. We may suspend or terminate accounts that violate these terms.',
          },
          {
            title: '5. Data & Privacy',
            body: 'Your use of the Service is also governed by our Privacy Policy. By using TokenFin, you consent to the collection and use of data as described therein.',
          },
          {
            title: '6. Billing & Subscriptions',
            body: 'Paid plans are billed monthly or annually. You may cancel at any time; access continues until the end of the current billing period. We do not offer refunds for partial periods.',
          },
          {
            title: '7. Intellectual Property',
            body: 'All content, trademarks, and software associated with TokenFin are owned by CuriousDevs. Nothing in these terms grants you a right to use our brand assets without written permission.',
          },
          {
            title: '8. Limitation of Liability',
            body: 'To the maximum extent permitted by law, CuriousDevs shall not be liable for indirect, incidental, special, or consequential damages arising out of your use of the Service.',
          },
          {
            title: '9. Changes to Terms',
            body: 'We may update these terms periodically. Continued use of the Service after changes constitutes acceptance of the revised terms. We will notify you of material changes via email.',
          },
          {
            title: '10. Contact',
            body: 'For questions about these terms, contact us at legal@tokenfin.io.',
          },
        ].map(({ title, body }) => (
          <section key={title} className="mb-8">
            <h2 className="text-[15px] font-semibold mb-2">{title}</h2>
            <p className="text-[13.5px] text-[var(--fg-secondary)] leading-relaxed">{body}</p>
          </section>
        ))}

        <div className="mt-12 pt-6 border-t border-[var(--border)] text-[12px] text-[var(--fg-tertiary)] flex items-center justify-between">
          <span>© {new Date().getFullYear()} CuriousDevs</span>
          <Link href="/privacy" className="hover:text-coral transition-colors">Privacy Policy →</Link>
        </div>
      </div>
    </div>
  )
}
