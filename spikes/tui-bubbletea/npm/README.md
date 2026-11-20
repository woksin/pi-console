# Bubble Tea packaging proof (local-only)

Start the unchanged mock daemon from the repository root before launching the interactive wrapper. Node >=22 launches a self-contained Go executable; the native program itself needs no Node runtime. No packages are published. Build from the spike directory:

```sh
node npm/build.mjs
out=../../.ai-work/tasks/m0r2-bubbletea/output/npm
npm i -g --prefix "$out/prefix" --ignore-scripts --no-audit --no-fund \
  "$out/pi-console-spike-bubbletea-darwin-arm64-0.0.0-r2.tgz" \
  "$out/pi-console-spike-bubbletea-0.0.0-r2.tgz"
"$out/prefix/bin/pi-console-bubbletea" --screen graph --duration 2s
```

The main package has optional per-platform dependencies in the esbuild style. A registry release would publish platform packages before the main package. Here install both local tarballs together; this exercises the real launcher without publishing. Supported matrix: macOS arm64 (executed), Linux x64 and Windows x64 (cross-built, not executed). Missing optional binaries and unsupported OS/CPU combinations fail with actionable messages. No install scripts or runtime downloads. `--token` or the development token file authenticates to the loopback-only mock.
