# Agents — coding-agent configs per person and machine

Dashboard → **Agents** (`/dashboard/agents`) shows, for every person and every machine, which coding
agents are installed (Claude Code, OpenCode, Codex CLI, Gemini CLI), how each one is configured, and
whether its telemetry is actually reaching this TokenFin. Owners and admins can request safe changes;
each person can do the same for their own machines. Nothing is ever changed remotely: the machine
pulls the request, shows the diff, and applies it only after someone confirms.

```
 machine                                   TokenFin
 ───────                                   ────────
 tokenfin config push  ── redacted ──►  POST /api/v1/agent-configs      → agent_devices / agent_configs / agent_config_history
 (also setup / status / doctor)
                                         /dashboard/agents  ── "Edit settings" ──►  agent_config_changes (pending)
 tokenfin config pull  ◄── pending ────  GET  /api/v1/agent-configs/changes
   diff → confirm → backup → write
                       ── outcome ───►  PATCH /api/v1/agent-configs/changes (applied | failed)  + audit_log
                       ── snapshot ──►  POST /api/v1/agent-configs
```

## What is collected (`cli/lib/agentconfig.js`)

| Agent | Files | Snapshot (`config`) |
|---|---|---|
| Claude Code | `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR`), `~/.claude.json` | `settings` (env, model, permissions, hooks, statusLine, enabledPlugins, …), `mcp_servers` (name, type, url / command only), `hooks_index` (one row per hook with a stable id), `statusline_script` |
| OpenCode | `~/.config/opencode/opencode.json(c)`, `plugin/` dir | `settings`, `plugin_dir`, `tokenfin_plugin` {installed, ours, version, current}, `tokenfin_app_url`, `tokenfin_key_present` |
| Codex CLI | `~/.codex/config.toml` (or `$CODEX_HOME`) | `settings` (TOML parsed to JSON by `cli/lib/toml.js`), `tokenfin_block` |
| Gemini CLI | `~/.gemini/settings.json` | `settings` |

Plus the agent version (`<agent> --version`, 2 s timeout, cached 12 h in `~/.tokenfin/agent-state.json`),
file path, mtime and the sha256 of the redacted snapshot. A file that fails to parse is reported as
`parse_error` rather than silently dropped. Only user-level files are read; project files are not.

### Redaction — on the machine, before upload

Replaced with `[redacted]`:

- every string under a key matching `/key|token|secret|password|auth|credential|bearer|cookie/i`
  (numbers and booleans are kept: `maxTokens: 4096` is not a secret);
- every `OTEL_EXPORTER_OTLP_*HEADERS` value and every value inside a `headers` object (MCP servers);
- inside **any** string: `tfk_…`, `sk-…`, `sk-ant-…`, Stripe, `ghp_…`/`github_pat_…`, GitLab, npm,
  Slack, Google, AWS ids, JWTs, PEM private keys, `Bearer …` / `Basic …` values, URL passwords,
  `?key=` / `?token=` query values, and long hex or high-entropy strings — the rest of the string
  (e.g. a URL's host) is kept.

The API runs the same redactor again (`web/src/lib/agent-configs/redact.ts`) so an old or modified
CLI can never store a raw secret; a vitest parity test keeps the two implementations identical.
`npx tokenfin config show` prints exactly what would be sent.

## Storage (migration 022)

| Table | Contents |
|---|---|
| `agent_devices` | one row per (org, key owner, CLI `device_id`); hostname, OS, CLI version, last sync. `user_id` NULL = shared org-level key (admins only). |
| `agent_configs` | latest snapshot per (device, agent); `needs_restart_since` |
| `agent_config_history` | last 10 **distinct** snapshots per (device, agent) (a row is added only when the sha changes) |
| `agent_config_changes` | change requests: JSON merge patch, reason, requester, `pending / applied / failed / cancelled`, error; last 50 finished kept per device/agent |

All four tables are RLS-on with privileges revoked from `anon` / `authenticated` (service role only).
Snapshots and patches are `json`, not `jsonb`, because `jsonb` re-sorts object keys and key order is
meaningful (OpenCode `permission.bash`: the last matching pattern wins). `agent_config_push()` does a
whole upload atomically. The migration is idempotent; `supabase/migrations/20260930000022_agent_configs.sql`
is a byte-identical copy.

## Access

| Caller | Sees | May request changes |
|---|---|---|
| owner / admin | every device in the workspace | any device |
| member | devices synced with their own keys | their own devices |
| viewer | their own devices | no |
| device key (CLI) | — | reads and reports only for the device the key belongs to (`api_keys.device_id`) |

Someone else's device answers 404, not 403, so its existence is not revealed.

## Changes — the allow-list

A change is a JSON merge patch against the agent's main file plus a few `$tokenfin.*` operations that
the CLI turns into its own canonical writers. `web/src/lib/agent-configs/allowlist.ts` and
`cli/lib/agentconfig.js` hold the same list; the API rejects anything else (422) and the CLI refuses
it again before writing (reported as `failed`).

| Agent | Field | Values |
|---|---|---|
| Claude Code | `model` | model id or null |
| | `env.OTEL_LOG_USER_PROMPTS` | `"1"` or null (prompt capture) |
| | `permissions.defaultMode` | `default`, `acceptEdits`, `plan`, null — **never** `bypassPermissions` |
| | `permissions.allow` / `ask` / `deny` | rule list, replaced whole (`Bash(git push:*)`, `Edit(src/**)`, …) |
| | `permissions.additionalDirectories` | path list, replaced whole |
| | `$tokenfin.statusline` | true / false — never replaces a custom status line |
| | `$tokenfin.hooks` | `[{op: enable/disable/delete, id}]`, `[{op: add_template, template: "tokenfin-session"}]` |
| OpenCode | `model`, `small_model` | model id or null |
| | `permission.edit`, `permission.webfetch` | ask / allow / deny / null |
| | `permission.bash` | an action, or a `{pattern: action}` map replaced whole (order kept) |
| | `$tokenfin.plugin` | install / remove the TokenFin plugin |
| Codex CLI | `model`, `otel.log_user_prompt` | targeted TOML edits, re-parsed before writing |
| Gemini CLI | `model.name`, `telemetry.logPrompts` | |
| all | `$tokenfin.repair` | rewrite the TokenFin telemetry block with the key stored **on the machine** (the server never has it) |

Deliberately not editable from the web: arbitrary env vars, OTLP endpoints/headers, MCP servers,
plugin lists, status-line commands, and free-form hook commands — each of those would let a
dashboard user run code on someone else's machine. Hooks can only be enabled, disabled (parked in
`~/.tokenfin/disabled-hooks.json`), deleted, or added from the fixed TokenFin template.

### Applying: `npx tokenfin config pull [--yes]`

For each pending change: validate against the local allow-list → build the new file in memory →
print the diff (values redacted) → ask `Apply this change? [y/N]` (or `--yes`; without a terminal
and without `--yes` nothing is applied) → back the file up to `*.bak-tokenfin` (once per run, so the
backup is the pre-pull original) → write atomically → report `applied` or `failed` with the error →
push the new snapshot. `setup`, `status` and `doctor` push a snapshot and mention pending changes;
the status line appends `· N config changes pending`.

**Restart needed.** Agents read their config at start. After applying, the CLI prints
`↻ Restart <agent> to apply` and records the time. Each later push checks running processes
(`ps -axo lstart,args`): while a process of that agent older than the change is still running, the
snapshot carries `needs_restart_since` and the page shows "Restart … to apply". Where process start
times are unavailable (Windows) the marker is cleared by the next `setup` / `status`. Processes are
never killed.

## Warnings on the page (`web/src/lib/agent-configs/summary.ts`)

Telemetry not configured; endpoint not pointing at this TokenFin; OTEL headers / key missing; grpc
protocol; logs exporter not `otlp`; non-cumulative temporality; legacy 0.2 Stop hook; OpenCode still
on `opencode-otel-plugin` (or both plugins → double counting); outdated TokenFin plugin; Codex
`metrics_exporter = "statsig"`; hand-written Codex `[otel]`; Gemini target not `local`; prompt capture
off while the workspace allows it (and vice-versa); risky permissions (`Bash(*)` / `Bash` allow,
`sudo`/`rm`/`curl` allow, force-push allow, `bypassPermissions`, whole-disk additional directories,
OpenCode `bash "*": allow` or `permission: "allow"`).

## Session hooks

`tokenfin setup` also registers `node ~/.tokenfin/hooks/session.js` as Claude Code `SessionStart` and
`SessionEnd` command hooks (timeout 5 s; opt out with `--no-session-hooks`, removed by `remove`,
checked by `doctor`). The script posts `{session_id, event, agent, cwd, git_branch, repo, hostname,
agent_version, start_source | end_reason, at}` to `/api/v1/sessions/meta` with the ingest key. It never
reads the transcript, strips credentials from the git remote, prints nothing (SessionStart output would
be injected into Claude's context), and always exits 0 within ~2 s.

## Audit

`agent_config.request`, `agent_config.apply`, `agent_config.fail`, `agent_config.cancel` in
Settings → Audit log, with the agent, fields, hostname, device owner and reason.

## API

| Route | Auth | |
|---|---|---|
| `POST /api/v1/agent-configs` | device key (ingest or read) | upload a snapshot → `{device_ref, pending}` |
| `GET /api/v1/agent-configs?org_id=` | session or read key | people → devices → agents (role-scoped) |
| `GET /api/v1/agent-configs/history?org_id=&device_ref=&agent=` | session | last 10 snapshots |
| `GET /api/v1/agent-configs/changes?device_id=` | device key | pending changes for that device |
| `POST /api/v1/agent-configs/changes` | session | request a change `{org_id, device_ref, agent, patch, reason}` |
| `PATCH /api/v1/agent-configs/changes` | device key / session | `{id, status: applied|failed, error}` (CLI) · `{org_id, id, status: cancelled}` (dashboard) |
