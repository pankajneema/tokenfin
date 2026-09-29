import { redirect } from 'next/navigation'
import { getOrgContext } from '@/lib/org-context'
import { CliDeviceClient } from './_client'

export const metadata = { title: 'Approve device' }

/**
 * /cli/device — approve a `npx tokenfin@latest login --device` code.
 * Signed-in users only (middleware redirects to /login?next=… preserving ?code).
 */
export default async function CliDevicePage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ code?: string; device?: string; device_id?: string }>
}) {
  const sp = await searchParamsPromise
  const ctx = await getOrgContext()
  if (!ctx) {
    const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === 'string') as [string, string][]).toString()
    redirect('/login?next=' + encodeURIComponent('/cli/device' + (qs ? '?' + qs : '')))
  }
  const device = (sp.device ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 60)
  const deviceId = /^[A-Za-z0-9._:-]{1,128}$/.test(sp.device_id ?? '') ? (sp.device_id as string) : ''
  return (
    <CliDeviceClient
      initialCode={(sp.code ?? '').slice(0, 16)}
      device={device}
      deviceId={deviceId}
      email={ctx.user.email ?? ''}
      hasOrg={!!ctx.orgId}
    />
  )
}
