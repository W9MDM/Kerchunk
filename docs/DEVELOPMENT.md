# Development

## Prerequisites

- Node.js 20 or newer
- npm

## Install and run

```bash
npm install
npm run dev
```

## Tests and checks

```bash
npm test
npm run lint
npm run typecheck
```

## Packaging

```bash
npm run dist:win     # Windows installer + portable .exe → release/
npm run dist:mac     # macOS .dmg (must run on macOS)
npm run dist:linux   # Linux (see note below)
```

Artifacts land in `release/`, named from the `version` in `package.json`
(`Kerchunk-x.y.z-Setup.exe`, `-Portable.exe`, `-linux-x64.tar.gz`).

**Bump `version` in `package.json` for any substantial change** (also update the
`appVersion` fallback in `src/protocol/node.ts`, which is reported to AllStarLink
as `apprptvers`), and keep these docs in step with the code.

### Linux tarball on Windows

electron-builder can't assemble the AppImage/`.deb` on Windows (`mksquashfs`
isn't available), so `dist:linux` errors out *after* it has already produced
`release/linux-unpacked/`. Package that directory into a tarball instead:

```bash
cd release
cp ../LICENSE linux-unpacked/LICENSE.txt
printf '#!/bin/sh\ncd "$(dirname "$0")" || exit 1\nchmod +x kerchunk chrome_crashpad_handler 2>/dev/null\nexec ./kerchunk --no-sandbox "$@"\n' > linux-unpacked/run.sh
tar czf Kerchunk-<version>-linux-x64.tar.gz \
  --transform 's,^linux-unpacked,Kerchunk-<version>-linux-x64,' linux-unpacked
```

Build the native AppImage/`.deb` on Linux or in CI.

> **Testing the packaged Windows exe:** if `ELECTRON_RUN_AS_NODE=1` is set in the
> shell, the built exe launches as a bare Node process and looks broken. Clear it
> first: `Remove-Item Env:ELECTRON_RUN_AS_NODE` (PowerShell).
