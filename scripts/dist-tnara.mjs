// Build the TNARA-branded Windows installers (Setup + Portable) → release-tnara/.
// Sets KERCHUNK_BRAND=tnara so the renderer/main bundles carry TNARA branding and
// seed node 610750, then packages with electron-builder.tnara.cjs. Code signing
// is disabled (unsigned builds, firewall-friendly).
import { spawnSync } from 'node:child_process';

const env = { ...process.env, KERCHUNK_BRAND: 'tnara', CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
for (const key of ['CSC_LINK', 'WIN_CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_KEY_PASSWORD']) {
  delete env[key];
}

// 1. Compile the branded bundles.
let r = spawnSync('electron-vite', ['build'], { stdio: 'inherit', shell: true, env });
if (r.status) process.exit(r.status);

// 2. Package with the TNARA config (electronDist is set inside the config on Windows).
r = spawnSync('electron-builder', ['--win', '--config', 'electron-builder.tnara.cjs'], {
  stdio: 'inherit',
  shell: true,
  env,
});
process.exit(r.status ?? 1);
