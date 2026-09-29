# TokenFin operations

How to tell whether a TokenFin deployment is healthy, what the scheduled jobs
do, and how to run them without Vercel Cron.

## Health check

`GET /api/health` needs no authentication and exposes no secrets:

```json
{ "ok": true, "db": 14, "version": "0.1.0", "migrations": 18 }
```

| Field | Meaning |
|---|---|
| `ok` | The database answered. The endpoint returns HTTP **200** when it did, **503** when it did not. |
| `db` | Round-trip latency to Postgres in ms (through PostgREST, using the service role). `null` when unreachable. |
| `version` | `web/package.json` version. |
| `migrations` | The highest migration whose sentinel table or column exists. `null` if it can't be detected (before 017 is applied). When a new migration creates something, add it to `SENTINELS` in `web/src/app/api/health/route.ts`. |

Each instance caches the result for 10 s and sends `Cache-Control: max-age≤10`,
so a load balancer probing every second costs at most one DB query per 10 s per
instance. Point uptime monitors (Better Uptime, Pingdom, a k8s
readiness probe) at it and alert on anything other than 200.

## Logs

`web/src/lib/log.ts` writes one JSON object per line: to stdout for
debug/info, and to stderr for warn/error.

```json
{"ts":"2026-09-29T03:30:00.412Z","level":"info","msg":"job finished","route":"/api/v1/cron/retention","job":"retention","run_id":42,"duration_ms":180,"ok":true,"summary":{...}}
```

- Standard fields: `level`, `msg`, `route`, `org_id`, `duration_ms`, and `err`
  (`{name, message, stack}`).
- `LOG_LEVEL` sets the minimum level: `debug|info|warn|error`. The default is
  `info`, or `warn` under tests.
- **Privacy:** never log prompt text, emails or raw keys. As a safety net, the
  logger does two things:
  - It replaces fields named like `*password*`, `*secret*`, `*_token`,
    `api_key`, `authorization`, `cookie`, `prompt_text`, `*email*`, `dsn`
    with `"[redacted]"`.
  - It masks values that look like credentials anywhere in strings: `tfk_…`,
    `sk-…`, `Bearer …`, JWTs, and GitHub tokens.
- Cron routes use it today. Other routes can move to it over time:
  `log.child({ route })`.

## Error reporting (optional)

Set `SENTRY_DSN` to send errors to Sentry. `lib/monitoring.ts` posts them to
Sentry's envelope endpoint with `fetch`, so there is no SDK dependency. The
call has a 3 s timeout and never throws. Without a DSN it does nothing.

| Env | Default |
|---|---|
| `SENTRY_DSN` | unset, so reporting is off |
| `SENTRY_ENVIRONMENT` | `NODE_ENV` |
| `SENTRY_RELEASE` | `VERCEL_GIT_COMMIT_SHA` |

Only the error (scrubbed) and explicit tags reach Sentry. Request bodies,
headers, cookies and users are never sent. Failed or crashed cron runs are
reported automatically. Anywhere else, call:

```ts
await captureException(err, { tags: { route: '/api/v1/…' } })
```

## Scheduled jobs

| Job | Route | Default schedule (`web/vercel.json`, UTC) | What it does |
|---|---|---|---|
| reconcile | `/api/v1/cron/reconcile` | 02:00 daily | Pulls provider-billed costs for connected admin keys |
| connectors | `/api/v1/cron/connectors` | 02:30 daily | Pulls usage from coding-tool vendors and merged PRs from GitHub |
| retention | `/api/v1/cron/retention` | 03:30 daily | `purge_expired_data()`: applies each org's retention |
| prices | `/api/v1/cron/prices` | 03:30 daily | Checks the price catalog against LiteLLM |
| alerts | `/api/v1/cron/alerts` | 04:00 daily | Evaluates alert rules and delivers the ones that fired |
| digest | `/api/v1/cron/digest` | 05:00 Monday | Weekly digest; idempotent per org and week |

Every route **fails closed**. It returns 401 unless `CRON_SECRET` is set and
the request carries `Authorization: Bearer $CRON_SECRET`. Vercel Cron sends
that header automatically.

### job_runs (migration 017)

Every run is recorded by `withJobRun()` (`lib/jobs.ts`):

1. `job_run_start(job)` inserts a row. It also prunes rows older than 30 days.
2. `job_run_finish(id, ok, summary, error)` completes the row.

What gets recorded:

- `ok`: the response status was below 400.
- `summary`: the job's JSON response, with secrets scrubbed and 16 KB at most.
- `error`: the `error` field of the response, or the exception.

`ok IS NULL` with no `finished_at` means the run died, for example on a
timeout. The table is service-role only. Query it with psql or the SQL editor:

```sql
-- Last run of each job
SELECT DISTINCT ON (job) job, started_at, ok, duration_ms, error, summary
FROM job_runs ORDER BY job, started_at DESC;

-- Failures and hung runs in the last 7 days
SELECT * FROM job_runs
WHERE started_at > now() - interval '7 days' AND ok IS DISTINCT FROM true
ORDER BY started_at DESC;

-- Jobs that have not succeeded in 26 h (the weekly digest excepted): alert on this
SELECT j.job FROM unnest(array['alerts','retention','reconcile','connectors','prices']) AS j(job)
WHERE NOT EXISTS (SELECT 1 FROM job_runs r WHERE r.job = j.job AND r.ok AND r.started_at > now() - interval '26 hours');
```

If recording fails, for example because 017 isn't applied, a warning is
logged and the job still runs.

### Running the jobs without Vercel Cron: pg_cron

Self-hosted deployments, or anyone not on Vercel, can schedule the jobs inside
Postgres. On Supabase, enable **pg_cron** and **pg_net** under Database →
Extensions.

**Option A: call the routes over HTTP with pg_net.** This keeps
job_runs, logging and Sentry reporting exactly as with Vercel Cron. Keep the
secret in Vault, not in the job text:

```sql
-- once
SELECT vault.create_secret('<your CRON_SECRET>', 'tokenfin_cron_secret');
SELECT vault.create_secret('https://tokenfin.example.com', 'tokenfin_app_url');

CREATE OR REPLACE FUNCTION public.tokenfin_call_cron(p_job text)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
  SELECT net.http_get(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'tokenfin_app_url')
               || '/api/v1/cron/' || p_job,
    headers := jsonb_build_object('Authorization', 'Bearer ' ||
               (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'tokenfin_cron_secret')),
    timeout_milliseconds := 300000)
$$;
REVOKE EXECUTE ON FUNCTION public.tokenfin_call_cron(text) FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('tokenfin-reconcile',  '0 2 * * *',   $$SELECT public.tokenfin_call_cron('reconcile')$$);
SELECT cron.schedule('tokenfin-connectors', '30 2 * * *',  $$SELECT public.tokenfin_call_cron('connectors')$$);
SELECT cron.schedule('tokenfin-retention',  '30 3 * * *',  $$SELECT public.tokenfin_call_cron('retention')$$);
SELECT cron.schedule('tokenfin-prices',     '30 3 * * *',  $$SELECT public.tokenfin_call_cron('prices')$$);
SELECT cron.schedule('tokenfin-alerts',     '0 4 * * *',   $$SELECT public.tokenfin_call_cron('alerts')$$);
SELECT cron.schedule('tokenfin-digest',     '0 5 * * 1',   $$SELECT public.tokenfin_call_cron('digest')$$);

-- HTTP results (pg_net keeps them ~6 h):
SELECT id, status_code, left(content::text, 200) FROM net._http_response ORDER BY id DESC LIMIT 20;
```

pg_net is asynchronous, so a slow job never holds a database connection.
Remove Vercel's `crons` block if you move to this, or every job runs twice.
The digest is idempotent. The others are safe to repeat but waste work.

**Option B: run the purge directly in SQL.** This covers only the retention
job, because it is pure SQL. It needs no app URL or secret, and still records
the run in job_runs:

```sql
CREATE OR REPLACE FUNCTION public.tokenfin_retention_job()
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE id bigint := job_run_start('retention'); res jsonb;
BEGIN
  res := jsonb_build_object('purged', purge_expired_data(), 'via', 'pg_cron');
  PERFORM job_run_finish(id, true, res, NULL);
EXCEPTION WHEN OTHERS THEN
  PERFORM job_run_finish(id, false, NULL, SQLERRM);
  RAISE;
END $$;
REVOKE EXECUTE ON FUNCTION public.tokenfin_retention_job() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('tokenfin-retention-sql', '30 3 * * *', $$SELECT public.tokenfin_retention_job()$$);
```

The failing path records nothing: the `RAISE` rolls back the `job_run_finish`
call. Check `cron.job_run_details` for failures. The other jobs call external
APIs (providers, GitHub, email, Slack), so they need Option A.

## CI (`.github/workflows/ci.yml`)

| Job | What it proves |
|---|---|
| `web` | `tsc`, `next lint`, vitest (unit tests plus route auth tests in `src/app/api/_tests`) |
| `migration-copies` | Each `db/migrations/NNN_name.sql` (003 and later) is byte-identical to its `supabase/migrations/<ts>_name.sql` |
| `db` | See below |
| `cli` | `cd cli && npm test` |
| `sdk` / `sdk-python` / `docker` | unchanged |

The `db` job:

1. Starts a throwaway local Supabase.
2. Applies **every** `db/migrations/*.sql` in order **twice**, which proves
   the migrations are idempotent.
3. Runs `scripts/rls-check.sql`.
4. Runs the web tests.
5. Builds the app and runs the Playwright smoke tests.
6. Calls the cron routes and asserts the `job_runs` rows exist.

`001_schema.sql` is skipped on the second pass. Its bare `CREATE POLICY`
statements aren't re-runnable, and `IDEMPOTENCY_EXEMPT` in
`scripts/ci-db-check.sh` records that exception. No other migration may be
added to that list.

Run the same checks locally, **against a throwaway database only**:

```bash
scripts/ci-db-check.sh --copies-only
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres scripts/ci-db-check.sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/rls-check.sql   # RLS only; runs in a rolled-back transaction
```

`rls-check.sql` asserts the following, then rolls back:

- Every public table has RLS enabled.
- No view readable by clients bypasses RLS.
- The service-role-only functions (`job_run_*`, `tf_schema_probe`, `purge_*`)
  aren't executable by `anon` or `authenticated`.
- `anon`, and an `authenticated` user who isn't a member, see **0 rows** in
  every table. Rows are seeded first, so an empty result proves denial.
- Clients can't write `job_runs`, `api_keys` or `organizations`.
- `service_role` still works.

## Playwright smoke (`web/e2e`)

```bash
cd web
npx playwright install chromium     # once
E2E_BASE_URL=http://localhost:3002 npm run test:e2e
```

The tests need a running app and never start `next dev` themselves. The
smoke tests need no credentials. They cover:

- the login, signup, forgot-password and legal pages
- the anonymous redirect to `/login?next=`
- the shape of `/api/health`
- 401s from protected APIs

The authenticated specs run only when `E2E_EMAIL` and `E2E_PASSWORD` are set.
Use a test account.

## Generated DB types

```bash
cd web && npm run gen:types      # SUPABASE_DB_URL overrides the default local URL
```

This command writes `web/src/types/supabase.ts` from the local database. Run
it after applying a new migration locally and commit the result. The existing
hand-written `types/db.ts` still works. New code can use
`createClient<Database>()`.

## Scaling usage_events

Above roughly 50M raw events, see `scripts/partition-usage-events.sql`. It's
an opt-in, tested plan for monthly range partitioning:

1. Prepare the partitioned table and a dedup key table.
2. Backfill in re-runnable one-day slices.
3. Swap under a short lock, re-attaching the rollup triggers, RLS policies and
   foreign keys.

A rollback recipe is included. It requires one app change first: the ingest
path must switch from `upsert(onConflict: 'org_id,event_id')` to a plain
`insert`, with dedup moving to a trigger. The script header explains why.
