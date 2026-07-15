/**
 * Minimal OTLP protobuf decoding.
 *
 * Claude Code's default exporter protocol is `http/protobuf`, so the receiver
 * must decode protobuf as well as JSON. Rather than depend on generated code or
 * read `.proto` files from disk (fragile under serverless bundling), we inline
 * the subset of OTLP v1 we consume and compile it at module load with
 * protobufjs `parse()` — no filesystem, no codegen step.
 *
 * Decoded objects use camelCase field names (keepCase:false) and stringified
 * 64-bit ints, matching the OTLP/JSON shape, so `attrs.ts` helpers work on both.
 */
import protobuf from 'protobufjs'

const OTLP_PROTO = `
syntax = "proto3";
package tokenfin.otlp;

// ── common ──
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
message InstrumentationScope {
  string name = 1;
  string version = 2;
  repeated KeyValue attributes = 3;
}
message Resource { repeated KeyValue attributes = 1; }

// ── logs ──
message ExportLogsServiceRequest { repeated ResourceLogs resource_logs = 1; }
message ResourceLogs { Resource resource = 1; repeated ScopeLogs scope_logs = 2; string schema_url = 3; }
message ScopeLogs { InstrumentationScope scope = 1; repeated LogRecord log_records = 2; string schema_url = 3; }
message LogRecord {
  fixed64 time_unix_nano = 1;
  fixed64 observed_time_unix_nano = 11;
  int32   severity_number = 2;
  string  severity_text = 3;
  AnyValue body = 5;
  repeated KeyValue attributes = 6;
  fixed32 flags = 8;
  bytes   trace_id = 9;
  bytes   span_id = 10;
  string  event_name = 12;
}

// ── metrics ──
message ExportMetricsServiceRequest { repeated ResourceMetrics resource_metrics = 1; }
message ResourceMetrics { Resource resource = 1; repeated ScopeMetrics scope_metrics = 2; string schema_url = 3; }
message ScopeMetrics { InstrumentationScope scope = 1; repeated Metric metrics = 2; string schema_url = 3; }
message Metric {
  string name = 1;
  string description = 2;
  string unit = 3;
  oneof data {
    Gauge gauge = 5;
    Sum   sum = 7;
    Histogram histogram = 9;
    Summary summary = 11;
  }
}
message Gauge { repeated NumberDataPoint data_points = 1; }
message Sum {
  repeated NumberDataPoint data_points = 1;
  int32 aggregation_temporality = 2;
  bool  is_monotonic = 3;
}
message Histogram { repeated HistogramDataPoint data_points = 1; int32 aggregation_temporality = 2; }
message Summary   { repeated NumberDataPoint data_points = 1; }
message NumberDataPoint {
  repeated KeyValue attributes = 7;
  fixed64 start_time_unix_nano = 2;
  fixed64 time_unix_nano = 3;
  oneof value { double as_double = 4; sfixed64 as_int = 6; }
}
message HistogramDataPoint {
  repeated KeyValue attributes = 9;
  fixed64 start_time_unix_nano = 2;
  fixed64 time_unix_nano = 3;
  fixed64 count = 4;
  double  sum = 5;
}

// ── traces ──
message ExportTraceServiceRequest { repeated ResourceSpans resource_spans = 1; }
message ResourceSpans { Resource resource = 1; repeated ScopeSpans scope_spans = 2; string schema_url = 3; }
message ScopeSpans { InstrumentationScope scope = 1; repeated Span spans = 2; string schema_url = 3; }
message Span {
  bytes  trace_id = 1;
  bytes  span_id = 2;
  string trace_state = 3;
  bytes  parent_span_id = 4;
  string name = 5;
  int32  kind = 6;
  fixed64 start_time_unix_nano = 7;
  fixed64 end_time_unix_nano = 8;
  repeated KeyValue attributes = 9;
}
`

const root = protobuf.parse(OTLP_PROTO, { keepCase: false }).root
const T = (name: string) => root.lookupType(`tokenfin.otlp.${name}`)

const LogsReq    = T('ExportLogsServiceRequest')
const MetricsReq = T('ExportMetricsServiceRequest')
const TraceReq   = T('ExportTraceServiceRequest')

// 64-bit ints as strings; bytes (trace/span ids) as base64 strings.
const TO_OBJECT: protobuf.IConversionOptions = { longs: String, bytes: String, defaults: false, arrays: true, objects: true, oneofs: true }

export function decodeLogsProto(buf: Uint8Array): any {
  return LogsReq.toObject(LogsReq.decode(buf), TO_OBJECT)
}
export function decodeMetricsProto(buf: Uint8Array): any {
  return MetricsReq.toObject(MetricsReq.decode(buf), TO_OBJECT)
}
export function decodeTracesProto(buf: Uint8Array): any {
  return TraceReq.toObject(TraceReq.decode(buf), TO_OBJECT)
}
