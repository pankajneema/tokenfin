import { Spinner } from '@/components/ui/spinner'

// Shown instantly on navigation while a dashboard page loads its data.
export default function DashboardLoading() {
  return (
    <div className="flex items-center justify-center gap-2 py-24 text-[13px] text-[var(--fg-tertiary)]">
      <Spinner /> Loading…
    </div>
  )
}
