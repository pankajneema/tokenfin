# TokenFin — Developer Setup

TokenFin is one Next.js app (`web/`) on Supabase Postgres, plus the `tokenfin` CLI (`cli/`) and SDKs (`sdk/`).
There are no other services to run. For production deployment see [README.md](./README.md#deployment);
for rolling TokenFin out to a team see [docs/ROLLOUT.md](./docs/ROLLOUT.md).

## 1. Prerequisites

- Node.js 20+
- Docker (for a local Supabase) and the [Supabase CLI](https://supabase.com/docs/guides/cli)
- `psql` (to apply migrations)

## 2. Start a local Supabase

The repo's `supabase/migrations` folder does not contain the base schema, so start Supabase from a
scratch directory and apply `db/migrations` yourself:

```bash
mkdir -p /tmp/tokenfin-sb && cd /tmp/tokenfin-sb && supabase init && supabase start
```

`supabase start` prints `API_URL`, `ANON_KEY` and `SERVICE_ROLE_KEY`; the database is
`postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

## 3. Apply migrations in order

```bash
cd /path/to/tokenfin && for f in db/migrations/0*.sql; do echo "== $f"; psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f "$f" || break; done
```

Every migration is idempotent and safe to re-run. On a hosted Supabase project, run the same files in
order in the SQL editor, or with `psql` against the project's session-pooler connection string.

**Upgrading a project that already has 001–006:** run the single file `db/upgrade_006_to_019.sql`
(migrations 007–019 concatenated, in one transaction — all or nothing). Regenerate it after adding a
migration.

## 4. Configure and run the web app

```bash
cp web/.env.local.example web/.env.local
```

Fill in the Supabase URL and keys from step 2, then generate the two secrets:

```bash
openssl rand -hex 32
```

Use one value for `KEY_ENCRYPTION_SECRET` (never change it later) and another for `CRON_SECRET`.
Everything else in the file is optional. Then:

```bash
cd web && npm install && npm run dev
```

The app runs on http://localhost:3001. Sign up, and you land in a new workspace.

## 5. Send data

- **Claude Code / Codex / Gemini / OpenCode:** `node cli/bin/tokenfin.js login --app-url http://localhost:3001`, then `node cli/bin/tokenfin.js setup --app-url http://localhost:3001`.
- **Your own backend:** see `sdk/README.md` (`wrapAnthropic` / `wrapOpenAI`), or `POST /api/v1/ingest` with `Authorization: Bearer <key>`.

## 6. Scheduled jobs locally

The cron routes need the `CRON_SECRET` header:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3001/api/v1/cron/alerts
```

Other jobs: `/api/v1/cron/retention`, `/api/v1/cron/digest`, `/api/v1/cron/reconcile`.

## 7. Checks

```bash
cd web && npx tsc --noEmit && npm run lint && npm test
```

SDK tests live in `sdk/` (TypeScript) and `sdk/python` (`python -m pytest tests`).
