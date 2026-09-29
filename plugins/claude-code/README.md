# TokenFin plugin for Claude Code

Ask your TokenFin dashboard about AI spend without leaving Claude Code. The plugin adds:

- **An MCP server**: TokenFin's remote, read-only MCP endpoint (`/api/mcp`), authenticated with
  your **read key**. It has no write tools and never records usage (capture is OpenTelemetry).
- **Slash commands**
  - `/tokenfin:spend [days | A..B] [by dim]`: spend for a period, split into metered (billable)
    and notional (subscription at API rates), broken down by model/project/member/source/agent/
    skill/mcp_server/repo.
  - `/tokenfin:budget [trailing-days]`: budget status plus a month-end forecast.
  - `/tokenfin:top-models [days] [limit]`: models ranked by cost, plus cheaper-model insights.

You can also just ask, for example "what did our team spend on Opus last week?", and Claude
picks the right tool (`get_breakdown`, `get_sessions`, `get_prompts`, `get_mtd_and_forecast`,
`get_insights`, …). See [`docs/MCP.md`](../../docs/MCP.md) for the full tool list.

## What you see depends on your role

The server uses the role of the person who owns the key. **Owners and admins** see the whole
org. **Members and viewers** see org-level totals, but only **their own** prompts, sessions and
per-member spend.

## Install

1. **Get a read key.** Run `npx tokenfin@latest login` (it stores a per-device `read_key` in
   `~/.tokenfin/config.json`), or create a *read* key under Dashboard → API Keys. Don't use
   an ingest key: the server refuses it with `403`.
2. **Export it** in the shell that starts Claude Code (for example in `~/.zshrc`):

   ```bash
   export TOKENFIN_READ_KEY="tfk_…"                        # required
   export TOKENFIN_URL="https://tokenfin.curiousdevs.com"  # optional; your self-hosted URL
   ```

3. **Install the plugin** from a checkout of this repo:

   ```text
   /plugin marketplace add ./plugins/claude-code
   /plugin install tokenfin@tokenfin
   ```

   Restart Claude Code, then run `/mcp`. You should see `tokenfin` connected.
   To try it without installing, run `claude --plugin-dir ./plugins/claude-code`.

> Already ran `npx tokenfin@latest setup`? It registers the same server at user scope as
> `tokenfin`. Keep one of the two. If you keep both, remove the user-scope copy with
> `claude mcp remove -s user tokenfin`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `401 Unauthorized` | `TOKENFIN_READ_KEY` is unset, revoked or expired. Run `npx tokenfin@latest login` again. |
| `403 key lacks read scope` | You exported the ingest key. Use `read_key`. |
| Results say "Scoped to your own usage" | Expected for member/viewer keys. |
| Prompt text missing from `get_prompts` | Prompt capture is off for the org (Settings → Privacy). Previews are always redacted. |

## Development

`claude plugin validate plugins/claude-code` checks the manifests. This plugin is not published
to any marketplace.
