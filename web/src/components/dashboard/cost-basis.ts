// One wording for metered vs notional everywhere cost is shown (no hooks —
// usable from server and client components).
import { formatCost } from '@/lib/utils'

export const NOTIONAL_LABEL = 'notional (at API rates)'

/** "$4.10 metered · $12.30 notional (at API rates)", or the single basis present. */
export function basisLine(metered: number, notional: number): string {
  if (metered > 0 && notional > 0) return `${formatCost(metered)} metered · ${formatCost(notional)} ${NOTIONAL_LABEL}`
  if (notional > 0) return `All ${NOTIONAL_LABEL} — subscription usage, not a bill`
  if (metered > 0) return 'All metered (billed API usage)'
  return 'No spend yet'
}
