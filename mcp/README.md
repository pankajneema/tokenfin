# @tokenfin/mcp

TokenFin MCP Server — connect **Claude Desktop**, **Cursor**, **OpenCode**, **Claude CLI**, **Windsurf**, and any MCP-compatible AI tool directly to your [TokenFin](https://tokenfin.io) dashboard.

No code integration needed. The AI tool tracks its own usage automatically.

---

## Tools exposed

| Tool | What it does |
|---|---|
| `track_usage` | Log a model call — tokens, cost, project, tags |
| `get_spending` | Current-period cost + token summary |
| `check_limits` | Budget status with % used and progress bar |
| `list_projects` | Your TokenFin projects (for tagging usage) |
| `get_top_models` | Per-model breakdown for last 30 days |

---

## Setup

### 1. Get your API key

Dashboard → **API Keys** → Create key → copy it.

### 2. Add to your tool

---

#### Claude Desktop

Config file location:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "tokenfin": {
      "command": "npx",
      "args": ["-y", "@tokenfin/mcp"],
      "env": {
        "TOKENFIN_API_KEY": "tf_live_your_key_here",
        "TOKENFIN_BASE_URL": "https://tokenfin.curiousdevs.com"
      }
    }
  }
}
```

Restart Claude Desktop. You'll see the TokenFin tools in the tool list.

---

#### Cursor

Create or edit `.cursor/mcp.json` in your project root (or `~/.cursor/mcp.json` for global):

```json
{
  "mcpServers": {
    "tokenfin": {
      "command": "npx",
      "args": ["-y", "@tokenfin/mcp"],
      "env": {
        "TOKENFIN_API_KEY": "tf_live_your_key_here",
        "TOKENFIN_BASE_URL": "https://tokenfin.curiousdevs.com"
      }
    }
  }
}
```

---

#### OpenCode

Add to your `~/.config/opencode/config.json`:

```json
{
  "mcp": {
    "tokenfin": {
      "type": "local",
      "command": ["npx", "-y", "@tokenfin/mcp"],
      "environment": {
        "TOKENFIN_API_KEY": "tf_live_your_key_here",
        "TOKENFIN_BASE_URL": "https://tokenfin.curiousdevs.com"
      }
    }
  }
}
```

---

#### Claude CLI (Claude Code)

Add to your project's `.claude/settings.json` or global `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "tokenfin": {
      "command": "npx",
      "args": ["-y", "@tokenfin/mcp"],
      "env": {
        "TOKENFIN_API_KEY": "tf_live_your_key_here",
        "TOKENFIN_BASE_URL": "https://tokenfin.curiousdevs.com"
      }
    }
  }
}
```

Or use the CLI directly:
```bash
claude mcp add tokenfin npx -- -y @tokenfin/mcp
```

Then set env vars:
```bash
export TOKENFIN_API_KEY=tf_live_your_key_here
export TOKENFIN_BASE_URL=https://tokenfin.curiousdevs.com
```

---

#### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "tokenfin": {
      "command": "npx",
      "args": ["-y", "@tokenfin/mcp"],
      "env": {
        "TOKENFIN_API_KEY": "tf_live_your_key_here",
        "TOKENFIN_BASE_URL": "https://tokenfin.curiousdevs.com"
      }
    }
  }
}
```

---

## Run locally (development)

```bash
# Clone the repo and enter mcp/
cd tokenfin/mcp
npm install
npm run build

# Run the server
TOKENFIN_API_KEY=tf_live_... TOKENFIN_BASE_URL=https://tokenfin.curiousdevs.com node dist/index.js
```

Point your tool config at the local binary:
```json
{
  "mcpServers": {
    "tokenfin": {
      "command": "node",
      "args": ["/absolute/path/to/tokenfin/mcp/dist/index.js"],
      "env": {
        "TOKENFIN_API_KEY": "tf_live_...",
        "TOKENFIN_BASE_URL": "https://tokenfin.curiousdevs.com"
      }
    }
  }
}
```

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TOKENFIN_API_KEY` | ✅ | — | API key from Dashboard → API Keys |
| `TOKENFIN_BASE_URL` | — | `https://tokenfin.curiousdevs.com` | TokenFin instance URL |

---

## How it works

```
AI Tool (Claude / Cursor / etc.)
        │
        │  MCP stdio protocol
        ▼
  @tokenfin/mcp server
        │
        │  HTTP  POST /api/v1/ingest
        │        GET  /api/v1/analytics
        │        GET  /api/v1/limits
        │        GET  /api/v1/projects
        │        GET  /api/v1/models
        ▼
  TokenFin Dashboard (Next.js + Supabase)
```

The MCP server runs as a local process. Your AI tool communicates with it over stdio. The server calls TokenFin's API routes using your API key.
