// Server-renderable status pill (no hooks): "Live" only when an event arrived in
// the last 15 minutes, otherwise "Last event 3h ago" / "No events yet".
import { cn } from '@/lib/utils'

export const LIVE_WINDOW_MS = 15 * 60_000

/** "3h ago"-style age of a timestamp relative to `now`. */
export function ageLabel(iso: string, now: number): string {
  const ms = Math.max(0, now - new Date(iso).getTime())
  if (ms < 60_000)      return 'just now'
  if (ms < 3_600_000)   return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000)  return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

export function liveState(lastEventAt: string | null | undefined, now: number): 'live' | 'stale' | 'none' {
  if (!lastEventAt) return 'none'
  return now - new Date(lastEventAt).getTime() <= LIVE_WINDOW_MS ? 'live' : 'stale'
}

export function LivePill({ lastEventAt, now }: { lastEventAt: string | null | undefined; now: number }) {
  const state = liveState(lastEventAt, now)
  if (state === 'live') {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--green-bg)] border border-[var(--green)]/20"
        title={`Last event ${ageLabel(lastEventAt!, now)}`}>
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-teal" />
        </span>
        <span className="text-[11px] font-semibold text-[var(--green)] tracking-wide">Live</span>
      </div>
    )
  }
  return (
    <div className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--bg-secondary)]')}>
      <span className="inline-flex rounded-full h-1.5 w-1.5 bg-[var(--fg-tertiary)]" />
      <span className="text-[11px] font-medium text-[var(--fg-secondary)]">
        {state === 'none' ? 'No events yet' : `Last event ${ageLabel(lastEventAt!, now)}`}
      </span>
    </div>
  )
}
