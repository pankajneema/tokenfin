# TokenFin MCP Server — Setup & Security Guide

TokenFin ships a **remote MCP server** so AI assistants (Claude Code, Claude Desktop, Cursor,
VS Code/Cline, and any MCP-compatible client) can query your org's FinOps data in natural
language — "what did we spend on Sonnet this month?", "are we near any budget?" — with no SQL and
no dashboard.

It follows the **MCP 2025-06-18 spec**: Streamable HTTP transport, JSON-RPC 2.0, per-request
`Authorization: Bearer` auth, and tool annotations (`readOnlyHint`).

MCP **never captures usage**. It can't reliably know token counts, so there is no
`record_usage` tool; capture is OpenTelemetry (see [`SETUP_HUB.md`](./SETUP_HUB.md)).

---

## Endpoint

```
POST  https://<your-app>/api/mcp
```

- **Transport:** Streamable HTTP (single endpoint, request/response JSON-RPC; batches allowed).
- **Auth:** `Authorization: Bearer <tfk_…>` on every request.
- **Scope:** the key must carry the **`read`** scope — a per-device *read* key from
  `npx tokenfin@latest login`, a `setup-hub-read` org key, or a legacy read+write key.
  **Ingest-only keys are refused with `403`** (`-32003 Forbidden: key lacks read scope`), so the
  key in your agents' OTLP config can't be used to read your analytics.
- **Isolation:** every query is scoped to the org that owns the key.

---

## Connecting

### Claude Code — automatic

`npx tokenfin@latest setup` registers the server at user scope with **this device's read key**:

```bash
claude mcp add-json -s user tokenfin '{"type":"http","url":"https://<your-app>/api/mcp","headers":{"Authorization":"Bearer <READ_KEY>"}}'
```

The CLI runs that without a shell (so the header is never split). The key is briefly visible
in the local process list while the command runs; `claude mcp add-json` has no stdin mode.
On Windows, if `claude` is only an npm `.cmd` shim, setup prints the command for you to run
instead of going through `cmd.exe`. Re-running `login` re-registers with the new read key;
`remove` unregisters it. `setup --no-mcp` skips registration.

The **Connected platforms** page (`/dashboard/mcp`) shows your read keys (masked) and copy-ready
snippets for Claude Code, the plugin, Claude Desktop and Cursor. Keys are stored hashed, so the
page cannot show a full key. To get a read key for another client, run
`npx tokenfin@latest login` on that machine (it stores one as `read_key` in
`~/.tokenfin/config.json`), or create a read-only key under **Dashboard → API Keys**.

### Claude Code plugin: `plugins/claude-code`

The plugin bundles the MCP server and three slash commands: `/tokenfin:spend`,
`/tokenfin:budget` and `/tokenfin:top-models`. The server entry in the plugin's `.mcp.json`
reads your key from `TOKENFIN_READ_KEY` and your deployment from `TOKENFIN_URL` (default
`https://tokenfin.curiousdevs.com`):

```bash
export TOKENFIN_READ_KEY="tfk_…"
# in Claude Code, from a checkout of this repo:
/plugin marketplace add ./plugins/claude-code
/plugin install tokenfin@tokenfin
```

See [`plugins/claude-code/README.md`](../plugins/claude-code/README.md). The plugin is not
published to any marketplace.

### Cursor — `~/.cursor/mcp.json`  ·  VS Code/Cline — `.vscode/mcp.json`

```jsonc
{
  "mcpServers": {
    "tokenfin": {
      "type": "http",
      "url": "https://<your-app>/api/mcp",
      "headers": { "Authorization": "Bearer <READ_KEY>" }
    }
  }
}
```

### Claude Desktop — `claude_desktop_config.json`

Claude Desktop speaks stdio, so bridge to the remote server with `mcp-remote`:

```jsonc
{
  "mcpServers": {
    "tokenfin": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<your-app>/api/mcp",
               "--header", "Authorization: Bearer <READ_KEY>"]
    }
  }
}
```

---

## Tools

Range arguments for the rollup tools: `days` (last N days including today, default 30) or
`from`/`to` (`YYYY-MM-DD`, inclusive, in the **org's time zone**; max 366 days). `filters` takes
exact-match `project_id`, `user_key` (lowercased email), `model`, `source`, `repo` and `agent`.
Cost columns always come as **metered** (billable) and **notional** (subscription usage priced at
API rates). Never add notional cost into a bill.

| Tool | Args | Returns | Role scoping |
|---|---|---|---|
| `list_projects` | — | Projects in the org | org |
| `get_spend` | `days?` | Total cost, tokens, requests | org |
| `get_usage_by_model` | `days?` | Cost/tokens/requests per model | org |
| `get_daily_costs` | `days?` | Daily cost series | org |
| `get_budget_status` | — | Active limits + month spend + % used + status | org |
| `get_breakdown` | `dim` (model·project·member·source·agent·skill·mcp_server·repo), range, `filters?`, `limit?` | Rows by cost (metered/notional, requests, tokens) + `other` | `dim=member` or a `user_key` filter → **own rows only** for members/viewers |
| `get_sessions` | range, `filters?`, `order?` (recent·cost·tokens), `limit?`, `offset?` | Sessions with cost/tokens/model/repo/user | **own only** for members/viewers |
| `get_session` | `session_id` | Session totals + first 200 calls; redacted prompt previews if capture is on | out-of-scope → `found:false` |
| `get_prompts` | range, `filters?`, `order?`, `limit?`, `offset?`, `include_text?` | Prompts by cost; redacted `prompt_preview` only when prompt capture is on | **own only** for members/viewers |
| `get_mtd_and_forecast` | `trailing_days?` (3–30, default 7), `filters?` | MTD + projected month-end (trailing average), metered/notional separately | org; a `user_key` filter must be your own |
| `get_insights` | `days?` | The Insights page findings (`GET /api/v1/insights`, called as the same key); `available:false` if the deployment has none | enforced by the insights route |
| `compress` | `content`, `model?` | Compressed text with a `<<ccr:HASH>>` marker, tokens/USD saved | **Writes.** Stores the original in `ccr_store` (org-scoped, migration 015) so `retrieve` can return it, and inserts a zero-cost `usage_events` row recording the savings. |
| `retrieve` | `hash` | The original content for a marker (own org only) | org |
| `savings_stats` | `days?` | Tokens and USD saved by `compress` | org |
| `evaluate` | `evaluator`, `answer`, `context?`, `question?`, `reference?` | 0–1 score, pass/fail, rationale | **Owner/admin keys only.** Calls the org's configured LLM judge with the org's eval key (that provider bills you and receives the text) and inserts an `eval_scores` row. |
| `get_eval_summary` | `days?` | Hallucination rate, mean faithfulness | org |

Read-only tools carry `readOnlyHint: true`; `compress` and `evaluate` carry
`readOnlyHint: false, destructiveHint: false`, so clients that honour annotations will ask
before calling them. Nothing is ever deleted or modified through MCP.

### Role scoping

The server resolves the key's owner the same way `lib/api/auth.ts` `lookupApiKey` does: the
owner is `api_keys.user_id`, else `created_by`, and the role is that person's `members.role`. A
personal key whose owner left the org is refused. Then `promptScope(role, userId)` applies:

- **owner / admin**: the whole org.
- **member / viewer**: org-level totals (as on the dashboard), but prompts, sessions and
  per-member spend are limited to the key owner. The rollups key a person as their lowercased
  email or their user id, so both are matched (`lib/mcp/scope.ts`). Asking for another person's
  `user_key` returns nothing.

The database enforces the same rule for direct PostgREST reads (migration 016).
`prompt_captures`, `usage_events` and `spans` are readable by owners/admins in full, and by
everyone else only for their own rows.

## Security model

| Control | Implementation |
|---|---|
| **Per-request auth** | `Authorization: Bearer` validated on every call; missing/invalid → `401` with `WWW-Authenticate` (RFC 9728 discovery hint). Revoked or expired keys are refused. |
| **Least privilege** | `read` scope required; ingest-only keys → `403`. Per-device read keys from CLI login are separate from the ingest keys agents send telemetry with. |
| **Org isolation** | All queries filtered by the key's `org_id`; `retrieve` only returns originals stored by the same org. |
| **Role isolation** | Per-user data (prompts, sessions, member spend) follows the key owner's role (see *Role scoping*). Prompt text is returned only when the org has prompt capture on, and is always redacted. |
| **Origin allow-list (DNS-rebinding guard)** | Requests with **no** `Origin` header (CLI/desktop clients) are allowed. Browser requests are allowed only from an exact scheme+host+port match against `NEXT_PUBLIC_APP_URL`, `https://claude.ai`, `https://claude.com`, `https://chatgpt.com`, `https://chat.openai.com`, or loopback (`localhost` / `127.0.0.1` / `[::1]`, any port — MCP Inspector). Anything else → `403 Origin not allowed`. Matching is by parsed origin, never string prefix, so `https://claude.ai.evil.com` is rejected. |
| **Secret hygiene** | Keys are shown once; only `key_hash` (SHA-256) is stored for lookup. Tokens are never logged or placed in URLs (Gemini's OTLP `?key=` is the one ingest-side exception, documented in SETUP_HUB). |
| **Rotation / offboarding** | `npx tokenfin@latest login` rotates this device's keys. Revoke any key in Dashboard → API Keys; removing a member deactivates their keys. |

**Roadmap:** OAuth 2.1 + PKCE with `.well-known/oauth-protected-resource` discovery, so
clients get delegated, user-consented access without long-lived keys.

---

## Verify it works

```bash
KEY=<READ_KEY>
curl -s https://<your-app>/api/mcp -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'

curl -s https://<your-app>/api/mcp -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

curl -s https://<your-app>/api/mcp -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_spend","arguments":{"days":30}}}'
```

A reproducible protocol test lives at `scripts/regression-mcp.mjs`.
