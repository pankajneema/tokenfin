# Setup Hub

The Setup Hub (`/dashboard/setup`) is TokenFin's ground-up replacement for the old
copy-paste MCP flow. Goal: a non-technical user connects **any** AI tool and sees
their **first usage event** on the dashboard in under 5 minutes — success is measured
by *first event recorded*, not "MCP connected".

## What was built

**Key auto-provisioning (no manual copy).**
- `web/src/lib/setup/key.ts` — `getOrCreateSetupKey(orgId, userId)`: idempotent
  get-or-create of a single read+write key named `setup-hub` per org. Sealed at rest
  (AES-256-GCM, migration 022) so a returning admin gets the *same* key back; if
  encryption is unavailable it mints a fresh key and deactivates the stale ones.
- The key is created **server-side on page load** and injected into every install
  link, command, and snippet. The UI never renders a `<YOUR_KEY>` placeholder.

**New API routes** (follow the existing key-hashing + RBAC model):
- `POST /api/v1/keys/setup-hub` `{ org_id }` — session-authenticated, admin-only
  (`keys:create`). Returns the raw key only over the authenticated dashboard session.
- `POST /api/v1/test-event` `{ org_id }` — org-member auth. Fires one real
  `record_usage` (model `setup-test`) through the exact MCP write path (`runTool`),
  so users can prove the pipeline before their tool is wired up.

**The page** (`page.tsx` server → `_client.tsx` client, per repo convention):
- **Hero + injected key card** (masked, reveal toggle, copy).
- **Tool grid**, grouped: One-click · One-command · Connect-in-settings · Any MCP
  client · From your code. Brand-colored logo tiles, real names, honest accuracy
  badges (Exact / Records-via-rule / You-control-it).
- **Focused panel per tool**: ≤ 3 numbered steps, exactly one button each
  (Install / Open / Copy / one-tap chips / Send test event), an honest one-liner about
  how recording actually works, and a **Manual setup** fallback accordion with raw config.
- **Persistent verify bar**: polls `usage_events` (browser Supabase client, RLS member
  SELECT) every 4s since page load; turns green with model + cost + **confetti** on the
  first event, plus a **Send test event** button. Self-contained canvas confetti
  (respects `prefers-reduced-motion`).
- **Status persistence**: per-tool `Connected ✓ / Recording ✓` badges in `localStorage`.
- Gated states for non-admins and key-provisioning failures. Dark-mode native
  (all colors via CSS tokens).

**Wiring**
- `/dashboard/mcp/connect` now `redirect()`s to `/dashboard/setup`.
- Sidebar item relabeled **Setup** → `/dashboard/setup`.

## Verified deeplink formats (see `SETUP_HUB_RESEARCH.md`, verified 2026-07-13)

| Tool | Injected format |
|---|---|
| Cursor | `cursor://anysphere.cursor-deeplink/mcp/install?name=tokenfin&config=<base64({url,headers})>` + web `https://cursor.com/install-mcp?...` |
| VS Code | `vscode:mcp/install?<encodeURIComponent(JSON {name,type:"http",url,headers})>` (+ `vscode-insiders:`) |
| Claude Code | `npx tokenfin@latest setup --key … --url …` (hook); manual `claude mcp add --transport http tokenfin <url> --header "Authorization: Bearer …"` |
| Claude.ai / Desktop / Cowork | `https://claude.ai/settings/connectors?modal=add-custom-connector` + Name/URL chips (`<url>?key=…`) |
| ChatGPT | Developer Mode → Create connector, Name/URL chips (`<url>?key=…`) |
| Any MCP client | `npx -y mcp-remote <url> --header "Authorization: Bearer …"` |
| Code / API | `record_usage` via JSON-RPC — curl / JS / Python, each with `event_id` |
| Gateway | `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` env |

## Honesty (stated inline on every relevant card)

Connecting the MCP server alone does **not** fill the dashboard. Recording is exact for
the **Claude Code hook** and the **gateway**; for chat/IDE agents it follows a saved rule
and may be **estimated**. The **Send test event** button always gives a guaranteed event.

---

## Manual QA checklist (all 12 tools)

Prereqs: log in as an **admin**; open `/dashboard/setup`; confirm the key card shows a
masked key that reveals/copies; confirm the bottom bar reads "Waiting for your first
event…". Click **Send test event** → bar turns green with `setup-test` + confetti, and
`/dashboard` shows the event. Then per tool, open its panel and verify:

- [ ] **Cursor** — "Add to Cursor" opens Cursor with server pre-filled (config base64
      decodes to `{url,headers:{Authorization}}`); web fallback link works; rule copies;
      test event greens the bar. **2-click target: Install → approve.**
- [ ] **VS Code** — "Add to VS Code" opens VS Code (Insiders link too); server appears
      under `servers`; rule copies to copilot-instructions; test event works.
- [ ] **Claude Code** — command copies with key+url baked in; `npx tokenfin status` copies;
      manual `claude mcp add` shown. **1 copy + 1 paste target.**
- [ ] **Claude.ai** — "Open Claude connectors" lands on the add-custom-connector modal;
      Name + URL chips each copy in one tap; rule copies. **≤ 4 taps.**
- [ ] **Claude Desktop** — opens claude.ai connectors (syncs); chips copy; rule copies.
- [ ] **Cowork** — opens claude.ai connectors; chips copy; rule references CLAUDE.md.
- [ ] **ChatGPT** — Developer-Mode note shown; opens chatgpt.com; chips copy; rule copies.
- [ ] **Any MCP client** — bridge config copies (`mcp-remote`, Bearer header); rule copies;
      test event works.
- [ ] **Code / API — curl** — snippet copies; `uuidgen` event_id present; endpoint+key baked.
- [ ] **Code / API — JavaScript** — snippet copies; `crypto.randomUUID()` event_id present.
- [ ] **Code / API — Python** — snippet copies; `uuid.uuid4()` event_id present.
- [ ] **Gateway proxy** — env snippet copies; test event works.

Cross-cutting:
- [ ] Reload the page → same key returned (idempotent), completed cards still show
      `Connected ✓` / `Recording ✓` from localStorage.
- [ ] Non-admin user sees the gated "Ask an admin" state (no key rendered).
- [ ] Toggle dark mode → hero, cards, panel, code blocks, and verify bar all legible.
- [ ] `/dashboard/mcp/connect` redirects to `/dashboard/setup`.
- [ ] `npx tsc --noEmit` is clean.
