import type { Metadata } from 'next'
import Link from 'next/link'

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
            <Link href="/" className="flex flex-col items-center gap-3 group">
              <img
                src="/favicon.svg"
                alt="TokenFin"
                className="w-[66px] h-[66px] group-hover:opacity-90 transition-opacity"
              />
              <img
                src="/logo.svg"
                alt="TokenFin"
                className="h-7 w-auto group-hover:opacity-90 transition-opacity"
              />
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
