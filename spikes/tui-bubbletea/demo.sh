#!/bin/sh
# Run from the repository root. This owns and stops only its own mock process.
set -eu
mkdir -p .ai-work/tui-bubbletea
node spikes/mock-daemon/server.ts --port 47871 >.ai-work/tui-bubbletea/demo-daemon.log 2>&1 &
daemon=$!
trap 'kill "$daemon" 2>/dev/null || true; wait "$daemon" 2>/dev/null || true' EXIT INT TERM
sleep 0.5
kill -0 "$daemon"
stty size > ".ai-work/tui-bubbletea/terminal-${1:-120}x${2:-36}.txt"
stty cols "${1:-120}" rows "${2:-36}"
spikes/tui-bubbletea/pi-console --url http://127.0.0.1:47871 --colors truecolor
