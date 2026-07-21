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

The `dist:*` scripts run through `scripts/dist.mjs`, which disables code-signing
(`CSC_IDENTITY_AUTO_DISCOVERY=false` + cleared `CSC_*` env) so builds don't make
the per-build network call (an RFC-3161 timestamp server) that a firewall blocks.
`npmRebuild` is off (no native modules). Electron/NSIS binaries are cached after
the first build; behind a strict firewall, allow `github.com` for that first
download or pre-seed `%LOCALAPPDATA%\electron-builder\Cache`.

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

### CI releases (Gitea Actions)

`.gitea/workflows/release.yml` builds and publishes a release on every version
tag push:

```bash
git tag v0.9.6 && git push origin v0.9.6
```

It runs on a Linux runner in the `electronuserland/builder:wine` container, so it
produces the Windows installers (Setup + Portable, via Wine) **and** the native
Linux `.deb` in one job, then attaches them to the Gitea release for that tag.
The release is created by calling the Gitea API directly (only touches your
instance — no external release action), using the runner's automatic
`GITHUB_TOKEN`; if that lacks release-write permission, add a `RELEASE_TOKEN`
secret (a Gitea PAT with repo scope) and reference it in the workflow. macOS
`.dmg` needs a macOS runner and isn't built in CI.

> **Upload size cap:** the Gitea host is behind Cloudflare, which rejects request
> bodies over 100 MB (HTTP 413). Release assets must stay under that — which is
> why the Linux **AppImage** (~112 MB) was dropped in favor of the `.deb` (~88 MB),
> and why `compression: maximum` is set in the electron-builder config.

The repo also pushes to a GitHub mirror (`origin` has two push URLs). A parallel
`.github/workflows/release.yml` publishes a **GitHub Release** on the same `v*`
tags, using GitHub-hosted `windows-latest` + `ubuntu-latest` runners. GitHub has
no upload cap, so it ships the Linux **AppImage** too (via `--linux AppImage deb`
on the CLI, overriding the deb-only `package.json` target). Both workflow files
are tag-triggered; the GitHub one is guarded with `if: github.server_url ==
'https://github.com'` so Gitea (which also scans `.github/workflows`) skips it.

> **Testing the packaged Windows exe:** if `ELECTRON_RUN_AS_NODE=1` is set in the
> shell, the built exe launches as a bare Node process and looks broken. Clear it
> first: `Remove-Item Env:ELECTRON_RUN_AS_NODE` (PowerShell).

## Download stats

The README shows live download-count badges (shields.io, GitHub). For per-asset
detail — GitHub's web UI no longer displays it — run:

```bash
npm run downloads                 # GitHub W9MDM/Kerchunk (set GH_TOKEN if private)
node scripts/downloads.mjs --gitea https://git.nsccommunications.com PCARC/kerchunk
```

Both read `download_count` from each release asset via the API and print totals.
