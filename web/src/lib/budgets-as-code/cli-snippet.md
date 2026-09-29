# `tokenfin budgets apply` — hand-off for the CLI owner

Server side is done: `POST /api/v1/budgets/apply` (see `web/src/app/api/v1/budgets/apply/route.ts`).
The CLI only uploads the file and prints the diff the server computes, so the
CLI needs no YAML parser.

- Auth: `Authorization: Bearer <key>` where the key has the **admin** scope
  (Dashboard → API Keys → scopes: admin), or a workspace owner's session.
- Body: the raw YAML, `Content-Type: text/yaml`.
- `?dry_run=true` (default) returns `{ plan, diff }`; `?apply=true` applies and
  returns `{ applied, failures, plan, diff }`. 422 = parse/validation errors
  (`message` or `issues[]`).

## `cli/lib/budgets.js` (zero deps, uses the existing `cli/lib/api.js` style)

```js
'use strict'
// tokenfin budgets apply <file> [--dry-run] [--yes] [--key K] [--url U]
const fs = require('fs')
const http = require('http')
const https = require('https')

function post(url, key, body) {
  return new Promise((resolve) => {
    const u = new URL(url)
    const mod = u.protocol === 'http:' ? http : https
    const req = mod.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search, method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'text/yaml', Accept: 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let buf = ''; res.setEncoding('utf8')
      res.on('data', (c) => (buf += c))
      res.on('end', () => { let json = null; try { json = JSON.parse(buf) } catch {} ; resolve({ status: res.statusCode, json }) })
    })
    req.on('error', (e) => resolve({ status: 0, json: { error: e.code || e.message } }))
    req.setTimeout(30000, () => { req.destroy(); resolve({ status: 0, json: { error: 'timeout' } }) })
    req.end(body)
  })
}

async function budgetsApply({ file, appUrl, key, dryRun, yes, log = console.log }) {
  if (!file) { log('usage: tokenfin budgets apply ./tokenfin-budgets.yaml [--dry-run] [--yes]'); return 2 }
  if (!key) { log('No API key. Pass --key or set TOKENFIN_API_KEY (needs the admin scope).'); return 2 }
  let yaml
  try { yaml = fs.readFileSync(file, 'utf8') } catch (e) { log(`Cannot read ${file}: ${e.message}`); return 2 }
  const base = String(appUrl).replace(/\/$/, '') + '/api/v1/budgets/apply'

  const plan = await post(base + '?dry_run=true', key, yaml)
  if (plan.status === 401) { log('Key rejected (401). Run `npx tokenfin@latest login` or pass --key.'); return 1 }
  if (plan.status === 403) { log('This key cannot manage budgets — it needs the admin scope.'); return 1 }
  if (plan.status === 422) {
    const j = plan.json || {}
    if (j.message) log(`${file}: ${j.message}`)
    for (const i of j.issues || []) log(`${file}: ${i.path}: ${i.message}`)
    if (j.diff) log(j.diff)
    return 1
  }
  if (plan.status !== 200) { log(`Server error (${plan.status}): ${(plan.json && plan.json.error) || 'unknown'}`); return 1 }
  log(plan.json.diff)
  const s = plan.json.plan.summary
  if (dryRun || s.create + s.update + s.delete === 0) return 0

  if (!yes) {
    if (!process.stdin.isTTY) { log('Refusing to apply without --yes in a non-interactive shell.'); return 1 }
    const ok = await new Promise((r) => {
      process.stdout.write('Apply these changes? [y/N] ')
      process.stdin.once('data', (d) => r(/^y(es)?$/i.test(String(d).trim())))
    })
    process.stdin.pause()
    if (!ok) { log('Aborted.'); return 1 }
  }
  const res = await post(base + '?apply=true', key, yaml)
  if (res.status !== 200 || !res.json || !res.json.applied) {
    log(`Apply failed (${res.status}). ${((res.json && res.json.failures) || []).join('; ')}`)
    return 1
  }
  log(`Applied: ${s.create} created, ${s.update} updated, ${s.delete} deleted.`)
  return 0
}

module.exports = { budgetsApply }
```

Wire-up in `cli/bin` dispatcher (flag parsing as the other commands do):

```js
if (cmd === 'budgets' && sub === 'apply') {
  const { budgetsApply } = require('../lib/budgets')
  process.exitCode = await budgetsApply({
    file: args._[2], appUrl: flags.url || cfg.appUrl, key: flags.key || process.env.TOKENFIN_API_KEY || cfg.key,
    dryRun: !!flags['dry-run'], yes: !!flags.yes,
  })
}
```

Exit codes: 0 ok / nothing to do, 1 rejected or failed, 2 usage error.

## GitHub Action (docs snippet)

```yaml
# .github/workflows/tokenfin-budgets.yml
name: TokenFin budgets
on:
  pull_request:
    paths: [tokenfin-budgets.yaml]
  push:
    branches: [main]
    paths: [tokenfin-budgets.yaml]
jobs:
  budgets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - name: Plan (pull requests)
        if: github.event_name == 'pull_request'
        run: npx tokenfin@latest budgets apply ./tokenfin-budgets.yaml --dry-run
        env:
          TOKENFIN_API_KEY: ${{ secrets.TOKENFIN_ADMIN_KEY }}
      - name: Apply (main)
        if: github.event_name == 'push'
        run: npx tokenfin@latest budgets apply ./tokenfin-budgets.yaml --yes
        env:
          TOKENFIN_API_KEY: ${{ secrets.TOKENFIN_ADMIN_KEY }}
```

Without the CLI, the same thing with curl:

```bash
curl -fsS -X POST "$TOKENFIN_URL/api/v1/budgets/apply?dry_run=true" \
  -H "Authorization: Bearer $TOKENFIN_API_KEY" -H 'Content-Type: text/yaml' \
  --data-binary @tokenfin-budgets.yaml | jq -r .diff
```
