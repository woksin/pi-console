#!/usr/bin/env bash
# VHS has global dimensions; serialize captures (no nested browser instances).
set -eu
mkdir -p .ai-work/pitui-media
vhs docs/spikes/media/tui-pitui.tape
vhs spikes/tui-pitui/wide.tape
