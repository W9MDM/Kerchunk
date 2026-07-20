// Firewall-friendly electron-builder wrapper.
//
// Behind a corporate firewall, electron-builder's code-signing step reaches out
// to an RFC-3161 timestamp server on every build, which fails (ECONNRESET) when
// that host is blocked. Kerchunk's builds are intentionally unsigned, so we turn
// off code-sign auto-discovery here — that removes the only per-build network
// call. (Electron and NSIS binaries are cached after the first successful build.)
//
// Usage: node scripts/dist.mjs [--win|--mac|--linux]
import { spawnSync } from 'node:child_process';

const target = process.argv[2]; // e.g. "--win" (omit to build for the host OS)

// Disable code signing entirely. Kerchunk's installers are unsigned, and signing
// is the only step that phones home per build (an RFC-3161 timestamp server),
// which a firewall blocks. Clearing the cert env + auto-discovery removes it.
// (To ship signed builds later, provide a cert via CSC_LINK and drop this.)
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
for (const key of ['CSC_LINK', 'WIN_CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_KEY_PASSWORD']) {
  delete env[key];
}
const args = target ? [target] : [];

const result = spawnSync('electron-builder', args, {
  stdio: 'inherit',
  shell: true, // resolve electron-builder(.cmd) from node_modules/.bin on all platforms
  env,
});

process.exit(result.status ?? 1);
