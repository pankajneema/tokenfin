import { redirect } from 'next/navigation'

/**
 * Root entry point. Redirect to dashboard — middleware handles auth check.
 */
export default function RootPage() {
  redirect('/dashboard')
}
