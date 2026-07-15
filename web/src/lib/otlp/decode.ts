/**
 * Read an OTLP/HTTP request body as JSON or protobuf, per Content-Type.
 * Claude Code defaults to `http/protobuf`; `http/json` is also accepted.
 */
import type { NextRequest } from 'next/server'
import { decodeLogsProto, decodeMetricsProto, decodeTracesProto } from './proto'

export type OtlpSignal = 'logs' | 'metrics' | 'traces'

export async function readOtlp(req: NextRequest, signal: OtlpSignal): Promise<any> {
  const ct = (req.headers.get('content-type') || '').toLowerCase()
  if (ct.includes('protobuf') || ct.includes('application/x-protobuf')) {
    const buf = new Uint8Array(await req.arrayBuffer())
    if (signal === 'logs')    return decodeLogsProto(buf)
    if (signal === 'metrics') return decodeMetricsProto(buf)
    return decodeTracesProto(buf)
  }
  // default: OTLP/JSON
  return req.json()
}
