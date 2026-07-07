#!/bin/bash
# ACC Portal Discovery — Mac dev / work machine (lower priority than Windows .cmd)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PORTAL_URL="http://cl-biprddb02/Reports_MSREPORT/browse/DHB-wide/ACC"
CDP_PORT=9222
OUT_DIR="$HOME/ACC-Suite"
OUT_FILE="$OUT_DIR/portal-map.json"
DISCOVER="$ROOT/wfh/portal-discover.mjs"

echo ""
echo "  ACC Portal Discovery"
echo "  --------------------"
echo ""

if [[ ! -f "$DISCOVER" ]]; then
  osascript -e 'display alert "ACC Portal Discovery" message "Missing wfh/portal-discover.mjs. Run npm run build and use dist/." as critical'
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "Node.js required" message "Install Node.js LTS from https://nodejs.org/ then try again." as critical'
  exit 1
fi

mkdir -p "$OUT_DIR"

BROWSER=""
for candidate in \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
  if [[ -x "$candidate" ]]; then
    BROWSER="$candidate"
    break
  fi
done

if [[ -z "$BROWSER" ]]; then
  osascript -e 'display alert "Browser not found" message "Install Microsoft Edge or Google Chrome." as critical'
  exit 1
fi

echo "  Opening $BROWSER with remote debugging on port $CDP_PORT …"
"$BROWSER" --remote-debugging-port="$CDP_PORT" --new-window "$PORTAL_URL" &
sleep 2

osascript -e 'display dialog "Log into Citrix VPN and the ACC portal in the browser that opened.

Click OK when you are on the ACC report page." buttons {"OK"} default button "OK" with title "ACC Portal Discovery"'

echo "  Scanning portal …"
export PORTAL_DISCOVER_LAUNCHER=1
node "$DISCOVER" --attach --crawl --out "$OUT_FILE"

SUMMARY="$OUT_DIR/portal-summary.html"
[[ -f "$SUMMARY" ]] && open "$SUMMARY" || true
open "$OUT_DIR"

osascript -e "display dialog \"Portal discovery finished.

Results: $OUT_DIR

Review portal-map.json and redact patient details before sharing.\" buttons {\"OK\"} default button \"OK\" with title \"ACC Portal Discovery\""

echo ""
echo "  Done. Press Enter to close."
read -r _
