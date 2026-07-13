# tokenfin

One command to auto-record your **Claude Code** usage & cost to your [TokenFin](https://tokenfin.curiousdevs.com) dashboard.

```bash
npx tokenfin setup --key tfk_prod_xxx
```

That's it. Restart Claude Code and every session on this machine records token usage automatically — no manual tool calls, no proxy.

## Why a CLI (and not just an MCP server)

An MCP server is **passive** — it only exposes tools. Connecting it gives Claude read/record tools, but nothing *calls* `record_usage`, so the dashboard stays empty. `tokenfin setup` fixes that by installing two things:

1. the **tokenfin MCP server** (user scope) — read + record tools
2. a Claude Code **Stop hook** — after every turn, it reads the transcript's token usage and posts it to your dashboard

The hook is what makes recording actually happen. It's fail-open and silent (never blocks or errors your session).

## Commands

```bash
npx tokenfin login      # sign in via browser (creates a project key, no copy/paste)
npx tokenfin setup      # configure your tool (interactive picker) — MCP + Claude Code auto-record hook
npx tokenfin proxy      # run a local recorder-proxy that auto-records ANY tool (see below)
npx tokenfin status     # show what's currently configured
npx tokenfin remove     # undo everything
```

### Auto-record any tool (`tokenfin proxy`)

Claude Code auto-records via a Stop hook. For **any other tool** (Cursor, Windsurf,
Codex, your own app…), run the recorder-proxy and point the tool at it:

```bash
npx tokenfin proxy          # → http://127.0.0.1:8788
# then, in your tool / shell:
ANTHROPIC_BASE_URL=http://127.0.0.1:8788   # Anthropic
OPENAI_BASE_URL=http://127.0.0.1:8788/v1   # OpenAI
```

Every call is forwarded **unchanged** to the provider and its token usage is
recorded to your dashboard. It's **fail-open** — if recording ever fails, your
request still goes through untouched. Your provider key passes through in its
normal header and is never stored. Works for streaming and non-streaming.

### Options

| Flag | Env | Default |
|---|---|---|
| `-k, --key <key>` | `TOKENFIN_KEY` | prompted (hidden input) |
| `-u, --url <url>` | `TOKENFIN_URL` | `https://tokenfin.curiousdevs.com/api/mcp` |
| `-y, --yes` | — | non-interactive; never prompt |

Get your key from **Dashboard → API Keys**. Use the full raw key (not the masked `tfk_…c05a` display value).

## What it writes

All under `~/.claude/`:

- `tokenfin-hook.json` — `{ url, key }`, `chmod 600`
- `tokenfin-record-usage.js` — the Stop hook recorder
- `settings.json` — a `Stop` hook entry (backed up to `settings.json.bak-tokenfin` first)
- registers the `tokenfin` MCP server via `claude mcp add --scope user`

Zero dependencies, cross-platform (macOS / Linux / Windows), Node ≥ 16.

## Requirements

- [Claude Code](https://claude.com/claude-code) installed (`claude` on your PATH)
- Node.js ≥ 16 (ships with Claude Code)

## Other clients

The auto-record hook is Claude-Code-specific. For **Cursor / Claude Desktop / Claude.ai / ChatGPT**, connect the MCP server for read/compress tools from **Dashboard → Connect via MCP**; deterministic auto-recording there requires the TokenFin gateway (`ANTHROPIC_BASE_URL` proxy).
