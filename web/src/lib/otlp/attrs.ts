/**
 * OTLP attribute helpers — shared by the metrics / logs / traces receivers.
 *
 * Both the OTLP/JSON body and a protobufjs-decoded protobuf body use camelCase
 * field names (`stringValue`, `startTimeUnixNano`, …), so one set of helpers
 * covers both wire formats.
 */

// OTLP AnyValue → JS primitive.
export function attrVal(v: any): unknown {
  if (!v) return undefined
  if (v.stringValue !== undefined) return v.stringValue
  if (v.intValue !== undefined) return Number(v.intValue)
  if (v.doubleValue !== undefined) return v.doubleValue
  if (v.boolValue !== undefined) return v.boolValue
  if (v.bytesValue !== undefined) return v.bytesValue
  return undefined
}

// [{key,value}] → { key: primitive }
export const attrsToMap = (arr: any[]): Record<string, unknown> =>
  Object.fromEntries((arr ?? []).map((a: any) => [a.key, attrVal(a.value)]))

// OTLP fixed64 nanos → ISO string.
export const nanoToIso = (n: string | number | undefined | null): string | null =>
  n ? new Date(Number(n) / 1e6).toISOString() : null

// A number attribute, tolerant of string / int / undefined.
export const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
