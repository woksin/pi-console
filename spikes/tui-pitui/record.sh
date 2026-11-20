#!/usr/bin/env bash
# Run from the repository root. Owns and cleans up only its child daemon.
set -eu
mkdir -p .ai-work/pitui-media
port="${3:-4783}"
node spikes/mock-daemon/server.ts --port "$port" --rate "${4:-30}" \
  > .ai-work/pitui-media/daemon.log 2>&1 &
daemon=$!
trap 'kill "$daemon" 2>/dev/null || true; wait "$daemon" 2>/dev/null || true' EXIT
ready=false
for attempt in {1..40}; do
  if test -f .pi-console-dev/token && curl -fsS \
    -H "Authorization: Bearer $(cat .pi-console-dev/token)" \
    "http://127.0.0.1:$port/api/v0/sessions" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 0.1
done
if test "$ready" != true; then cat .ai-work/pitui-media/daemon.log; exit 1; fi
stty size > ".ai-work/pitui-media/size-${1:-120}.txt"
stty cols "${1:-120}" rows "${2:-36}"
COLORTERM=truecolor node spikes/tui-pitui/main.ts --url "http://127.0.0.1:$port" \
  --token-file .pi-console-dev/token --colors truecolor
