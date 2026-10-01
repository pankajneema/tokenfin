# TokenFin plugin for OpenCode

First-party usage capture for [OpenCode](https://opencode.ai). It replaces the
third-party `opencode-otel-plugin`, which drops cache tokens, session ids and
prompt text.

One event per **completed** assistant message, sent to
`POST {url}/api/v1/ingest/batch`:

| Field | From OpenCode |
|---|---|
| `model`, `provider` | `modelID`, `providerID` |
| `input_tokens`, `output_tokens`, `reasoning_tokens` | `tokens.input / output / reasoning` |
| `cache_read_tokens`, `cache_write_tokens` | `tokens.cache.read / write` |
| `latency_ms` | `time.completed − time.created` |
| `session_id` | `sessionID` |
| `correlation_id` (prompt id) | `parentID`, the user message |
| `idempotency_key` | the assistant message id, so retries and replays never double count |
| `prompt_text` | the full text of the user message (all typed text parts, untruncated), on the first assistant message of that prompt |
| `cost_usd` | OpenCode's reported cost, kept as `vendor_cost_usd` |
| `cost_basis` | `notional` when OpenCode reports $0 with tokens (subscription / OAuth providers such as `opencode-claude-auth`), otherwise `metered` |
| `user_email`, `repo` | `git config user.email` and the `origin` remote of the project |

The server always prices the tokens itself, including cache and reasoning. A
metered row can't lower its own cost, and only known agent sources may claim
`notional`.

## Install

```bash
npx tokenfin@latest setup
```

On a machine with OpenCode, `setup` copies `tokenfin.js` to
`~/.config/opencode/plugin/tokenfin.js`. OpenCode 1.x auto-loads every
`{plugin,plugins}/*.{js,ts}` in its config directory. `setup` also removes
`opencode-otel-plugin` from the `plugin` array in `opencode.json`, so usage
isn't counted twice. Restart OpenCode afterwards.

`npx tokenfin doctor` checks the plugin, and `npx tokenfin remove` deletes it.

To install by hand, copy `tokenfin.js` into `~/.config/opencode/plugin/`, or
list it by path in `opencode.json`:
`"plugin": ["file:///abs/path/tokenfin.js"]`.

## Configuration

No shell variables are needed. The plugin reads `~/.tokenfin/config.json`,
which `tokenfin login` / `setup` write. The first match wins for each setting:

- **key**: `TOKENFIN_API_KEY`, then `TOKENFIN_KEY`, then `key` in config.json. Use an ingest key.
- **url**: `TOKENFIN_URL`, then `TOKENFIN_APP_URL`, then `appUrl` or `url` in config.json (a trailing `/api/mcp` is stripped). Otherwise it defaults to `https://tokenfin.curiousdevs.com`.
- **prompt text**: sent unless `TOKENFIN_PROMPTS=0` is set or `prompts` is `false` in config.json (`setup --no-prompts`). Your org can also turn capture off in Settings → Workspace.

## Behaviour

- `message.updated` fires many times per message, and only the first completed
  snapshot is sent. A message that has `finish` but never gets
  `time.completed` is sent after 15 s with its latest snapshot.
- Events are batched every 5 s, on `session.idle`, and on dispose. Network
  errors, 429 and 5xx responses are retried with exponential backoff (up to
  5 min, 12 attempts). A 401, 403 or 400 is dropped and logged once.
- The plugin never throws into OpenCode. A missing key is logged once through
  OpenCode's log, and the key is re-read every minute, so running `setup` later
  starts capture without a restart.
- The plugin is a single ES module with zero dependencies that uses global
  `fetch`. The default export `{ id: 'tokenfin', server }` is its only export.

## Limits

- Only assistant messages in sessions are captured. OpenCode's internal
  title-generation calls are not session messages, so they are not recorded.
- Synthetic text parts, such as the contents of an attached file, are left out
  of `prompt_text` when the user also typed text.

## Development

```bash
cd plugins/opencode && npm test        # node:test, no dependencies
```

The CLI ships a byte-identical copy at `cli/assets/opencode-tokenfin.js`. The
CLI test suite fails if the two copies differ. After editing, run:

```bash
cp plugins/opencode/tokenfin.js cli/assets/opencode-tokenfin.js
```
