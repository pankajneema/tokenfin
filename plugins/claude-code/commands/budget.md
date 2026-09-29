---
description: Budget status plus a month-end forecast from the trailing daily average
argument-hint: "[trailing-days, default 7]"
---

Use the TokenFin MCP tools (read-only) to answer "are we on budget this month?".

Arguments: `$ARGUMENTS` (optional number of trailing days for the forecast; default 7).

1. Call `get_mtd_and_forecast` (pass `trailing_days` if an argument was given) and `get_budget_status`.
2. Reply with:
   - Month-to-date spend and projected month-end, each split into **metered** (billable) and
     **notional** (subscription at API rates, not a bill).
   - Each active budget: scope, period, budget, % used, status. Flag `warning`, `throttled` or
     `blocked` first.
   - If the projected metered spend exceeds a monthly budget, say by how much and roughly on which
     day it would cross (budget − MTD) ÷ trailing daily average.
3. If there are no budgets, say so and suggest setting one under Dashboard → Limits.
4. The forecast is a simple trailing average; say so in one short clause.
