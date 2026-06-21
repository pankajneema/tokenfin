'use client'
import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'
import type { Organization } from '@/types/db'

/** Returns the current user's primary org and the loading state. */
export function useOrg() {
  const { data, error, isLoading } = useSWR<Organization[]>(
    'orgs',
    async () => {
      const res = await fetch('/api/v1/orgs')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    { revalidateOnFocus: false }
  )

  return {
    orgs:      data ?? [],
    org:       data?.[0] ?? null,
    isLoading,
    error,
  }
}

/** Returns the authenticated user from the Supabase client session. */
export function useUser() {
  const supabase = createClient()
  const { data, error, isLoading } = useSWR(
    'auth-user',
    () => supabase.auth.getUser().then(r => r.data.user),
    { revalidateOnFocus: false }
  )
  return { user: data ?? null, isLoading, error }
}
