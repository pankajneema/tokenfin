/**
 * OTLP trace protobuf decoding for the trace receiver.
 *
 * lib/otlp/proto.ts's trace subset omits Span.status and Span.events, so a
 * protobuf exporter's errors would be invisible. This inlines the full OTLP v1
 * trace message (status, events, links, flags) and decodes to the same
 * camelCase shape as OTLP/JSON. Ids stay base64 here; genai.ts normalizeId
 * turns them into the hex ids OTLP/JSON uses.
 */
import protobuf from 'protobufjs'

const TRACE_PROTO = `
syntax = "proto3";
package tokenfin.otlp.traces;

message AnyValue {
  oneof value {
    string string_value = 1;
    bool   bool_value   = 2;
    int64  int_value    = 3;
    double double_value = 4;
    ArrayValue   array_value  = 5;
    KeyValueList kvlist_value = 6;
    bytes  bytes_value  = 7;
  }
}
message ArrayValue   { repeated AnyValue values = 1; }
message KeyValueList { repeated KeyValue values = 1; }
message KeyValue     { string key = 1; AnyValue value = 2; }
message InstrumentationScope { string name = 1; string version = 2; repeated KeyValue attributes = 3; uint32 dropped_attributes_count = 4; }
message Resource { repeated KeyValue attributes = 1; uint32 dropped_attributes_count = 2; }

message ExportTraceServiceRequest { repeated ResourceSpans resource_spans = 1; }
message ResourceSpans { Resource resource = 1; repeated ScopeSpans scope_spans = 2; string schema_url = 3; }
message ScopeSpans { InstrumentationScope scope = 1; repeated Span spans = 2; string schema_url = 3; }
message Span {
  bytes  trace_id = 1;
  bytes  span_id = 2;
  string trace_state = 3;
  bytes  parent_span_id = 4;
  fixed32 flags = 16;
  string name = 5;
  int32  kind = 6;
  fixed64 start_time_unix_nano = 7;
  fixed64 end_time_unix_nano = 8;
  repeated KeyValue attributes = 9;
  uint32 dropped_attributes_count = 10;
  repeated Event events = 11;
  uint32 dropped_events_count = 12;
  repeated Link links = 13;
  uint32 dropped_links_count = 14;
  Status status = 15;
  message Event {
    fixed64 time_unix_nano = 1;
    string name = 2;
    repeated KeyValue attributes = 3;
    uint32 dropped_attributes_count = 4;
  }
  message Link {
    bytes trace_id = 1;
    bytes span_id = 2;
    string trace_state = 3;
    repeated KeyValue attributes = 4;
    uint32 dropped_attributes_count = 5;
    fixed32 flags = 6;
  }
}
message Status { reserved 1; string message = 2; int32 code = 3; }
`

const root = protobuf.parse(TRACE_PROTO, { keepCase: false }).root

/** The ExportTraceServiceRequest type (tests encode fixtures with it). */
export const TraceRequestType = root.lookupType('tokenfin.otlp.traces.ExportTraceServiceRequest')

const TO_OBJECT: protobuf.IConversionOptions = { longs: String, bytes: String, defaults: false, arrays: true, objects: true, oneofs: true }

export function decodeTraceRequest(buf: Uint8Array): any {
  return TraceRequestType.toObject(TraceRequestType.decode(buf), TO_OBJECT)
}

/** Encode a JSON-shaped request (hex ids) as OTLP protobuf — fixtures / tests. */
export function encodeTraceRequest(body: any): Uint8Array {
  const hexToB64 = (v: unknown) => (typeof v === 'string' && /^[0-9a-f]+$/i.test(v) ? Buffer.from(v, 'hex').toString('base64') : v)
  const clone = JSON.parse(JSON.stringify(body))
  for (const rs of clone.resourceSpans ?? []) for (const ss of rs.scopeSpans ?? []) for (const sp of ss.spans ?? []) {
    sp.traceId = hexToB64(sp.traceId); sp.spanId = hexToB64(sp.spanId)
    if (sp.parentSpanId) sp.parentSpanId = hexToB64(sp.parentSpanId)
  }
  return TraceRequestType.encode(TraceRequestType.fromObject(clone)).finish()
}
