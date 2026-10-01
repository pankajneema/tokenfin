/**
 * Structural diff between two config snapshots (History tab). Pure.
 * Objects are compared key by key; arrays and scalars as whole values.
 */
export interface DiffEntry {
  path:   string
  kind:   'added' | 'removed' | 'changed'
  before?: unknown
  after?:  unknown
}

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function diffConfigs(before: unknown, after: unknown, prefix = ''): DiffEntry[] {
  if (isPlain(before) && isPlain(after)) {
    const out: DiffEntry[] = []
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort()
    for (const k of keys) {
      const p = prefix ? `${prefix}.${k}` : k
      if (!(k in before)) out.push({ path: p, kind: 'added', after: after[k] })
      else if (!(k in after)) out.push({ path: p, kind: 'removed', before: before[k] })
      else out.push(...diffConfigs(before[k], after[k], p))
    }
    return out
  }
  if (same(before, after)) return []
  return [{ path: prefix || '(root)', kind: 'changed', before, after }]
}
