# Security Policy

TokenFin handles usage telemetry, prompt text and API keys for its users, so we take security reports seriously.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions or pull requests.**

Report them privately through GitHub's private vulnerability reporting: open the repository's **Security** tab and click **Report a vulnerability**.

Please include:

- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- Affected component(s): `web/`, `cli/`, `sdk/`, database migrations
- Any suggested fix or mitigation

What to expect:

- We aim to acknowledge reports within **3 business days**.
- We will keep you informed while we investigate and fix the issue.
- Once a fix is released, we are happy to credit you, unless you prefer to stay anonymous.

Please give us reasonable time to fix the issue before any public disclosure. Do not access, modify or delete other users' data while researching.

## Supported versions

Security fixes go to the `main` branch and the latest published versions of the `tokenfin` CLI, `@tokenfin/sdk` and the `tokenfin` Python package.

## Scope

In scope:

- Tenant isolation: Row-Level Security policies, org scoping in API routes, service-role usage
- API key handling: SHA-256 hashing, AES-256-GCM reveal and copy flows, scopes and expiry
- The OTLP receiver (`/api/otel/v1/*`), SDK ingest (`/api/v1/ingest`) and MCP server (`/api/mcp`)
- The CLI's handling of local config files and credentials (`~/.tokenfin/config.json`)
- Data deletion and retention (Settings → Data)

Out of scope:

- Vulnerabilities in third-party services (Supabase, Vercel, Railway, Resend) themselves
- Findings that require a compromised developer machine or leaked service-role key
- Missing best-practice headers with no demonstrated impact

## Security design notes

- TokenFin is never in the model request path and never stores provider API keys (see [`MIGRATION.md`](./MIGRATION.md)).
- API keys are stored only as a SHA-256 hash plus a masked prefix. Revealable keys are encrypted with AES-256-GCM using `KEY_ENCRYPTION_SECRET`.
- `SUPABASE_SERVICE_ROLE_KEY` and `KEY_ENCRYPTION_SECRET` are server-only secrets. Never expose them to the browser or commit them.
