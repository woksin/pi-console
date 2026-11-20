#!/bin/sh
# Tier 1 plus the repository's mock-daemon HTTP/SSE integration suite.
set -eu
cd "$(dirname "$0")"
format=$(gofmt -l ./*.go)
if [ -n "$format" ]; then printf '%s\n' "$format"; exit 1; fi
go vet ./...
go test -race ./...
node --check measure.mjs
sh -n demo.sh
cd ../..
npm run check
npm test
git diff --check
