#!/bin/bash
# TokenFin — One-click installer
# Downloads the proxy, installs it as a background service,
# and auto-configures every supported AI tool.
# Double-click to run. Nothing else required.

# ── Config (pre-filled per customer when downloaded from dashboard) ──
TOKENFIN_API_KEY="${TOKENFIN_API_KEY:-YOUR_API_KEY_HERE}"
TOKENFIN_BASE_URL="https://tokenfin.curiousdevs.com"
PROXY_URL="$TOKENFIN_BASE_URL/proxy.js"
PROXY_DIR="$HOME/.tokenfin"
PROXY_JS="$PROXY_DIR/proxy.js"
PLIST="$HOME/Library/LaunchAgents/com.tokenfin.proxy.plist"
PROXY_ADDR="http://127.0.0.1:7070/v1"

# ── Colors ──
G='\033[0;32m'   # green
Y='\033[1;33m'   # yellow
R='\033[0;31m'   # red
B='\033[0;34m'   # blue
D='\033[0;90m'   # dim
N='\033[0m'      # reset

ok()   { echo -e "  ${G}✅${N}  $1"; }
skip() { echo -e "  ${Y}–${N}   $1"; }
fail() { echo -e "  ${R}❌${N}  $1"; }
info() { echo -e "  ${D}    $1${N}"; }

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║      TokenFin — Setup                   ║"
echo "  ║      tokenfin.curiousdevs.com            ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# ════════════════════════════════════════════════════════
# STEP 1 — API key
# ════════════════════════════════════════════════════════
echo -e "  ${B}Step 1 of 5 — API key${N}"
echo ""

if [ "$TOKENFIN_API_KEY" = "YOUR_API_KEY_HERE" ]; then
  echo "  Your API key is shown on the Connected Platforms page"
  echo "  of your TokenFin dashboard."
  echo ""
  read -p "  Paste your API key here: " TOKENFIN_API_KEY
  if [ -z "$TOKENFIN_API_KEY" ]; then
    fail "No API key entered. Get yours at $TOKENFIN_BASE_URL/dashboard/mcp"
    read -p "  Press Enter to close..."
    exit 1
  fi
fi
ok "API key set"

echo ""

# ════════════════════════════════════════════════════════
# STEP 2 — Check Node.js
# ════════════════════════════════════════════════════════
echo -e "  ${B}Step 2 of 5 — Checking Node.js${N}"
echo ""

NODE_BIN=$(which node 2>/dev/null \
  || ls /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node 2>/dev/null | head -1)

if [ -z "$NODE_BIN" ]; then
  fail "Node.js not found."
  info "Install from https://nodejs.org then double-click this file again."
  read -p "  Press Enter to close..."
  exit 1
fi
ok "Node.js: $NODE_BIN ($(${NODE_BIN} --version))"

echo ""

# ════════════════════════════════════════════════════════
# STEP 3 — Download + install proxy
# ════════════════════════════════════════════════════════
echo -e "  ${B}Step 3 of 5 — Installing background tracker${N}"
echo ""

mkdir -p "$PROXY_DIR"

# Download proxy.js from TokenFin server
if curl -fsSL "$PROXY_URL" -o "$PROXY_JS" 2>/dev/null; then
  ok "Proxy downloaded to ~/.tokenfin/proxy.js"
else
  fail "Could not download proxy from $PROXY_URL"
  info "Check your internet connection and try again."
  read -p "  Press Enter to close..."
  exit 1
fi

# Stop existing service if running
launchctl unload "$PLIST" 2>/dev/null || true

# Write LaunchAgent plist
cat > "$PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.tokenfin.proxy</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$PROXY_JS</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TOKENFIN_API_KEY</key>
    <string>$TOKENFIN_API_KEY</string>
    <key>TOKENFIN_BASE_URL</key>
    <string>$TOKENFIN_BASE_URL</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/tokenfin-proxy.log</string>
  <key>StandardErrorPath</key><string>/tmp/tokenfin-proxy.log</string>
</dict>
</plist>
EOF

launchctl load "$PLIST"
ok "Background service installed (auto-starts on every login)"

echo ""

# ════════════════════════════════════════════════════════
# STEP 4 — Auto-configure AI tools
# ════════════════════════════════════════════════════════
echo -e "  ${B}Step 4 of 5 — Configuring your AI tools${N}"
echo ""

CONFIGURED=()
SKIPPED=()

# ── Codex ──────────────────────────────────────────────
CODEX_CONFIG="$HOME/.codex/config.toml"
if [ -f "$CODEX_CONFIG" ]; then
  cp "$CODEX_CONFIG" "$CODEX_CONFIG.bak"   # backup first
  if grep -q "base_url" "$CODEX_CONFIG"; then
    # Replace existing base_url (any value, any section)
    sed -i '' "s|base_url = \".*\"|base_url = \"$PROXY_ADDR\"|g" "$CODEX_CONFIG"
    ok "Codex — base_url updated"
  else
    # No base_url yet — append after first [model_providers.*] section header
    # Use awk: print lines, when we see [model_providers.*] print the new line after it
    awk -v url="$PROXY_ADDR" '
      /^\[model_providers\./ && !done {
        print; print "base_url = \"" url "\""; done=1; next
      }
      { print }
    ' "$CODEX_CONFIG" > "$CODEX_CONFIG.tmp" && mv "$CODEX_CONFIG.tmp" "$CODEX_CONFIG"
    ok "Codex — base_url added to config"
  fi
  CONFIGURED+=("Codex")
else
  skip "Codex — config not found, skipping"
  info "~/.codex/config.toml does not exist (Codex not installed)"
  SKIPPED+=("Codex")
fi

# ── Claude CLI ─────────────────────────────────────────
CLAUDE_CONFIGURED=false
for PROFILE in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
  if [ -f "$PROFILE" ]; then
    # Remove any previous TokenFin line to avoid duplicates
    grep -v "ANTHROPIC_BASE_URL" "$PROFILE" > "$PROFILE.tmp" \
      && mv "$PROFILE.tmp" "$PROFILE"
    # Append fresh
    echo "" >> "$PROFILE"
    echo "# TokenFin — route Claude CLI usage through tracker" >> "$PROFILE"
    echo "export ANTHROPIC_BASE_URL=http://127.0.0.1:7070" >> "$PROFILE"
    CLAUDE_CONFIGURED=true
    ok "Claude CLI — ANTHROPIC_BASE_URL added to $(basename $PROFILE)"
  fi
done

if $CLAUDE_CONFIGURED; then
  CONFIGURED+=("Claude CLI")
  info "Open a new terminal window for Claude CLI changes to take effect"
else
  skip "Claude CLI — no shell profile found"
  SKIPPED+=("Claude CLI")
fi

# ── OpenCode ───────────────────────────────────────────
OPENCODE_CONFIG="$HOME/.config/opencode/config.json"
if [ -f "$OPENCODE_CONFIG" ]; then
  cp "$OPENCODE_CONFIG" "$OPENCODE_CONFIG.bak"
  # Use Python (available on every Mac) to safely edit JSON
  python3 - "$OPENCODE_CONFIG" "$PROXY_ADDR" << 'PYEOF'
import sys, json
path, url = sys.argv[1], sys.argv[2]
with open(path) as f: cfg = json.load(f)
cfg.setdefault('providers', {})
for provider in cfg['providers'].values():
    if isinstance(provider, dict):
        provider['baseURL'] = url
with open(path, 'w') as f: json.dump(cfg, f, indent=2)
PYEOF
  ok "OpenCode — baseURL updated"
  CONFIGURED+=("OpenCode")
else
  skip "OpenCode — config not found, skipping"
  SKIPPED+=("OpenCode")
fi

# ── Cursor ─────────────────────────────────────────────
# Cursor routes AI calls through cursor.sh servers — cannot be intercepted
# via a local base_url the same way. Manual setup needed via Cursor settings UI.
skip "Cursor — needs manual setup (see Resources → Connect tools)"

echo ""

# ════════════════════════════════════════════════════════
# STEP 5 — Verify proxy is running
# ════════════════════════════════════════════════════════
echo -e "  ${B}Step 5 of 5 — Verifying tracker${N}"
echo ""

sleep 2
if lsof -i :7070 | grep LISTEN > /dev/null 2>&1; then
  ok "Tracker is running on port 7070"
else
  fail "Tracker installed but not responding on port 7070"
  info "Check: tail -f /tmp/tokenfin-proxy.log"
fi

echo ""
echo "  ══════════════════════════════════════════════"
echo -e "  ${G}🎉  TokenFin is set up!${N}"
echo ""

if [ ${#CONFIGURED[@]} -gt 0 ]; then
  echo "  Auto-configured:"
  for tool in "${CONFIGURED[@]}"; do
    echo -e "    ${G}✓${N}  $tool"
  done
fi

if [ ${#SKIPPED[@]} -gt 0 ]; then
  echo ""
  echo "  Not found (install later from Resources):"
  for tool in "${SKIPPED[@]}"; do
    echo -e "    ${Y}–${N}  $tool"
  done
fi

echo ""
echo "  Every AI call now tracked automatically."
echo "  View your dashboard:"
echo -e "  ${B}$TOKENFIN_BASE_URL/dashboard${N}"
echo ""
echo "  Logs: tail -f /tmp/tokenfin-proxy.log"
echo "  ══════════════════════════════════════════════"
echo ""

osascript -e "display notification \"AI tools configured. Usage now tracked automatically.\" with title \"TokenFin Installed ✅\" sound name \"Glass\"" 2>/dev/null || true

read -p "  Press Enter to close..."
