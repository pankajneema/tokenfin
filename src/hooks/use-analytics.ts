'use client'
import useSWR from 'swr'
import type { AnalyticsResponse } from '@/types/api'

const fetcher = (url: string) => fetch(url).then(r => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
})

export function useAnalytics(orgId: string, days = 30, projectId?: string) {
  const params = new URLSearchParams({ org_id: orgId, days: String(days) })
  if (projectId) params.set('project_id', projectId)

  const { data, error, isLoading, mutate } = useSWR<AnalyticsResponse>(
    orgId ? `/api/v1/analytics?${params}` : null,
    fetcher,
    { refreshInterval: 60_000 }   // refresh every 60 s
  )

  return { data, error, isLoading, refresh: mutate }
}
