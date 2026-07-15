# MIGRATION — Connections rebuild (Milestone 1)

This records what the capture rebuild **removed** and **why**, so nobody re-adds it. The old capture
paths were architecturally wrong — not buggy, wrong — and were deleted, not patched. If you are
tempted to bring one back, read the reason first.

## Why the old design was removed

- **MCP `record_usage` (pull tool).** MCP is pull, not push: the tool fires only when the *model
  chooses* to call it, so it can silently skip → data loss with no error. Every call also adds a
  visible tool round-trip (latency + context pollution) and, worst of all, **the model does not
  reliably know its own token counts** — we would have been billing off approximations. Capture must
  never depend on the model's cooperation or self-report.
- **Claude Code Stop hook + transcript parser.** The Stop hook payload carries *no* token data, so
  the recorder parsed the Claude Code transcript `.jsonl` — an **undocumented, unversioned** format
  that can change without warning and ship wrong numbers rather than an error.
- **`tokenfin proxy` / Go gateway / LaunchAgent proxy.** Putting TokenFin in the model request path
  means our downtime = the customer's agent stops (unacceptable for an observability tool), and it
  forces us to hold the customer's provider API keys (the biggest enterprise blocker we could
  invent). It is also unnecessary — the tools we care about push OpenTelemetry natively.

## The replacement

Claude Code, Codex CLI, and Gemini CLI all ship native OpenTelemetry and already emit token usage
over OTLP. TokenFin **is an OTLP/HTTP receiver** (`/api/otel/v1/{metrics,logs,traces}`) and writes a
config file into the tool. No hooks, no proxy, no MCP for capture. MCP stays, **read-only** — query
the dashboard from chat.

## Removed in this milestone

| Area | Removed | Notes |
|---|---|---|
| MCP write tool | `record_usage` tool def + handler | `web/src/lib/mcp/tools.ts`, `run.ts`. `tools/list` now has **no write tool**. |
| Test route | `POST /api/v1/test-event` | Existed only to fire `record_usage`. |
| CC Stop hook | `cli/assets/record-usage.js`, hook installer in `cli/lib/setup.js`, inline python hook in setup UI | Transcript-JSONL parsers. |
| CLI proxy | `cli/lib/proxy.js` + `tokenfin proxy` command | Recorder reverse-proxy. |
| LaunchAgent proxy | `proxy/` dir, `web/public/proxy.js` | :7070 proxy + installer that rewrote `~/.codex/config.toml` `base_url`. |
| Go gateway | `backend/cmd/gateway/`, `backend/internal/gateway/`, `redis.CCRPut/CCRGet/ccrK` | Import-isolated; not used by ingest/worker. |
| UI | `dashboard/resources/`, `dashboard/mcp/connect/`, old setup wizard content | Proxy/hook/record instructions. Sidebar "Resources" link removed; stale links repointed to `/dashboard/setup`. |
| Stale package | top-level `mcp/` | Obsolete `track_usage` stdio server (`tf_live_` keys); superseded by the live `/api/mcp`. |

## Deliberately KEPT (do not delete)

- **`web/src/lib/mcp/pricing.ts`, `ccr.ts`, `compress.ts`** — back the `compress`/`retrieve`/`savings_stats`
  MCP tools (server-side pricing lives here; clients never price).
- **`prompt_captures` table + `upsert_usage_agg` RPC** — still used by the ingest path and the OTLP
  receiver's aggregate rollup. Not dropped.
- **`web/src/app/api/v1/ingest`** — the usage-ingest pipeline (its `INGEST_SERVICE_URL` hop is *not* a
  model proxy).
- **`backend/internal/{auth,config,db,redis,models,pricing}`**, the OTLP `traces` route, the traces
  dashboard page.

## Known stale (needs a deliberate rework, flagged not silently left)
- `scripts/regression-user-journey.mjs` and `scripts/regression-key-attribution.mjs` exercise the
  old MCP `record_usage` capture path. They will fail until reworked to POST an OTLP payload to
  `/api/otel/v1/logs` with a synthetic `claude_code.api_request` payload.

## Phase 4 (Codex + Gemini) — built, needs one real session to confirm
- Receiver derives per-turn rows from cumulative metric counters (`web/src/lib/otlp/metrics.ts`,
  state table `otlp_metric_state`, **migration 024**). Safe-by-construction: first-seen = baseline
  (emits nothing), only positive deltas count, Claude Code metrics excluded (its logs own those rows).
  7 unit tests cover it.
- `setup` writes `~/.codex/config.toml` (`[otel]`, user-level, `metrics_exporter=otlp-http`) and
  `~/.gemini/settings.json` (telemetry; `?key=` auth). `doctor` checks the Codex statsig landmine.
- **Unverified until a real session**: the exact metric attribute names (`type`, `conversation.id`,
  `model`), the counters' temporality, whether Gemini's exporter preserves `?key=`, and whether Codex
  exposes `[otel.metrics_exporter.otlp-http]`. Docs win over these assumptions (spec §10).

## Follow-on (later milestones, intentionally not in this one)
Full `doctor` polish (P5); grouped `/connections` UI with five states + per-tool guides (P6); Copilot
poller (P7), Cursor (P8), Anthropic admin + reconciliation (P9). The interim `/dashboard/setup` is
Claude-Code-first and will be replaced wholesale by P6.
