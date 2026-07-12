#!/usr/bin/env bash
#
# TokenFin one-command setup for Claude Code.
#
# On any fresh machine this wires up BOTH halves of end-to-end auto-recording:
#   1. the tokenfin MCP server (global / user scope) — exposes the read + record tools
#   2. a global Stop hook — after every Claude Code turn, sends that turn's token
#      usage to record_usage so the dashboard fills automatically (no manual calls)
#
# Usage:
#   TOKENFIN_KEY=tfk_prod_xxx ./scripts/tokenfin-setup.sh
#   TOKENFIN_KEY=tfk_prod_xxx TOKENFIN_URL=https://your-host/api/mcp ./scripts/tokenfin-setup.sh
#
# Idempotent: safe to run repeatedly. Backs up settings.json before editing.
set -euo pipefail

URL="${TOKENFIN_URL:-https://tokenfin.curiousdevs.com/api/mcp}"
KEY="${TOKENFIN_KEY:-}"
if [ -z "$KEY" ]; then
  echo "ERROR: set TOKENFIN_KEY to a full raw key, e.g. TOKENFIN_KEY=tfk_prod_xxx $0" >&2
  exit 1
fi
case "$KEY" in *…*|*...*) echo "ERROR: that looks like a masked key (contains …). Use the full raw key." >&2; exit 1;; esac

CLAUDE_DIR="$HOME/.claude"
mkdir -p "$CLAUDE_DIR"

# ── 1. hook config (url + key), private ──────────────────────────────
cat > "$CLAUDE_DIR/tokenfin-hook.json" <<EOF
{
  "url": "$URL",
  "key": "$KEY"
}
EOF
chmod 600 "$CLAUDE_DIR/tokenfin-hook.json"
echo "✔ wrote $CLAUDE_DIR/tokenfin-hook.json"

# ── 2. the recorder script (Stop hook target) ────────────────────────
cat > "$CLAUDE_DIR/tokenfin-record-usage.js" <<'JSEOF'
#!/usr/bin/env node
// TokenFin auto-record Stop hook. Reads the finished turn's token usage from the
// session transcript and POSTs it to record_usage. Fail-open & silent (exit 0).
const fs = require('fs'), os = require('os'), path = require('path'), https = require('https')
const done = () => process.exit(0)
let input = ''
try { input = fs.readFileSync(0, 'utf8') } catch { done() }
let payload; try { payload = JSON.parse(input) } catch { done() }
const transcript = payload.transcript_path, sid = payload.session_id || 'unknown'
if (!transcript || !fs.existsSync(transcript)) done()
let cfg; try { cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'tokenfin-hook.json'), 'utf8')) } catch { done() }
if (!cfg || !cfg.url || !cfg.key) done()
const stateDir = path.join(os.homedir(), '.claude', 'tokenfin-hook-state')
try { fs.mkdirSync(stateDir, { recursive: true }) } catch {}
const statePath = path.join(stateDir, sid + '.offset')
let offset = 0; try { offset = parseInt(fs.readFileSync(statePath, 'utf8'), 10) || 0 } catch {}
const lines = fs.readFileSync(transcript, 'utf8').split('\n').filter(Boolean)
if (lines.length <= offset) done()
let inTok = 0, outTok = 0, model = null
for (let i = offset; i < lines.length; i++) {
  let o; try { o = JSON.parse(lines[i]) } catch { continue }
  if (o.type === 'assistant' && o.message && o.message.usage) {
    const u = o.message.usage
    inTok += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
    outTok += (u.output_tokens || 0)
    if (o.message.model) model = o.message.model
  }
}
try { fs.writeFileSync(statePath, String(lines.length)) } catch {}
if (!model || (inTok === 0 && outTok === 0)) done()
const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'record_usage', arguments: { model, input_tokens: inTok, output_tokens: outTok } } })
let u; try { u = new URL(cfg.url) } catch { done() }
const req = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname, method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Authorization': 'Bearer ' + cfg.key, 'Content-Length': Buffer.byteLength(body) } },
  res => { res.resume(); res.on('end', done) })
req.on('error', done)
req.setTimeout(4000, () => { try { req.destroy() } catch {}; done() })
req.write(body); req.end()
JSEOF
echo "✔ wrote $CLAUDE_DIR/tokenfin-record-usage.js"

# ── 3. register the Stop hook in settings.json (merge, idempotent) ────
SETTINGS="$CLAUDE_DIR/settings.json"
[ -f "$SETTINGS" ] && cp "$SETTINGS" "$SETTINGS.bak-tokenfin"
CMD="node $CLAUDE_DIR/tokenfin-record-usage.js" node -e '
const fs = require("fs"), p = process.env.HOME + "/.claude/settings.json"
let s = {}; try { s = JSON.parse(fs.readFileSync(p, "utf8")) } catch {}
s.hooks = s.hooks || {}
s.hooks.Stop = s.hooks.Stop || []
const cmd = process.env.CMD
const already = s.hooks.Stop.some(g => (g.hooks || []).some(h => h.command === cmd))
if (!already) s.hooks.Stop.push({ hooks: [{ type: "command", command: cmd }] })
fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n")
console.log(already ? "✔ Stop hook already present" : "✔ added Stop hook to settings.json")
'

# ── 4. register the MCP server globally (user scope) ─────────────────
claude mcp remove tokenfin -s user  >/dev/null 2>&1 || true
claude mcp add --scope user --transport http tokenfin "$URL" --header "Authorization: Bearer $KEY" >/dev/null
echo "✔ added tokenfin MCP server (user scope)"

echo
echo "Done. Restart Claude Code, then every session on this machine auto-records usage to your TokenFin dashboard."
