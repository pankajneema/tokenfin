---
description: Show AI spend for a period (default: last 30 days), split into billable and notional cost
argument-hint: "[days | YYYY-MM-DD..YYYY-MM-DD] [by model|project|member|source|agent|skill|mcp_server|repo]"
---

Use the TokenFin MCP tools (read-only) to report AI spend.

Arguments: `$ARGUMENTS`

1. Work out the range. A bare number means the last N days; `A..B` means `from=A`, `to=B`
   (YYYY-MM-DD, inclusive, in the org's time zone). Default: last 30 days.
2. Call `get_breakdown` with `dim` = the requested "by …" dimension (default `model`) and the range.
   Call `get_spend` with the same number of days for the headline.
3. Reply with:
   - One headline line: total, then **metered** (billable) and **notional** (subscription usage priced
     at API rates) separately. Never add notional into a bill.
   - A compact table of the top rows: key, metered $, notional $, requests, tokens.
   - One sentence on anything notable (a single row over 50% of spend, etc.).
4. If a result says it is scoped to your own usage, say so — the key belongs to a member/viewer.
5. If the tools are unavailable, tell the user to set `TOKENFIN_READ_KEY` (run
   `npx tokenfin@latest login`, then read `read_key` from `~/.tokenfin/config.json`) and restart
   Claude Code.
