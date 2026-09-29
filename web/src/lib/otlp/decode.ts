/**
 * Read an OTLP/HTTP request body as JSON or protobuf, per Content-Type.
 * Claude Code defaults to `http/protobuf`; `http/json` is also accepted.
 *
 * Bounded: the wire body is capped (MAX_BODY_BYTES) while streaming, and a
 * gzip body may inflate to at most MAX_INFLATED_BYTES — a small "zip bomb"
 * can't exhaust memory.
 */
import type { NextRequest } from 'next/server'
import { gunzipSync } from 'zlib'
import { decodeLogsProto, decodeMetricsProto, decodeTracesProto } from './proto'

export type OtlpSignal = 'logs' | 'metrics' | 'traces'

export const MAX_BODY_BYTES = 8 * 1024 * 1024
export const MAX_INFLATED_BYTES = 16 * 1024 * 1024

/** Thrown for bodies over the cap — receivers answer 413. */
export class BodyTooLargeError extends Error {
  constructor(limit: number) { super(`request body exceeds ${limit} bytes`) }
}

/** Read the raw body, aborting as soon as it passes `max` bytes. */
export async function readBodyCapped(req: Request, max = MAX_BODY_BYTES): Promise<Uint8Array> {
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > max) throw new BodyTooLargeError(max)
  if (!req.body) return new Uint8Array(await req.arrayBuffer())
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => {})
      throw new BodyTooLargeError(max)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.byteLength }
  return out
}

export function gunzipCapped(buf: Uint8Array, max = MAX_INFLATED_BYTES): Uint8Array {
  try {
    return gunzipSync(buf, { maxOutputLength: max })
  } catch (e: any) {
    if (e?.code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|buffer.*too large/i.test(String(e?.message))) {
      throw new BodyTooLargeError(max)
    }
    throw e
  }
}

export async function readOtlp(req: NextRequest, signal: OtlpSignal): Promise<any> {
  const ct = (req.headers.get('content-type') || '').toLowerCase()
  // Exporters with OTEL_EXPORTER_OTLP_COMPRESSION=gzip send a gzipped body.
  let buf = await readBodyCapped(req)
  if ((req.headers.get('content-encoding') || '').toLowerCase().includes('gzip')) buf = gunzipCapped(buf)
  if (ct.includes('protobuf') || ct.includes('application/x-protobuf')) {
    if (signal === 'logs')    return decodeLogsProto(buf)
    if (signal === 'metrics') return decodeMetricsProto(buf)
    return decodeTracesProto(buf)
  }
  // default: OTLP/JSON
  return JSON.parse(new TextDecoder().decode(buf))
}
