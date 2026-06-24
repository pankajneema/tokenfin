#!/bin/bash
# TokenFin Proxy — One-time installer
# Installs the usage tracking proxy as a macOS background service.
# After this runs, it starts automatically on every login. No terminal needed.

set -e

PLIST="$HOME/Library/LaunchAgents/com.tokenfin.proxy.plist"
PROXY_PATH="/Users/mac/tokenfin/proxy/index.js"
API_KEY="tfk_prod_eafa_119033f4390c03da82e32f6be48258de"
BASE_URL="http://localhost:3001"

# Find node binary
NODE_BIN=$(which node 2>/dev/null || echo "")
if [ -z "$NODE_BIN" ]; then
  echo "❌ Node.js not found. Install from https://nodejs.org and re-run."
  exit 1
fi

# Stop existing service if running
launchctl unload "$PLIST" 2>/dev/null || true

# Write LaunchAgent plist
cat > "$PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.tokenfin.proxy</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$PROXY_PATH</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TOKENFIN_API_KEY</key>
    <string>$API_KEY</string>
    <key>TOKENFIN_BASE_URL</key>
    <string>$BASE_URL</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/tokenfin-proxy.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/tokenfin-proxy.log</string>
</dict>
</plist>
EOF

# Start it now
launchctl load "$PLIST"

sleep 1

# Verify it's running
if lsof -i :7070 | grep LISTEN > /dev/null 2>&1; then
  echo "✅ TokenFin proxy is running on port 7070"
  echo "✅ Every Codex task will now be tracked automatically"
  echo "   Logs: tail -f /tmp/tokenfin-proxy.log"
else
  echo "⚠️  Proxy installed but may still be starting. Check: tail -f /tmp/tokenfin-proxy.log"
fi
