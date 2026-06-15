import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect }     from 'next/navigation'

export const metadata: Metadata = { title: 'Analytics · TokenFin' }

export default async function AnalyticsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--fg)' }}>Analytics</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--fg-muted)' }}>
          Token usage, cost trends, and model breakdown across your organization.
        </p>
      </div>

      {/* Placeholder — wire up AnalyticsClient component once data layer is live */}
      <div className="card p-8 text-center">
        <div className="text-3xl mb-3">📊</div>
        <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--fg)' }}>
          Analytics coming soon
        </h2>
        <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
          Start tracking events with the SDK and data will appear here.
        </p>
      </div>
    </div>
  )
}
