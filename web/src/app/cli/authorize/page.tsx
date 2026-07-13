import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { CliAuthorizeClient } from './_client'

export const metadata = { title: 'Authorize CLI — TokenFin' }

export default async function CliAuthorizePage({
  searchParams,
}: {
  searchParams: { port?: string; state?: string; label?: string }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // Middleware normally redirects with a preserved ?next=; this is a safety net.
  if (!user) {
    const qs = new URLSearchParams(
      Object.entries(searchParams).filter(([, v]) => typeof v === 'string') as [string, string][]
    ).toString()
    redirect('/login?next=' + encodeURIComponent('/cli/authorize' + (qs ? '?' + qs : '')))
  }

  const port  = Number(searchParams.port)
  const state = searchParams.state ?? ''
  const label = (searchParams.label ?? 'TokenFin CLI').slice(0, 60)
  const valid = Number.isInteger(port) && port >= 1 && port <= 65535 && state.length > 0

  const admin = createAdminClient()
  const { data: members } = await admin.from('members').select('org_id').eq('user_id', user.id).limit(1)
  const hasOrg = !!members?.[0]?.org_id

  return (
    <CliAuthorizeClient
      valid={valid}
      hasOrg={hasOrg}
      port={port}
      state={state}
      label={label}
      email={user.email ?? ''}
    />
  )
}
