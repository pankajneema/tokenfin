# Contributing to TokenFin

Thanks for your interest in improving TokenFin. This guide covers how to get set up, the conventions the codebase relies on, and what we look for in a pull request.

## Before you start

- Look for an existing issue first, or open one to discuss larger changes before you write code.
- Read [`MIGRATION.md`](./MIGRATION.md) before proposing anything that puts TokenFin in the model request path (proxy, gateway, base-URL rewriting), parses agent transcripts, or adds a write-capable MCP tool. Those designs were removed on purpose.
- Security issues: do **not** open a public issue. See [`SECURITY.md`](./SECURITY.md).

## Development setup

Follow [Local development](./README.md#local-development) in the README. In short:

```bash
make install                              # web dependencies
cp web/.env.local.example web/.env.local  # fill in Supabase URL + keys
make dev                                  # http://localhost:3001
```

Apply `db/migrations/*.sql` in order (001 → 006) to your Supabase database first.

## Conventions

These rules come from real bugs. Please follow them.

1. **Server/client split.** Dashboard routes use a `page.tsx` Server Component for data fetching and a `_client.tsx` (`'use client'`) for UI and state. Shared interfaces go in `_types.ts`.
2. **Admin client stays on the server.** `createAdminClient()` (service role, bypasses RLS) must never be imported in a `'use client'` file. Any route that uses it must do its own org-membership or role check (`lib/api/auth.ts`, `lib/rbac.ts`).
3. **No mock data.** If there's no data, render an informative empty state. Never fall back to demo arrays or random numbers.
4. **Metered vs. notional.** Before computing "spend", decide whether it must be a real bill (read `usage_agg`) or must see all activity (read `usage_events`). See [`docs/data-flow.md`](./docs/data-flow.md#the-metered-vs-notional-split).
5. **One price table.** Model prices live only in `web/src/lib/mcp/pricing.ts` (and the Go mirror in `backend/internal/pricing`). Don't inline prices anywhere else.
6. **OTLP mapping in one place.** New metric or attribute names go in `web/src/lib/otlp/mapping.ts`. Add them only after you've confirmed them against a real agent session, and add a test.
7. **Migrations are additive and idempotent.** Add a new numbered file in `db/migrations/` (for example `007_…sql`) using `IF NOT EXISTS` / `CREATE OR REPLACE`. Don't edit an already-released migration's behavior. Enable RLS on every new table. Mirror incremental migrations into `supabase/migrations/` with a timestamped name.
8. **TypeScript strict.** No `any` escapes without a reason, and `npm run typecheck` must pass.
9. **Keep docs honest.** If you change behavior described in `README.md`, `docs/` or `CLAUDE.md`, update them in the same PR.

## Checks to run before opening a PR

```bash
make typecheck            # web: tsc --noEmit
make lint                 # web: next lint
cd web && npm test        # web: vitest
cd backend && go vet ./... && go test ./...   # if you touched Go
make sdk-typecheck        # if you touched the TS SDK
make sdk-py-test          # if you touched the Python SDK
```

`make check` runs Go vet, web typecheck, SDK typecheck and the Python tests together.

## Pull requests

- Keep each PR focused on one change. Separate refactors from behavior changes.
- Describe **what** changed and **why**, and how you verified it. For capture changes, say whether you tested against a real agent session or only with fixtures.
- Include screenshots for UI changes. Make sure no real customer data, prompts or emails are visible.
- Add or update tests for bug fixes and new logic, especially in `web/src/lib/otlp/`.
- Commit messages: short imperative subject line (for example "otlp: derive Gemini histogram tokens"), with detail in the body.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
