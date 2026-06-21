.PHONY: install dev lint typecheck \
        go-tidy go-vet go-build go-ingest go-worker \
        sdk-install sdk-typecheck sdk-build \
        sdk-py-install sdk-py-test sdk-py-build \
        docker-build docker-up docker-down docker-logs \
        db-migrate gen-types

# ── Web (Next.js) ──────────────────────────────────────────────────────────────
install:
	cd web && npm install

dev:
	cd web && npm run dev

lint:
	cd web && npm run lint

typecheck:
	cd web && npm run typecheck

# ── Go backend ─────────────────────────────────────────────────────────────────
go-tidy:
	cd backend && go mod tidy

go-vet:
	cd backend && go vet ./...

go-build:
	cd backend && go build -o bin/ingest ./cmd/ingest && go build -o bin/worker ./cmd/worker

go-ingest:
	cd backend && go run ./cmd/ingest

go-worker:
	cd backend && go run ./cmd/worker

# Run both Go services in background (local dev — requires Redis running)
go-dev: go-build
	@echo "Starting ingest on :8001 and worker on :8002"
	@./backend/bin/ingest & ./backend/bin/worker

# ── SDK (@tokenfin/sdk) ────────────────────────────────────────────────────────
sdk-install:
	cd sdk && npm install

sdk-typecheck:
	cd sdk && npm run typecheck

sdk-build:
	cd sdk && npm run build

# ── Python SDK (tokenfin-py) ───────────────────────────────────────────────────
sdk-py-install:
	cd sdk/python && pip install -e ".[dev]"

sdk-py-test:
	cd sdk/python && python -m pytest tests/ -v

sdk-py-build:
	cd sdk/python && pip install build --quiet && python -m build

# ── Docker ─────────────────────────────────────────────────────────────────────
# Build all images without starting containers
docker-build:
	docker compose -f infra/docker/docker-compose.yml build

# Start all services (redis + ingest + worker + web)
docker-up:
	docker compose -f infra/docker/docker-compose.yml --env-file .env up --build -d

# Start with logs in foreground
docker-up-fg:
	docker compose -f infra/docker/docker-compose.yml --env-file .env up --build

# Stop and remove containers + volumes
docker-down:
	docker compose -f infra/docker/docker-compose.yml down -v

# Tail logs for all services
docker-logs:
	docker compose -f infra/docker/docker-compose.yml logs -f

# Start only infrastructure (redis) for local Go/Node dev
docker-redis:
	docker compose -f infra/docker/docker-compose.yml up redis -d

# ── Database ───────────────────────────────────────────────────────────────────
db-migrate:
	@echo "Run migrations in order via Supabase SQL Editor or CLI:"
	@ls db/migrations/ | sort

# ── Generate Supabase types ───────────────────────────────────────────────────
gen-types:
	npx supabase gen types typescript \
	  --project-id jolfgtrjvfueoaoopous \
	  > web/src/types/db.ts
	@echo "✓ web/src/types/db.ts updated"

# ── Verify everything builds cleanly ─────────────────────────────────────────
check: go-vet typecheck sdk-typecheck sdk-py-test
	@echo "✓ All checks passed"
