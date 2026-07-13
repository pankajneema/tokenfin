# Setup Hub — Deeplink & Connector Research

> Verified **2026-07-13** against official / authoritative sources. Formats change —
> re-verify before shipping if this file is more than a few months old.

The Setup Hub bakes the org's auto-provisioned key into every install link, so the
formats below are the exact contracts we depend on. TokenFin's MCP endpoint is
Streamable HTTP with Bearer auth (also accepts `x-api-key` and `?key=` — see
`web/src/lib/mcp/auth.ts`). Endpoint: `https://<app-host>/api/mcp`.

---

## 1. Cursor — one-click MCP install deeplink

**Scheme (native):**
```
cursor://anysphere.cursor-deeplink/mcp/install?name=<NAME>&config=<BASE64_JSON>
```
**Web variant (renders an "Add to Cursor" page, then hands off to the app):**
```
https://cursor.com/install-mcp?name=<NAME>&config=<BASE64_JSON>
```

- `config` is **base64 of the flat server-config object** — the value that would sit
  under `mcpServers.<name>` in `mcp.json`, **not** wrapped in `mcpServers`.
- Confirmed by Cursor's real Asana example: `config` decodes to `{"url":"https://mcp.asana.com/mcp"}`.
- For a remote HTTP server with header auth, the object is:
  ```json
  { "url": "https://<app-host>/api/mcp", "headers": { "Authorization": "Bearer <key>" } }
  ```
- Encoding (browser): `btoa(unescape(encodeURIComponent(JSON.stringify(config))))`.

Sources: [Cursor Deeplinks docs](https://cursor.com/docs), [One-Click MCP Install with Cursor Deeplinks](https://aiengineerguide.com/til/cursor-mcp-deeplink/), [DanyWalls: one-click MCP install links](https://danywalls.com/create-one-click-mcp-installation-links-cursor-vscode).

---

## 2. VS Code — MCP install URL handler

**Scheme:**
```
vscode:mcp/install?<URL_ENCODED_JSON>
vscode-insiders:mcp/install?<URL_ENCODED_JSON>   (Insiders build)
```

- The JSON is a **flat object that includes `name` inside it** (different from the
  `mcp.json` file format, where the name is the parent key).
- Encoding: `encodeURIComponent(JSON.stringify(obj))` — official example:
  `const link = ` + "`vscode:mcp/install?${encodeURIComponent(JSON.stringify(obj))}`" + `;`
- For a remote HTTP server with header auth:
  ```json
  { "name": "tokenfin", "type": "http", "url": "https://<app-host>/api/mcp",
    "headers": { "Authorization": "Bearer <key>" } }
  ```
  (Real decoded example from VS Code: `{"name":"com.figma.mcp/mcp","type":"http","url":"https://mcp.figma.com/mcp","headers":{}}`.)

Sources: [VS Code MCP developer guide](https://code.visualstudio.com/api/extension-guides/ai/mcp), [Add and manage MCP servers in VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

---

## 3. Claude Code — one command

```
claude mcp add --transport http tokenfin https://<app-host>/api/mcp \
  --header "Authorization: Bearer <key>"
```
- All flags (`--transport`, `--header`, `--scope`) must come **before** the name/url.
- `--header` may be repeated; `-H` is the shorthand. (Older docs wrongly showed `-e` — corrected.)
- This connects the server **read-only** in the client sense; it does **not** auto-record.
- TokenFin's own installer `npx tokenfin@latest setup --key <key> --url <url>` additionally
  installs a **Stop hook**, which is the only *exact, no-cooperation* auto-recorder.
- Verify: `claude mcp get tokenfin` / `/mcp` inside a session.

Sources: [Connect to MCP servers — Claude Code docs](https://code.claude.com/docs/en/mcp-quickstart), [claude-code issue #2324 (--header, not -e)](https://github.com/anthropics/claude-code/issues/2324).

---

## 4. Claude.ai / Claude Desktop / Cowork — custom connectors

- Direct settings URL: **`https://claude.ai/settings/connectors`**
  (modal shortcut: `https://claude.ai/settings/connectors?modal=add-custom-connector`).
- Flow: Settings → Connectors → **Add custom connector** → enter **Name** + **URL**
  (use the `/api/mcp` path). Leave OAuth Client ID/Secret empty.
- Auth: for a fixed API key, the **Request headers** section of the Add dialog accepts
  `Authorization: Bearer <key>` (beta). To stay one-tap and header-free, we instead ship
  the URL as `https://<app-host>/api/mcp?key=<key>` — `auth.ts` accepts `?key=`.
- Connectors added on claude.ai **sync** to Claude Desktop, mobile, and **Cowork**
  (same account). Enable per-conversation via the **+** button → Connectors.
- Team/Enterprise: an Owner adds it under Settings → Organization settings → Connectors first.

Sources: [Use connectors — Claude Help Center](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities), [Get started with custom connectors (remote MCP)](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [claude.ai/settings/connectors](https://claude.ai/settings/connectors).

---

## 5. ChatGPT — custom MCP connectors (Developer Mode)

- Requires **Developer Mode**: Settings → Connectors → **Advanced** → toggle Developer mode
  (labeled **Apps** in newer builds; also under Settings → "Apps & Connectors").
- Available on **Plus, Pro, Team, Enterprise, Edu** — **not** Free. Managed workspaces:
  an admin must enable it under Workspace Settings → Permissions.
- Then: **Create connector** → provide Name + the **HTTPS** MCP URL. Remote servers only
  (SSE / streamable HTTP). Enable per-chat via **+** → More → **Developer mode**.
- No reliable deep link to the settings pane; we link `https://chatgpt.com` and state the
  Developer-Mode requirement inline.

Sources: [Developer mode and MCP apps in ChatGPT — OpenAI Help](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt), [Building MCP servers for ChatGPT — OpenAI](https://developers.openai.com/api/docs/mcp).

---

## 6. mcp-remote bridge (any stdio-only MCP client)

For clients that only speak stdio config (Windsurf, Codex CLI, Gemini CLI, Cline, etc.):
```json
{ "mcpServers": { "tokenfin": {
  "command": "npx",
  "args": ["-y", "mcp-remote", "https://<app-host>/api/mcp",
           "--header", "Authorization: Bearer <key>"] } } }
```
- Needs Node 18+ (`npx`). Behind a corporate proxy, set `HTTPS_PROXY`.

Source: [mcp-remote (npm)](https://www.npmjs.com/package/mcp-remote).

---

## Honesty matrix (how usage actually reaches TokenFin)

| Path | Recording | Accuracy |
|---|---|---|
| Claude Code installer (Stop hook) | Automatic, every turn | **Exact** |
| Gateway proxy | Automatic, server-side | **Exact** (provider-reported) |
| Code / API (`record_usage`) | You call it | Exact if you pass real counts |
| IDE agents (Cursor/VS Code/…) via saved rule | Agent follows a rule file | Best-effort, may be **estimated** |
| Chat apps (Claude.ai/Desktop/Cowork/ChatGPT) via saved rule | Agent follows a rule | Best-effort, may be **estimated** |

Connecting the MCP server alone does **not** fill the dashboard — recording is a separate
step for everything except the Claude Code hook and the gateway. The Setup Hub says this
inline and provides a **Send test event** button so the pipeline can be proven instantly.
