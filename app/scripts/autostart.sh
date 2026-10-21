#!/bin/sh
# Keeps the B.C Tracker app running in the background on macOS, so the extension never
# finds localhost:5055 refusing connections. Installs a per-user launchd agent that:
#   - starts the app when you log in (RunAtLoad), and
#   - restarts it within ~10s if it ever exits or crashes (KeepAlive).
#
#   npm run autostart:install     (from app/)  — install / reinstall, starts it now
#   npm run autostart:uninstall                — stop it and remove the agent
#
# Output goes to app/data/server.log.
set -eu

LABEL="com.bctracker.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="gui/$(id -u)"

uninstall() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
}

case "${1:-}" in
  install)
    NODE="$(command -v node || true)"
    if [ -z "$NODE" ]; then
      echo "Could not find node on your PATH." >&2
      exit 1
    fi
    uninstall
    mkdir -p "$HOME/Library/LaunchAgents" "$APP_DIR/data"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$APP_DIR/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$APP_DIR/data/server.log</string>
  <key>StandardErrorPath</key><string>$APP_DIR/data/server.log</string>
</dict>
</plist>
EOF
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "Installed. B.C Tracker now starts at login and restarts itself if it stops."
    echo "Log: $APP_DIR/data/server.log"
    ;;
  uninstall)
    uninstall
    echo "Removed. Start the app manually with: npm start"
    ;;
  *)
    echo "usage: $0 install|uninstall" >&2
    exit 1
    ;;
esac
