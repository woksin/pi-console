#!/bin/sh
# First-release gate for the TUI on Linux: a fresh `npm ci` on Node 26 in a container, then the pty integration spec
# against the mock daemon. Needs Docker and network (npm registry, image pull). Run through pi-phase --kind integration:
#   ~/.pi/agent/bin/pi-phase run --kind integration --label 'tui linux' --timeout 900 --log .ai-work/p4/linux.log -- sh scripts/tui-linux.sh
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
image=${PI_CONSOLE_NODE_IMAGE:-node:26-slim}
exec docker run --rm -v "$root":/src:ro "$image" sh -ec '
  node --version
  uname -sm
  mkdir /work
  tar -C /src --exclude=node_modules --exclude=.git --exclude=.ai-work -cf - . | tar -C /work -xf -
  cd /work
  npm ci --no-audit --no-fund
  command -v script >/dev/null || { apt-get update -qq && apt-get install -y -qq bsdutils >/dev/null; }
  node --experimental-ffi --disable-warning=ExperimentalWarning --test packages/tui/src/tui.integration.ts
'
