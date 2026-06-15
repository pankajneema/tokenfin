import type { Metadata } from 'next'
import Link from 'next/link'
import { Zap } from 'lucide-react'

export const metadata: Metadata = {
  title: 'TokenFin · LLM Cost Intelligence',
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">

      {/* ── Body ── */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 pt-20 pb-12 overflow-y-auto">
        <div className="w-full max-w-[400px]">

          {/* Logo — centered above form */}
          <div className="flex flex-col items-center mb-10">
            <Link href="/" className="flex flex-col items-center gap-1.5 group">
              <div className="w-[66px] h-[66px] bg-coral rounded-2xl flex items-center justify-center shadow-md group-hover:shadow-lg transition-shadow">
                <Zap size={32} className="text-white" strokeWidth={2.5} />
              </div>
              <span className="text-[28px] font-bold text-[var(--fg)] tracking-tight">TokenFin</span>
            </Link>
          </div>

          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="py-5 text-center text-[12px] text-[var(--fg-tertiary)] border-t border-[var(--border)]">
        © {new Date().getFullYear()} CuriousDevs &nbsp;·&nbsp;{' '}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-coral transition-colors">Privacy Policy</Link>
        {' '}·{' '}
        <Link href="/terms" className="underline underline-offset-2 hover:text-coral transition-colors">Terms of Service</Link>
      </footer>
    </div>
  )
}
