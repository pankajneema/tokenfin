.PHONY: dev dev-ui dev-backend install install-js install-py \
        lint lint-js lint-py test test-py typecheck \
        docker-up docker-down db-migrate

PYTHON      := /opt/homebrew/bin/python3.11
VENV        := backend/.venv
VENV_PYTHON := $(VENV)/bin/python
VENV_PIP    := $(VENV)/bin/pip

# ── Install ───────────────────────────────────────────────────────────────────
install-js:
	npm install

install-py:
	$(PYTHON) -m venv $(VENV)
	$(VENV_PIP) install --upgrade pip
	$(VENV_PIP) install -r backend/requirements.txt

install-py-dev: install-py
	$(VENV_PIP) install ruff pytest pytest-asyncio mypy

install: install-js install-py

# ── Dev ───────────────────────────────────────────────────────────────────────
dev-ui:
	npm run dev

dev-backend:
	cd backend && $(VENV_PYTHON) -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

dev:
	make -j2 dev-ui dev-backend

# ── Lint ──────────────────────────────────────────────────────────────────────
lint-js:
	npm run lint

lint-py:
	cd backend && ruff check app/

lint: lint-js lint-py

# ── Type-check ────────────────────────────────────────────────────────────────
typecheck:
	npm run typecheck

# ── Test ──────────────────────────────────────────────────────────────────────
test-py:
	cd backend && pytest tests/ -v

test: test-py

# ── Docker ────────────────────────────────────────────────────────────────────
docker-up:
	docker compose up --build

docker-down:
	docker compose down -v

# ── Database ──────────────────────────────────────────────────────────────────
db-migrate:
	@echo "Run migrations in order via Supabase SQL Editor:"
	@ls db/migrations/ | sort

# ── Generate Supabase types ──────────────────────────────────────────────────
gen-types:
	npx supabase gen types typescript \
	  --project-id jolfgtrjvfueoaoopous \
	  > src/types/db.ts
	@echo "✓ src/types/db.ts updated"
