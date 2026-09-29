/**
 * Read an OTLP/HTTP request body as JSON or protobuf, per Content-Type.
 * Claude Code defaults to `http/protobuf`; `http/json` is also accepted.
 */
import type { NextRequest } from 'next/server'
import { gunzipSync } from 'zlib'
import { decodeLogsProto, decodeMetricsProto, decodeTracesProto } from './proto'

export type OtlpSignal = 'logs' | 'metrics' | 'traces'

export async function readOtlp(req: NextRequest, signal: OtlpSignal): Promise<any> {
  const ct = (req.headers.get('content-type') || '').toLowerCase()
  // Exporters with OTEL_EXPORTER_OTLP_COMPRESSION=gzip send a gzipped body.
  let buf: Uint8Array = new Uint8Array(await req.arrayBuffer())
  if ((req.headers.get('content-encoding') || '').toLowerCase().includes('gzip')) buf = gunzipSync(buf)
  if (ct.includes('protobuf') || ct.includes('application/x-protobuf')) {
    if (signal === 'logs')    return decodeLogsProto(buf)
    if (signal === 'metrics') return decodeMetricsProto(buf)
    return decodeTracesProto(buf)
  }
  // default: OTLP/JSON
  return JSON.parse(new TextDecoder().decode(buf))
}
