import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/org-context'
import { CliAuthorizeClient } from './_client'

export const metadata = { title: 'Authorize CLI — TokenFin' }

export default async function CliAuthorizePage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ port?: string; state?: string; label?: string; device?: string; device_id?: string }>
}) {
  const searchParams = await searchParamsPromise
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
  // `device` (new CLI) or `label` (older CLI, hostname) — shown to the user and used as the key name.
  const label = (searchParams.device ?? searchParams.label ?? 'TokenFin CLI').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 60)
  const rawDeviceId = (searchParams.device_id ?? '').slice(0, 128)
  const deviceId = /^[A-Za-z0-9._:-]{1,128}$/.test(rawDeviceId) ? rawDeviceId : ''
  const valid = Number.isInteger(port) && port >= 1 && port <= 65535 && state.length > 0

  const ctx = await getOrgContext()
  const hasOrg = !!ctx?.orgId

  return (
    <CliAuthorizeClient
      valid={valid}
      hasOrg={hasOrg}
      port={port}
      state={state}
      label={label}
      deviceId={deviceId}
      email={user.email ?? ''}
    />
  )
}
