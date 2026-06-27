# TokenFin MCP Server — Setup & Security Guide

TokenFin ships a **remote MCP server** so AI assistants (Claude Desktop, Cursor,
VS Code/Cline, and any MCP-compatible client) can query your org's FinOps data
in natural language — "what did we spend on GPT-4o this month?", "are we near any
budget?" — with no SQL and no dashboard.

It follows the **MCP 2025-06-18 spec**: Streamable HTTP transport, JSON-RPC 2.0,
per-request `Authorization: Bearer` auth, and read-only tool annotations.

---

## Endpoint

```
POST  https://<your-app>/api/mcp
```

- **Transport:** Streamable HTTP (single endpoint, request/response JSON-RPC).
- **Auth:** `Authorization: Bearer <tfk_…>` on every request.
- **Scope:** the key must carry the `read` scope. The server exposes **no write
  or destructive tools**, so an MCP key never needs write access.
- **Isolation:** every query is scoped to the org that owns the key.

---

## Quick connect (UI)

Dashboard → **MCP Setup** (`/dashboard/mcp/connect`):
1. Pick a project and your tool.
2. Click **Generate key & config** — a **read-only** key is created and shown
   **once**, embedded in a ready-to-paste config block.
3. Paste into your client's config file and restart it.

---

## Manual config

### Cursor — `~/.cursor/mcp.json`  ·  VS Code/Cline — `.vscode/mcp.json`
Native remote support (URL + headers):
```jsonc
{
  "mcpServers": {
    "tokenfin": {
      "type": "http",
      "url": "https://<your-app>/api/mcp",
      "headers": { "Authorization": "Bearer tfk_prod_xxxx_…" }
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
               "--header", "Authorization: Bearer tfk_prod_xxxx_…"]
    }
  }
}
```

---

## Tools (all read-only)

| Tool | Args | Returns |
|---|---|---|
| `list_projects` | — | Projects in the org |
| `get_spend` | `days?` (default 30) | Total cost, tokens, requests |
| `get_usage_by_model` | `days?` | Cost/tokens/requests per model |
| `get_daily_costs` | `days?` | Daily cost series |
| `get_budget_status` | — | Active limits + month spend + % used + status |

Each tool is annotated `readOnlyHint: true` so clients can surface that it never
mutates state.

---

## Security model

| Control | Implementation |
|---|---|
| **Per-request auth** | `Authorization: Bearer` validated on every call; missing/invalid → `401` with `WWW-Authenticate` (RFC 9728 discovery hint). |
| **Least privilege** | MCP keys are created `read`-only; server has no write tools. |
| **Org isolation** | All queries filtered by the key's `org_id`. |
| **DNS-rebinding guard** | Requests carrying a browser `Origin` header are rejected (`403`). |
| **Secret hygiene** | The key is shown once at creation; only `key_hash` (SHA-256) is stored; tokens are never logged or placed in URLs. |
| **Rotation** | Revoke a key in Dashboard → API Keys; generate a fresh one in MCP Setup. |

**Roadmap (enterprise):** full OAuth 2.1 + PKCE with
`.well-known/oauth-protected-resource` discovery and step-up scopes
(spec 2025-11-25). Bearer-key auth is the interoperable baseline today; OAuth
adds delegated, user-consented access without long-lived keys.

---

## Verify it works

```bash
# initialize
curl -s https://<your-app>/api/mcp \
  -H "Authorization: Bearer tfk_prod_xxxx_…" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'

# list tools
curl -s https://<your-app>/api/mcp -H "Authorization: Bearer tfk_…" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# call a tool
curl -s https://<your-app>/api/mcp -H "Authorization: Bearer tfk_…" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call",
       "params":{"name":"get_spend","arguments":{"days":30}}}'
```

A reproducible protocol test lives at `scripts/regression-mcp.mjs`.
