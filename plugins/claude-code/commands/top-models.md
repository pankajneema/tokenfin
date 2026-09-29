---
description: Rank models by cost for a period and point out cheaper-model opportunities
argument-hint: "[days, default 30] [limit, default 10]"
---

Use the TokenFin MCP tools (read-only) to rank models by spend.

Arguments: `$ARGUMENTS` (first number = days, default 30; second = how many rows, default 10).

1. Call `get_breakdown` with `dim: "model"`, `days`, and `limit`.
2. Show a table: model, metered $, notional $, share of total %, requests, total tokens,
   cost per 1k requests. Put the "other" bucket last if present.
3. Call `get_insights` once. If it returns model-related findings (e.g. cheaper model candidates),
   list at most three with their estimated monthly saving. If it returns `available: false`, skip
   this step silently.
4. Keep the answer under 15 lines. Never add notional cost to metered cost as a "bill".
