#!/bin/sh
# Tier 1 plus the repository's mock-daemon HTTP/SSE integration suite.
set -eu
cd "$(dirname "$0")"
format=$(gofmt -l ./*.go ./api/*.go)
if [ -n "$format" ]; then printf '%s\n' "$format"; exit 1; fi
node generate.mjs --check
go build -trimpath ./...
go vet ./...
go test -race ./...
node --check measure.mjs
node --check r2-capture.mjs
node --check npm/build.mjs
node --check npm/cli.cjs
node --test npm/cli.test.cjs
sh -n demo.sh
cd ../..
npm run check
npm test
git diff --check
