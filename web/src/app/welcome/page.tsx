'use client'
/**
 * /welcome — first stop after signup for a user with no workspace.
 * TokenFin is free and unlimited, so there is nothing to choose: create the
 * workspace and continue to onboarding.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function WelcomePage() {
  const router   = useRouter()
  const supabase = createClient()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  const createWorkspace = useCallback(async () => {
    setError(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/login'); return }

    const base = user.email!.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-')
    const res = await fetch('/api/v1/orgs', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        name: (user.user_metadata?.full_name as string | undefined) ?? base,
        slug: base + '-' + Math.random().toString(36).slice(2, 6),
      }),
    })
    // 200 = the user already belongs to a workspace; 201 = created.
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(typeof body.error === 'string' ? body.error : 'Could not create your workspace.')
      return
    }
    router.replace(res.status === 201 ? '/onboarding' : '/dashboard')
    router.refresh()
  }, [router, supabase])

  useEffect(() => {
    if (started.current) return
    started.current = true
    createWorkspace()
  }, [createWorkspace])

  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
      <div className="max-w-sm text-center space-y-3">
        {error ? (
          <>
            <h1 className="text-[18px] font-semibold text-[var(--fg)]">Workspace setup failed</h1>
            <p className="text-[13px] text-[var(--fg-secondary)]">{error}</p>
            <button onClick={createWorkspace} className="btn-primary">Try again</button>
          </>
        ) : (
          <>
            <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-[var(--border)] border-t-coral" />
            <h1 className="text-[18px] font-semibold text-[var(--fg)]">Setting up your workspace</h1>
            <p className="text-[13px] text-[var(--fg-secondary)]">TokenFin is free with unlimited monitoring.</p>
          </>
        )}
      </div>
    </main>
  )
}
