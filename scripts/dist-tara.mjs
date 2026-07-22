// Build the TARA-branded Windows installers (Setup + Portable) → release-tara/.
// Sets KERCHUNK_BRAND=tara so the renderer/main bundles carry TARA branding and
// seed node 610750, then packages with electron-builder.tara.cjs. Code signing
// is disabled (unsigned builds, firewall-friendly).
import { spawnSync } from 'node:child_process';

const env = { ...process.env, KERCHUNK_BRAND: 'tara', CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
for (const key of ['CSC_LINK', 'WIN_CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_KEY_PASSWORD']) {
  delete env[key];
}

// 1. Compile the branded bundles.
let r = spawnSync('electron-vite', ['build'], { stdio: 'inherit', shell: true, env });
if (r.status) process.exit(r.status);

// 2. Package with the TARA config (electronDist is set inside the config on
// Windows). --publish never: don't let a git tag trigger an implicit GitHub
// publish (CI attaches assets separately; that needs no token).
r = spawnSync('electron-builder', ['--win', '--config', 'electron-builder.tara.cjs', '--publish', 'never'], {
  stdio: 'inherit',
  shell: true,
  env,
});
process.exit(r.status ?? 1);
