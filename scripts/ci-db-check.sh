#!/usr/bin/env bash
# CI database check (also runnable locally against a THROWAWAY Supabase Postgres):
#   1. db/migrations and supabase/migrations copies are byte-identical
#   2. every db/migrations/*.sql applies in order — twice (idempotency)
#   3. scripts/rls-check.sql passes
#
#   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres scripts/ci-db-check.sh
#   scripts/ci-db-check.sh --copies-only      # step 1 only, no database needed
#
# Never point DATABASE_URL at a real project: step 2 re-runs every migration.
set -euo pipefail
cd "$(dirname "$0")/.."

# ── 1. migration copies ──────────────────────────────────────────────────────
# Every db/migrations/NNN_<name>.sql from 002 on must have a byte-identical
# supabase/migrations/<timestamp>_<name>.sql. 001 (base schema) has no copy.
fail=0
for f in db/migrations/[0-9][0-9][0-9]_*.sql; do
  base=$(basename "$f"); num=${base%%_*}; name=${base#*_}
  [ "$((10#$num))" -lt 2 ] && continue
  matches=()
  for s in supabase/migrations/*.sql; do
    sb=$(basename "$s"); [ "${sb#*_}" = "$name" ] && matches+=("$s")
  done
  if [ "${#matches[@]}" -eq 0 ]; then
    echo "::error file=$f::no supabase/migrations/*_$name copy"; fail=1; continue
  fi
  if [ "${#matches[@]}" -ne 1 ]; then
    echo "::error file=$f::several supabase copies match *_$name: ${matches[*]}"; fail=1; continue
  fi
  if ! cmp -s "$f" "${matches[0]}"; then
    echo "::error file=$f::differs from ${matches[0]}"; fail=1
  fi
done
[ "$fail" -eq 0 ] || { echo "migration copies are not byte-identical"; exit 1; }
echo "✓ migration copies identical"
[ "${1:-}" = "--copies-only" ] && exit 0

# ── 2. apply all migrations twice ────────────────────────────────────────────
: "${DATABASE_URL:?set DATABASE_URL to a throwaway Supabase Postgres}"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X)
# Migrations skipped on pass 2 ONLY. Empty: every migration is idempotent
# (001 creates each policy only if missing, so a re-run never reverts the
# stricter policies later migrations installed). Never add one here.
IDEMPOTENCY_EXEMPT="${IDEMPOTENCY_EXEMPT-}"
for pass in 1 2; do
  for f in db/migrations/[0-9][0-9][0-9]_*.sql; do
    if [ "$pass" -eq 2 ] && [[ " $IDEMPOTENCY_EXEMPT " == *" $(basename "$f") "* ]]; then
      echo "  (pass 2: skipping known non-idempotent $(basename "$f"))"; continue
    fi
    if ! PGOPTIONS='-c client_min_messages=warning' "${PSQL[@]}" -f "$f" >/dev/null; then
      echo "::error file=$f::migration failed on pass $pass"; exit 1
    fi
  done
  echo "✓ migrations applied (pass $pass)"
done

# ── 3. RLS / privileges ──────────────────────────────────────────────────────
PGOPTIONS='-c client_min_messages=notice' "${PSQL[@]}" -f scripts/rls-check.sql
echo "✓ RLS check passed"
