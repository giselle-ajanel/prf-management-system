#!/bin/bash
# Purchase Request Hub — double-click launcher for macOS.
#
# If double-clicking gives "permission denied", run this once in Terminal:
#   chmod +x "$(dirname "$0")/Launch_Purchase_Request_Hub.command"
# (The launcher re-applies that permission to itself each run, so it is a one-time fix.)

cd "$(dirname "$0")" || exit 1
chmod +x "$0" 2>/dev/null

clear
echo "======================================================"
echo "  Purchase Request Hub"
echo "======================================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed on this Mac."
  echo
  echo "  Install it from https://nodejs.org (choose the LTS"
  echo "  download), then double-click this launcher again."
  echo
  echo "  Press any key to close."
  read -r -n 1 -s
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "  First run — setting things up. This takes a minute."
  echo
  npm install --silent || { echo "  Setup failed. Press any key to close."; read -r -n 1 -s; exit 1; }
fi

# Reuse the server if one is already running, so a second double-click doesn't fail on a busy port.
if curl -s -o /dev/null "http://localhost:3000"; then
  echo "  Already running — opening your browser."
else
  echo "  Starting up..."
  npm run dev > .launcher.log 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 40); do
    sleep 1
    curl -s -o /dev/null "http://localhost:3000" && break
  done
fi

if ! curl -s -o /dev/null "http://localhost:3000"; then
  echo
  echo "  It didn't start. The details are in .launcher.log"
  echo "  Press any key to close."
  read -r -n 1 -s
  exit 1
fi

open "http://localhost:3000"

echo
echo "  Purchase Request Hub is running!"
echo "  Your browser should have opened automatically."
echo "  If not, go to:  http://localhost:3000"
echo
echo "  Sign-in details are in HOW_TO_OPEN.md"
echo
echo "------------------------------------------------------"
echo "  Close this window when finished."
echo "------------------------------------------------------"
echo

# Keep the window open; closing it stops the server we started.
if [ -n "$SERVER_PID" ]; then
  trap 'kill $SERVER_PID 2>/dev/null' EXIT
  wait $SERVER_PID
else
  read -r -d '' _ 2>/dev/null
fi
