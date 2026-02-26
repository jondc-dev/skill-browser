#!/usr/bin/env bash
# install.sh — Post-install setup for Browser Automation Skill

set -e

echo "Installing Browser Automation Skill dependencies..."
npm install

echo "Installing Playwright Chromium browser..."
npx playwright install chromium

echo "Installing Playwright Chromium system dependencies..."
npx playwright install-deps chromium || echo "Warning: Could not install system deps (may need sudo)"

# Detect available RAM and suggest lightweight mode
AVAILABLE_RAM_KB=$(grep MemAvailable /proc/meminfo 2>/dev/null | awk '{print $2}' || echo "0")
AVAILABLE_RAM_MB=$((AVAILABLE_RAM_KB / 1024))

if [ "$AVAILABLE_RAM_MB" -lt 1024 ] && [ "$AVAILABLE_RAM_MB" -gt 0 ]; then
  echo ""
  echo "⚠️  Warning: Only ${AVAILABLE_RAM_MB}MB RAM available."
  echo "   Consider using --lightweight mode to connect to an existing browser:"
  echo "   browser-auto run <flow> --lightweight"
fi

# Create flows directory
mkdir -p flows

echo ""
echo "✅ Browser Automation Skill installed successfully!"
echo "   Run 'browser-auto doctor' to verify your setup."
