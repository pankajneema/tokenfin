'use client'
import useSWR from 'swr'
import type { ApiKey } from '@/types/db'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export function useApiKeys(orgId: string) {
  const { data, error, isLoading, mutate } = useSWR<ApiKey[]>(
    orgId ? `/api/v1/keys?org_id=${orgId}` : null,
    fetcher
  )
  return { keys: data ?? [], error, isLoading, refresh: mutate }
}
